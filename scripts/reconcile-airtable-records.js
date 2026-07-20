import "../lib/config.js";
import { base } from "../lib/clients.js";
import { db } from "../lib/db.js";
import { caseActions, caseThreads } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { mapAirtableFields } from "../lib/airtable-fields.js";
import {
  getCaseActionByAirtableRecordId,
  getCaseActionsByTargetUserId,
} from "../lib/case-tracker.js";

const TABLE_NAME = "LYLA Records";
const DRY_RUN = process.argv.includes("--dry-run");

function parseDate(value, fallbackIso) {
  const d = value ? new Date(value) : fallbackIso ? new Date(fallbackIso) : null;
  const ms = d?.getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function parsePermalink(url) {
  if (!url) return null;
  const pathMatch = url.match(/\/archives\/([A-Z0-9]+)\/p(\d+)/);
  if (!pathMatch) return null;
  const channel = pathMatch[1];
  const raw = pathMatch[2];
  const messageTs = `${raw.slice(0, -6)}.${raw.slice(-6)}`;
  const threadMatch = url.match(/[?&]thread_ts=([\d.]+)/);
  const threadTs = threadMatch ? threadMatch[1] : messageTs;
  return { channel, threadTs };
}

async function findCaseByThread(permalink) {
  const parsed = parsePermalink(permalink);
  if (!parsed) return null;
  const [row] = await db
    .select()
    .from(caseThreads)
    .where(and(eq(caseThreads.channel, parsed.channel), eq(caseThreads.threadTs, parsed.threadTs)))
    .limit(1);
  return row ?? null;
}

async function findMatch(targetUserId, permalink, whatTheyDid) {
  if (!targetUserId || !permalink) return { match: null, ambiguous: false };

  const candidates = (await getCaseActionsByTargetUserId(targetUserId)).filter(
    (row) => !row.airtableRecordId && row.data?.permalink === permalink
  );

  if (candidates.length === 0) return { match: null, ambiguous: false };
  if (candidates.length === 1) return { match: candidates[0], ambiguous: false };

  const byContent = candidates.filter((row) => row.data?.whatTheyDid === whatTheyDid);
  if (byContent.length === 1) return { match: byContent[0], ambiguous: false };

  return { match: null, ambiguous: true };
}

async function main() {
  if (!base) {
    console.error("Airtable not configured (AIRTABLE_PAT/AIRTABLE_BASE_ID missing)");
    process.exit(1);
  }

  const records = await base(TABLE_NAME).select().all();
  console.log(`Found ${records.length} records in "${TABLE_NAME}"${DRY_RUN ? " (dry run)" : ""}`);

  let alreadyReconciled = 0;
  let matched = 0;
  let linkedToExistingCase = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let skippedNoUser = 0;

  for (const [index, record] of records.entries()) {
    if ((index + 1) % 100 === 0) {
      console.log(`Progress: ${index + 1}/${records.length}`);
    }

    const existing = await getCaseActionByAirtableRecordId(record.id);
    if (existing) {
      alreadyReconciled++;
      continue;
    }

    const mapped = mapAirtableFields(record.fields);

    if (!mapped.targetUserId) {
      console.log(`Skipping ${record.id}: no target user`);
      skippedNoUser++;
      continue;
    }

    const { match, ambiguous: isAmbiguous } = await findMatch(
      mapped.targetUserId,
      mapped.data?.permalink,
      mapped.data?.whatTheyDid
    );

    if (isAmbiguous) {
      console.log(
        `Ambiguous match for ${record.id} (user ${mapped.targetUserId}), review manually`
      );
      ambiguous++;
      continue;
    }

    if (match) {
      if (!DRY_RUN) {
        await db
          .update(caseActions)
          .set({ airtableRecordId: record.id })
          .where(eq(caseActions.id, match.id));
      }
      matched++;
      continue;
    }

    const threadCase = await findCaseByThread(mapped.data?.permalink);
    if (threadCase) {
      const performedAt = parseDate(record.fields["Time Of Report"], record._rawJson.createdTime);
      console.log(
        `${DRY_RUN ? "[dry run] Would link" : "Linking"} ${record.id} to existing case #${threadCase.caseNumber}`
      );
      if (!DRY_RUN) {
        await db.insert(caseActions).values({
          caseNumber: threadCase.caseNumber,
          actionType: mapped.actionType || "unknown",
          targetUserId: mapped.targetUserId,
          performedBy: mapped.performedBy?.length ? mapped.performedBy : ["unknown"],
          data: mapped.data ?? {},
          performedAt,
          airtableRecordId: record.id,
        });
      }
      linkedToExistingCase++;
      continue;
    }

    console.log(
      `No matching case for ${record.id} (user ${mapped.targetUserId}), leaving unlinked`
    );
    unmatched++;
  }

  console.log(
    `Done. ${alreadyReconciled} already reconciled, ${matched} matched, ${linkedToExistingCase} linked to existing case via thread, ${unmatched} unmatched (no existing case, nothing created), ${ambiguous} ambiguous, ${skippedNoUser} skipped (no target user).`
  );
}

main().then(() => process.exit(0));
