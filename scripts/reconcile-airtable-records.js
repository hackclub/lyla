import "../lib/config.js";
import { base } from "../lib/clients.js";
import { db } from "../lib/db.js";
import { cases, caseActions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { mapAirtableFields } from "../lib/airtable-fields.js";
import {
  getCaseActionByAirtableRecordId,
  getCaseActionsByTargetUserId,
} from "../lib/case-tracker.js";

const TABLE_NAME = "LYLA Records";

function parseDate(value, fallbackIso) {
  const d = value ? new Date(value) : fallbackIso ? new Date(fallbackIso) : null;
  const ms = d?.getTime();
  return Number.isFinite(ms) ? ms : Date.now();
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
  console.log(`Found ${records.length} records in "${TABLE_NAME}"`);

  let alreadyReconciled = 0;
  let matched = 0;
  let created = 0;
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
      await db
        .update(caseActions)
        .set({ airtableRecordId: record.id })
        .where(eq(caseActions.id, match.id));
      matched++;
      continue;
    }

    const performedAt = parseDate(record.fields["Time Of Report"], record._rawJson.createdTime);

    const [newCase] = await db
      .insert(cases)
      .values({
        status: "resolved",
        createdAt: performedAt,
        resolvedAt: performedAt,
        resolvedBy: mapped.performedBy?.[0] ?? null,
        resolutionKind: "resolved",
      })
      .returning();

    await db.insert(caseActions).values({
      caseNumber: newCase.caseNumber,
      actionType: mapped.actionType || "unknown",
      targetUserId: mapped.targetUserId,
      performedBy: mapped.performedBy?.length ? mapped.performedBy : ["unknown"],
      data: mapped.data ?? {},
      performedAt,
      airtableRecordId: record.id,
    });

    created++;
    console.log(`Created case #${newCase.caseNumber} for ${record.id}`);
  }

  console.log(
    `Done. ${alreadyReconciled} already reconciled, ${matched} matched, ${created} created, ${ambiguous} ambiguous, ${skippedNoUser} skipped (no target user).`
  );
}

main().then(() => process.exit(0));
