import { App } from "@slack/bolt";
import schedule from "node-schedule";

import { isDev, PORT } from "./lib/config.js";

import registerReactionAdded from "./events/reaction-added.js";
import registerOpenConductModal from "./actions/open-conduct-modal.js";
import registerConductReportView from "./views/conduct-report.js";
import registerPrevReports from "./commands/prevreports.js";
import { register as registerStickyPending, requestUpdate } from "./jobs/sticky-pending.js";

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
registerConductReportView(app);
registerPrevReports(app);
registerStickyPending(app);

(async () => {
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
    }
  );

  schedule.scheduleJob("*/30 * * * * *", async () => {
    await checkPendingThreads();
  });
})();
