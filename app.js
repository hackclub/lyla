import { App } from "@slack/bolt";
import http from "http";
import schedule from "node-schedule";

import {
  isDev,
  PORT,
  FIREHOUSE_CHANNEL,
  LOG_CHANNEL,
  NOTIF_CHANNEL,
  ALLOWED_CHANNELS,
} from "./lib/config.js";
import { runMigrations } from "./lib/db.js";
import { seedInfractionCategories } from "./lib/infraction-categories.js";

import registerReactionAdded from "./events/reaction-added.js";
import registerOpenConductModal from "./actions/open-conduct-modal.js";
import registerClaimCase from "./actions/claim-case.js";
import registerCaseInfoActions from "./actions/case-info.js";
import registerEditCaseAction from "./actions/edit-case-action.js";
import registerUserNotesActions from "./actions/user-notes.js";
import registerUserInfoActions from "./actions/user-info.js";
import registerConductReportView from "./views/conduct-report.js";
import registerEditCaseActionView from "./views/edit-case-action.js";
import registerEditAssigneesView from "./views/edit-assignees.js";
import registerCaseInfoView from "./views/case-info.js";
import registerUserNotesView from "./views/user-notes.js";
import registerEditUserNoteView from "./views/edit-user-note.js";
import registerAssignees from "./commands/assignees.js";
import registerMerge from "./commands/merge.js";
import registerCase from "./commands/case.js";
import registerNotes from "./commands/notes.js";
import registerInfo from "./commands/info.js";
import registerMergeView from "./views/merge.js";
import { registerCaseOptions } from "./lib/case-options.js";
import {
  register as registerStickyPending,
  requestUpdate,
  requestReposition,
} from "./jobs/sticky-pending.js";

import checkBansForToday from "./jobs/check-bans-for-today.js";
import checkPendingThreads from "./jobs/check-pending-threads.js";
import syncUnsyncedCaseActions from "./jobs/sync-unsynced-case-actions.js";
import {
  ensureWebhook,
  refreshWebhook,
  verifyMac,
  processNewPayloads,
} from "./lib/airtable-webhook.js";

const REQUIRED_CHANNEL_VARS = { FIREHOUSE_CHANNEL, LOG_CHANNEL, NOTIF_CHANNEL };
const missingChannelVars = Object.entries(REQUIRED_CHANNEL_VARS)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (ALLOWED_CHANNELS.length === 0) missingChannelVars.push("ALLOWED_CHANNELS");

if (missingChannelVars.length > 0) {
  console.error(
    `Missing required env var(s): ${missingChannelVars.join(", ")}. Refusing to start. See .env.example.`
  );
  process.exit(1);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleAirtableWebhook(req, res) {
  const rawBody = await readRawBody(req);
  const macHeader = req.headers["x-airtable-content-mac"];
  const valid = await verifyMac(rawBody, macHeader);

  if (!valid) {
    console.error("[airtable-webhook] rejected ping: invalid or missing MAC");
    res.writeHead(401);
    res.end();
    return;
  }

  res.writeHead(200);
  res.end();
  processNewPayloads().catch((error) => {
    console.error("[airtable-webhook] processNewPayloads failed:", error.message);
  });
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: isDev,
  port: PORT,
  ...(isDev
    ? {}
    : {
        customRoutes: [
          {
            path: "/airtable-webhook",
            method: ["POST"],
            handler: handleAirtableWebhook,
          },
        ],
      }),
});

registerReactionAdded(app);
registerOpenConductModal(app);
registerClaimCase(app);
registerCaseInfoActions(app);
registerEditCaseAction(app);
registerUserNotesActions(app);
registerUserInfoActions(app);
registerConductReportView(app);
registerEditCaseActionView(app);
registerEditAssigneesView(app);
registerCaseInfoView(app);
registerUserNotesView(app);
registerEditUserNoteView(app);
registerAssignees(app);
registerMerge(app);
registerCase(app);
registerNotes(app);
registerInfo(app);
registerMergeView(app);
registerCaseOptions(app);
registerStickyPending(app);

if (isDev && process.env.AIRTABLE_WEBHOOK_URL) {
  http
    .createServer((req, res) => {
      if (req.method === "POST" && req.url === "/airtable-webhook") {
        handleAirtableWebhook(req, res).catch((error) => {
          console.error("[airtable-webhook] handler failed:", error.message);
          res.writeHead(500);
          res.end();
        });
        return;
      }
      res.writeHead(404);
      res.end();
    })
    .listen(PORT, () => {
      console.log(`[airtable-webhook] dev listener on :${PORT}`);
    });
}

(async () => {
  await runMigrations();
  await seedInfractionCategories();
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

  await syncUnsyncedCaseActions();
  schedule.scheduleJob("*/15 * * * *", async () => {
    await syncUnsyncedCaseActions();
  });

  await ensureWebhook().catch((error) => {
    console.error("[airtable-webhook] ensureWebhook failed:", error.message);
  });
  await processNewPayloads().catch((error) => {
    console.error("[airtable-webhook] boot catch-up failed:", error.message);
  });
  schedule.scheduleJob("*/2 * * * *", async () => {
    await processNewPayloads().catch((error) => {
      console.error("[airtable-webhook] backstop poll failed:", error.message);
    });
  });
  schedule.scheduleJob("0 3 * * *", async () => {
    await refreshWebhook();
  });
})();
