try {
  process.loadEnvFile();
} catch (e) {
  console.log("No .env file found, proceeding with existing environment variables");
}

const isDev = process.env.NODE_ENV === "development";
const isDemoMode = process.env.DEMO_MODE === "true";
const devChannel = process.env.DEV_CHANNEL;

const devLogChannel = process.env.DEV_LOG_CHANNEL;

// hq-firehouse, firehouse-logs, lou-bot-testing, shroud-logs
const ALLOWED_CHANNELS = isDev
  ? [devChannel, devLogChannel].filter(Boolean)
  : ["G01DBHPLK25", "C07FL3G62LF", "C07UBURESHZ", "C0BE6N4G2BA"];
const FIREHOUSE_CHANNEL = isDev ? devChannel : "G01DBHPLK25";
const LOG_CHANNEL = isDev ? devLogChannel : "C07FL3G62LF";

// community-logs
const NOTIF_CHANNEL = isDev ? devChannel : "C085UEFDW6R";

const PORT = process.env.PORT || 3000;

export {
  isDev,
  isDemoMode,
  devChannel,
  ALLOWED_CHANNELS,
  FIREHOUSE_CHANNEL,
  LOG_CHANNEL,
  NOTIF_CHANNEL,
  PORT,
};
