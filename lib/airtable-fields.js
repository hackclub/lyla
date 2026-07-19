const DATA_FIELD_MAP = {
  "What Did User Do": "whatTheyDid",
  "Display Name": "displayName",
  Email: "email",
  "If Banned, Until When": "banUntil",
  channel_ban_channel: "channelBanChannel",
  "Link To Message": "permalink",
};

export function mapAirtableFields(fields) {
  const result = {};

  if (fields["User Being Dealt With"]) {
    result.targetUserId = fields["User Being Dealt With"];
  }
  if (fields["Dealt With By"] !== undefined) {
    result.performedBy = (fields["Dealt With By"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (fields["How Was This Resolved"]) {
    result.actionType = fields["How Was This Resolved"];
  }

  const data = {};
  for (const [airtableKey, dataKey] of Object.entries(DATA_FIELD_MAP)) {
    if (fields[airtableKey] !== undefined) {
      data[dataKey] = fields[airtableKey] || null;
    }
  }
  if (Object.keys(data).length > 0) result.data = data;

  return result;
}

export function toAirtableFields(row) {
  const fields = {};

  if (row.targetUserId) fields["User Being Dealt With"] = row.targetUserId;
  if (row.performedBy?.length) fields["Dealt With By"] = row.performedBy.join(", ");
  if (row.actionType) fields["How Was This Resolved"] = row.actionType;

  const data = row.data ?? {};
  for (const [airtableKey, dataKey] of Object.entries(DATA_FIELD_MAP)) {
    if (data[dataKey] !== undefined) fields[airtableKey] = data[dataKey];
  }

  return fields;
}
