try {
  process.loadEnvFile();
} catch (e) {
  console.log("No .env file found, proceeding with existing environment variables");
}

const isDev = process.env.NODE_ENV === "development";
const devChannel = process.env.DEV_CHANNEL;

const ALLOWED_CHANNELS = isDev ? [devChannel] : ["G01DBHPLK25", "C07FL3G62LF", "C07UBURESHZ"];

const NOTIF_CHANNEL = isDev ? devChannel : "C085UEFDW6R";

const PORT = process.env.PORT || 3000;

module.exports = {
  isDev,
  devChannel,
  ALLOWED_CHANNELS,
  NOTIF_CHANNEL,
  PORT,
};
