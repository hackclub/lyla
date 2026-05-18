# AGENTS.md

This file provides guidance to agents when working with code in this repository.

LYLA is a Slack bot for Hack Club's Fire Department (moderation team). It manages moderation **cases** (records of conduct incidents) with Slack as the UI and PostgreSQL as the data store. Cases map to Slack threads; the bot tracks who's handling what, logs actions, and maintains a live "open cases" sticky message in #hq-firehouse.

```bash
npm run dev # Development mode: Socket Mode + file watching, assume running in the background
npm run format # Prettier formatting, call this after editing files
node app.js # Production (HTTP mode, not Socket Mode)
```

The JavaScript code uses the following Prettier configuration:

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

Closely follow existing code style and patterns. Ensure any async calls are efficient (using Promise.all where appropriate) and program defensively (ignoring errors for things like non-essential log messages, using optional chaining, etc). Ensure that every command, modal, etc. uses the `isAuthorized()` function from `lib/auth.js` to check permissions before doing anything else.

Database migrations run automatically on startup via `runMigrations()` in `lib/db.js`. Use `drizzle-kit` for schema changes (ask the user to run `npx drizzle-kit generate` after you change the schema, don't do it yourself).

`manifest.yml` defines all scopes, slash commands, and event subscriptions. If you add a new command or need a new scope, update this file and instruct the user to reinstall the app. `tmp-manifest.yml`, if present, is the manifest for the user's development app. Whever you update `manifest.yml`, also update `tmp-manifest.yml` to keep them in sync. The only difference should be the names (app, commands, etc) and HTTP vs Socket Mode. Development commands must have a `*dev-` prefix to avoid conflicts with production commands, and the command registration must have a regex like `/^\/(.*dev-)?lyla-command$/` to allow this.

Be cautious of user-generated text being put in mrkdwn. Use the appropriate functions from `lib/slack.js` to sanitize and process it first. Use `\u200c` (zero-width non-breaking space) after the `#` in case numbers to prevent Slack from auto-linking them as channels (always in escape form, don't put that unicode character directly in code).
