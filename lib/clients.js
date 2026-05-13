import { WebClient } from "@slack/web-api";
import Airtable from "airtable";

const userClient = new WebClient(process.env.SLACK_USER_TOKEN);

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);

export { userClient, base };
