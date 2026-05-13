const { App } = require("@slack/bolt");
const schedule = require("node-schedule");

const { isDev, PORT } = require("./lib/config");

const registerReactionAdded = require("./events/reaction-added");
const registerOpenConductModal = require("./actions/open-conduct-modal");
const registerConductReportView = require("./views/conduct-report");
const registerPrevReports = require("./commands/prevreports");

const checkBansForToday = require("./jobs/check-bans-for-today");
const checkPendingThreads = require("./jobs/check-pending-threads");

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

(async () => {
  await app.start();
  console.log("⚡️ Bolt app is running!");

  schedule.scheduleJob(
    {
      hour: 7,
      minute: 0,
      tz: "America/New_York",
    },
    async () => {
      await checkBansForToday(app.client);
    }
  );

  schedule.scheduleJob("*/30 * * * * *", async () => {
    await checkPendingThreads(app.client);
  });
})();
