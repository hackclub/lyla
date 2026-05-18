import { WebClient } from "@slack/web-api";
import Airtable from "airtable";

const botClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const userClient = new WebClient(process.env.SLACK_USER_TOKEN);

const base =
  process.env.AIRTABLE_PAT && process.env.AIRTABLE_BASE_ID
    ? new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID)
    : null;

export { botClient, userClient, base };
