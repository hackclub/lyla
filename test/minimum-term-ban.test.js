import test from "node:test";
import assert from "node:assert/strict";
import { buildConductModalBlocks } from "../lib/blocks.js";
import { buildAnnouncementMessage } from "../views/conduct-report.js";

test("conduct report modal offers a minimum-term indefinite ban", () => {
  const blocks = buildConductModalBlocks("U123");
  const logType = blocks.find((block) => block.block_id === "log_type");
  assert.deepEqual(
    logType.element.options.find((option) => option.value === "indef_ban_minimum"),
    {
      text: { type: "plain_text", text: "Indef Ban w/ Minimum Term" },
      value: "indef_ban_minimum",
    }
  );
});

test("minimum-term announcement includes duration and eligibility date", () => {
  assert.equal(
    buildAnnouncementMessage({
      logType: "indef_ban_minimum",
      userMention: "<@U123>",
      banDate: "2026-11-12",
      now: new Date("2026-09-12T21:00:00Z"),
      isShush: false,
    }),
    "<@U123> has been indefinitely banned for a minimum of 2 months (eligible for appeal/review on 12 Nov 2026)... be good kids ^^"
  );
});

test("existing announcement variants keep their wording", () => {
  assert.equal(
    buildAnnouncementMessage({
      logType: "temp",
      userMention: "<@U123>",
      banDate: "2026-09-20",
      now: new Date("2026-09-12T21:00:00Z"),
      isShush: true,
    }),
    "<@U123> has been shushed until 20 Sept 2026... be good kids ^^"
  );
});
