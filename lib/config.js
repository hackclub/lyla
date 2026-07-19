try {
  process.loadEnvFile();
} catch (e) {
  console.log("No .env file found, proceeding with existing environment variables");
}

const isDev = process.env.NODE_ENV === "development";
const isDemoMode = process.env.DEMO_MODE === "true";

const ALLOWED_CHANNELS = (process.env.ALLOWED_CHANNELS || "")
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);
const FIREHOUSE_CHANNEL = process.env.FIREHOUSE_CHANNEL;
const LOG_CHANNEL = process.env.LOG_CHANNEL;
const NOTIF_CHANNEL = process.env.NOTIF_CHANNEL;

const PORT = process.env.PORT || 3000;

export { isDev, isDemoMode, ALLOWED_CHANNELS, FIREHOUSE_CHANNEL, LOG_CHANNEL, NOTIF_CHANNEL, PORT };
