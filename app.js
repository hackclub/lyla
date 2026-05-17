import { App } from "@slack/bolt";
import schedule from "node-schedule";

import { isDev, PORT } from "./lib/config.js";
import { runMigrations } from "./lib/db.js";

import registerReactionAdded from "./events/reaction-added.js";
import registerOpenConductModal from "./actions/open-conduct-modal.js";
import registerClaimCase from "./actions/claim-case.js";
import registerConductReportView from "./views/conduct-report.js";
import registerEditAssigneesView from "./views/edit-assignees.js";
import registerPrevReports from "./commands/prevreports.js";
import registerAssignees from "./commands/assignees.js";
import registerMerge from "./commands/merge.js";
import {
  register as registerStickyPending,
  requestUpdate,
  requestReposition,
} from "./jobs/sticky-pending.js";

import checkBansForToday from "./jobs/check-bans-for-today.js";
import checkPendingThreads from "./jobs/check-pending-threads.js";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: isDev,
  port: PORT,
});

registerReactionAdded(app);
registerOpenConductModal(app);
registerClaimCase(app);
registerConductReportView(app);
registerEditAssigneesView(app);
registerPrevReports(app);
registerAssignees(app);
registerMerge(app);
registerStickyPending(app);

(async () => {
  await runMigrations();
  await app.start();
  console.log("⚡️ Bolt app is running!");
  requestUpdate();

  schedule.scheduleJob(
    {
      hour: 7,
      minute: 0,
      tz: "America/New_York",
    },
    async () => {
      await checkBansForToday();
      requestReposition();
    }
  );

  schedule.scheduleJob("*/30 * * * * *", async () => {
    await checkPendingThreads();
  });
})();
