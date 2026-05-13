const { WebClient } = require("@slack/web-api");
const Airtable = require("airtable");

const userClient = new WebClient(process.env.SLACK_USER_TOKEN);

const base = new Airtable({ apiKey: process.env.AIRTABLE_PAT }).base(process.env.AIRTABLE_BASE_ID);

module.exports = {
  userClient,
  base,
};
