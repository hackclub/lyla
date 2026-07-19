import { getCategoryByCode } from "./infraction-categories.js";

const UCAT_URL = process.env.UCAT_URL;
const UCAT_CASES_SECRET = process.env.UCAT_CASES_SECRET;

const RETRIES = 3;
const BACKOFF_MS = [500, 1500, 4000];

export function isUcatConfigured() {
  return Boolean(UCAT_URL && UCAT_CASES_SECRET);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${UCAT_CASES_SECRET}`,
    "Content-Type": "application/json",
  };
}

async function request(path, method, body) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(`${UCAT_URL}${path}`, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`UCAT ${method} ${path} failed: ${res.status} ${await res.text()}`);
      }
      return await res.json();
    } catch (e) {
      if (attempt === RETRIES - 1) {
        console.error(`[ucat] ${method} ${path} failed after retries:`, e.message);
        return null;
      }
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }
}

async function buildFields(caseRow, action) {
  const category =
    action.categoryCode != null ? await getCategoryByCode(action.categoryCode) : null;
  return {
    subject_slack_id: action.targetUserId,
    subject_email: action.data?.email ?? null,
    subject_display_name: action.data?.displayName ?? null,
    rule_broken: category
      ? action.categoryExtra
        ? `${category.name}: ${action.categoryExtra}`
        : category.name
      : null,
    summary: action.data?.whatTheyDid ?? null,
    evidence: action.data?.permalink ?? null,
    action_taken: action.actionType,
    action_until: action.data?.banUntil ? new Date(action.data.banUntil).getTime() : null,
    opened_at: action.performedAt,
    handled_by: action.performedBy.join(", "),
    ...(caseRow.status === "open"
      ? { status: "open", resolved_at: null }
      : { status: "resolved", resolved_at: caseRow.resolvedAt ?? action.performedAt }),
  };
}

export async function pushCaseAction(caseRow, action) {
  if (!isUcatConfigured()) return null;

  const fields = await buildFields(caseRow, action);

  if (action.ucatId) {
    const patched = await request(`/cases/${action.ucatId}`, "PATCH", fields);
    return patched ? action.ucatId : null;
  }

  const created = await request("/cases", "POST", fields);
  return created?.id ?? null;
}

export async function deleteCaseFromUcat(ucatId) {
  if (!isUcatConfigured() || !ucatId) return false;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(`${UCAT_URL}/cases/${ucatId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`UCAT DELETE /cases/${ucatId} failed: ${res.status} ${await res.text()}`);
      }
      return true;
    } catch (e) {
      if (attempt === RETRIES - 1) {
        console.error(`[ucat] DELETE /cases/${ucatId} failed after retries:`, e.message);
        return false;
      }
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }
}
