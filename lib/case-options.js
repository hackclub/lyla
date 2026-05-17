import { db } from "./db.js";
import { cases, caseThreads } from "../db/schema.js";
import { eq, and, ne, sql, desc, asc } from "drizzle-orm";

function optionLabel(caseNumber, snippet) {
  const clean = snippet ? snippet.replace(/\.\.\.$/, "") : null;
  const full = clean ? `#${caseNumber}: ${clean}` : `#${caseNumber}`;
  return full.length > 75 ? full.slice(0, 74) + "…" : full;
}

async function queryCases(query) {
  const stripped = query.trim().replace(/^#/, "");
  const isSearch = stripped !== "" && !isNaN(Number(stripped));

  const rows = await db
    .select({ caseNumber: cases.caseNumber, snippet: caseThreads.snippet })
    .from(cases)
    .leftJoin(
      caseThreads,
      and(eq(caseThreads.caseNumber, cases.caseNumber), eq(caseThreads.isPrimary, true))
    )
    .where(
      isSearch
        ? and(
            ne(cases.status, "merged"),
            sql`CAST(${cases.caseNumber} AS TEXT) LIKE ${stripped + "%"}`
          )
        : eq(cases.status, "open")
    )
    .orderBy(isSearch ? desc(cases.caseNumber) : asc(cases.createdAt))
    .limit(10);

  return rows.map((r) => ({
    text: { type: "plain_text", text: optionLabel(r.caseNumber, r.snippet) },
    value: String(r.caseNumber),
  }));
}

// Build a single option object for a known case number (used for initial_option prefills).
export async function caseOption(caseNumber) {
  const rows = await db
    .select({ snippet: caseThreads.snippet })
    .from(caseThreads)
    .where(and(eq(caseThreads.caseNumber, caseNumber), eq(caseThreads.isPrimary, true)))
    .limit(1);
  const snippet = rows[0]?.snippet ?? null;
  return {
    text: { type: "plain_text", text: optionLabel(caseNumber, snippet) },
    value: String(caseNumber),
  };
}

export function registerCaseOptions(app) {
  app.options("case_select", async ({ options, ack }) => {
    try {
      const opts = await queryCases(options.value ?? "");
      await ack({ options: opts });
    } catch (e) {
      console.error("case_select options error:", e);
      await ack({ options: [] });
    }
  });
}
