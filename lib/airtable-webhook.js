import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { appState } from "../db/schema.js";
import { mapAirtableFields } from "./airtable-fields.js";
import {
  getCaseActionByAirtableRecordId,
  updateCaseAction,
  deleteCaseAction,
} from "./case-tracker.js";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_WEBHOOK_URL = process.env.AIRTABLE_WEBHOOK_URL;
const TABLE_NAME = "LYLA Records";
const API_BASE = "https://api.airtable.com/v0";

const STATE_KEYS = {
  webhookId: "airtableWebhookId",
  macSecret: "airtableWebhookMacSecret",
  cursor: "airtableWebhookCursor",
};

function isConfigured() {
  return Boolean(AIRTABLE_PAT && AIRTABLE_BASE_ID && AIRTABLE_WEBHOOK_URL);
}

async function getState(key) {
  const [row] = await db.select().from(appState).where(eq(appState.key, key)).limit(1);
  return row?.value ?? null;
}

async function setState(key, value) {
  await db
    .insert(appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: appState.key, set: { value } });
}

async function clearState(key) {
  await db.delete(appState).where(eq(appState.key, key));
}

function authHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_PAT}`,
    "Content-Type": "application/json",
  };
}

let tableMetaPromise = null;

function getTableMeta() {
  if (!tableMetaPromise) {
    tableMetaPromise = (async () => {
      const res = await fetch(`${API_BASE}/meta/bases/${AIRTABLE_BASE_ID}/tables`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to fetch base schema: ${res.status}`);

      const { tables } = await res.json();
      const table = tables.find((t) => t.name === TABLE_NAME);
      if (!table) throw new Error(`Table "${TABLE_NAME}" not found in base`);

      const fieldNamesById = new Map(table.fields.map((f) => [f.id, f.name]));
      return { tableId: table.id, fieldNamesById };
    })().catch((error) => {
      tableMetaPromise = null;
      throw error;
    });
  }
  return tableMetaPromise;
}

async function listWebhooks() {
  const res = await fetch(`${API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`list webhooks failed: ${res.status} ${await res.text()}`);
  const { webhooks } = await res.json();
  return webhooks ?? [];
}

async function deleteWebhook(webhookId) {
  await fetch(`${API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks/${webhookId}`, {
    method: "DELETE",
    headers: authHeaders(),
  }).catch(() => {});
}

async function clearWebhookState() {
  await clearState(STATE_KEYS.webhookId);
  await clearState(STATE_KEYS.macSecret);
  await clearState(STATE_KEYS.cursor);
}

async function createWebhook() {
  const { tableId } = await getTableMeta();

  const res = await fetch(`${API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      notificationUrl: AIRTABLE_WEBHOOK_URL,
      specification: {
        options: {
          filters: {
            dataTypes: ["tableData"],
            recordChangeScope: tableId,
            changeTypes: ["add", "update", "remove"],
            fromSources: ["client"],
          },
        },
      },
    }),
  });

  if (!res.ok) {
    console.error(`[airtable-webhook] create failed: ${res.status} ${await res.text()}`);
    return;
  }

  const created = await res.json();
  await clearWebhookState();
  await setState(STATE_KEYS.webhookId, created.id);
  await setState(STATE_KEYS.macSecret, created.macSecretBase64);
  console.log(`[airtable-webhook] registered webhook ${created.id}`);
}

export async function ensureWebhook() {
  if (!isConfigured()) return;

  let webhooks;
  try {
    webhooks = await listWebhooks();
  } catch (error) {
    console.error(`[airtable-webhook] ${error.message}`);
    return;
  }

  const storedId = await getState(STATE_KEYS.webhookId);
  const storedSecret = await getState(STATE_KEYS.macSecret);
  const current = webhooks.find((w) => w.id === storedId);

  if (current) {
    if (current.notificationUrl !== AIRTABLE_WEBHOOK_URL || !storedSecret) {
      console.log(`[airtable-webhook] webhook ${current.id} is stale, re-registering`);
      await deleteWebhook(current.id);
      await createWebhook();
      return;
    }

    if (current.areNotificationsEnabled === false) {
      console.log(`[airtable-webhook] re-enabling notifications for ${current.id}`);
      await fetch(
        `${API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks/${current.id}/enableNotifications`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ enable: true }),
        }
      ).catch(() => {});
    }
    return;
  }

  for (const webhook of webhooks) {
    if (webhook.notificationUrl === AIRTABLE_WEBHOOK_URL) {
      await deleteWebhook(webhook.id);
    }
  }
  await createWebhook();
}

export async function refreshWebhook() {
  if (!isConfigured()) return;

  await ensureWebhook();

  const webhookId = await getState(STATE_KEYS.webhookId);
  if (!webhookId) return;

  const res = await fetch(`${API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks/${webhookId}/refresh`, {
    method: "POST",
    headers: authHeaders(),
  });

  if (res.status === 404 || res.status === 410) {
    await clearWebhookState();
    await ensureWebhook();
    return;
  }

  if (!res.ok) {
    console.error(`[airtable-webhook] refresh failed: ${res.status} ${await res.text()}`);
  }
}

export async function verifyMac(rawBody, macHeader) {
  if (!macHeader) return false;

  const macSecret = await getState(STATE_KEYS.macSecret);
  if (!macSecret) return false;

  const expectedHex = crypto
    .createHmac("sha256", Buffer.from(macSecret, "base64"))
    .update(rawBody)
    .digest("hex");
  const expected = `hmac-sha256=${expectedHex}`;

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(macHeader, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

const DEBOUNCE_MS = 8000;
const pendingUpdates = new Map();
const pendingTimers = new Map();

async function flushRecord(recordId) {
  const entry = pendingUpdates.get(recordId);
  pendingUpdates.delete(recordId);
  pendingTimers.delete(recordId);
  if (!entry) return;

  try {
    const existing = await getCaseActionByAirtableRecordId(recordId);
    if (!existing) {
      console.log(
        `[airtable-webhook] no case_actions row for Airtable record ${recordId}, skipping`
      );
      return;
    }

    const mapped = mapAirtableFields(entry.fields);
    if (Object.keys(mapped).length === 0) return;

    await updateCaseAction(existing.id, entry.actorId, mapped);
  } catch (error) {
    console.error(`[airtable-webhook] failed to apply update for ${recordId}:`, error.message);
  }
}

function scheduleFlush(recordId) {
  const existingTimer = pendingTimers.get(recordId);
  if (existingTimer) clearTimeout(existingTimer);
  pendingTimers.set(
    recordId,
    setTimeout(() => flushRecord(recordId), DEBOUNCE_MS)
  );
}

function collectChange(recordId, cellValuesByFieldId, fieldNamesById, actorId) {
  if (!cellValuesByFieldId) return;

  const entry = pendingUpdates.get(recordId) ?? { fields: {}, actorId };
  for (const [fieldId, value] of Object.entries(cellValuesByFieldId)) {
    const name = fieldNamesById.get(fieldId);
    if (name) entry.fields[name] = value;
  }
  entry.actorId = actorId;
  pendingUpdates.set(recordId, entry);
  scheduleFlush(recordId);
}

async function collectPayload(payload, tableId, fieldNamesById) {
  const tableChanges = payload.changedTablesById?.[tableId];
  if (!tableChanges) return;

  const user = payload.actionMetadata?.sourceMetadata?.user ?? {};
  const actorId = `airtable:${user.email ?? user.id ?? "unknown"}`;

  for (const [recordId, change] of Object.entries(tableChanges.changedRecordsById ?? {})) {
    collectChange(recordId, change.current?.cellValuesByFieldId, fieldNamesById, actorId);
  }

  for (const recordId of tableChanges.destroyedRecordIds ?? []) {
    const timer = pendingTimers.get(recordId);
    if (timer) clearTimeout(timer);
    pendingUpdates.delete(recordId);
    pendingTimers.delete(recordId);

    const existing = await getCaseActionByAirtableRecordId(recordId);
    if (existing) await deleteCaseAction(existing.id, actorId);
  }
}

async function fetchAndApplyPayloads() {
  if (!isConfigured()) return;

  const webhookId = await getState(STATE_KEYS.webhookId);
  if (!webhookId) return;

  const { tableId, fieldNamesById } = await getTableMeta();

  let cursor = await getState(STATE_KEYS.cursor);
  let mightHaveMore = true;

  while (mightHaveMore) {
    const url = new URL(`${API_BASE}/bases/${AIRTABLE_BASE_ID}/webhooks/${webhookId}/payloads`);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 404 || res.status === 410) {
      console.error("[airtable-webhook] webhook gone, re-registering");
      await clearWebhookState();
      await ensureWebhook();
      return;
    }
    if (!res.ok) {
      console.error(`[airtable-webhook] list payloads failed: ${res.status} ${await res.text()}`);
      return;
    }

    const { cursor: nextCursor, mightHaveMore: more, payloads } = await res.json();

    for (const payload of payloads) {
      try {
        await collectPayload(payload, tableId, fieldNamesById);
      } catch (error) {
        console.error(
          `[airtable-webhook] failed to process payload ${payload.baseTransactionNumber}:`,
          error.message
        );
      }
    }

    cursor = nextCursor;
    mightHaveMore = more;
    await setState(STATE_KEYS.cursor, String(cursor));
  }
}

let inFlight = null;

export function processNewPayloads() {
  if (!inFlight) {
    inFlight = fetchAndApplyPayloads().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
