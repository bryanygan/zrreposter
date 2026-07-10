# zrreposter

Discord bot that copies forum listings between servers with `/bulkrepost`
(and `/testbulkrepost` for testing against extra servers).

## Setup (local)

1. `npm install`
2. Ensure `.env` has `DISCORD_APPLICAION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`.
3. In the Discord Developer Portal → your app → Bot: enable the **Message Content Intent** (privileged).
4. Invite the bot to every server you want to use it in, with permissions: View Channels, Read Message History, Send Messages, Create Public Threads, Send Messages in Threads.
5. Start the bot: `npm start` — it registers the slash commands automatically on startup.
   - To register commands without starting the bot: `npm run deploy`.
   - To disable auto-registration on startup: set env `REGISTER_COMMANDS_ON_START=false`.

## Usage

- `/bulkrepost from_server:<name> to_server:<name>` — options: `closetclearout`, `zrserver`.
- `/testbulkrepost from_server:<name> to_server:<name>` — options: `replinks`, `prinsale`, `zrserver`, `closetclearout`.

Optionally add `include_archived:true` to also scan archived posts.
The bot shows a preview of what will be copied and waits for you to click **Confirm** (60s timeout), then reports how many were copied / skipped / errored.

## Deploy on Railway

1. Push this repo to GitHub and create a Railway project from it.
2. In Railway → your service → **Variables**, set: `DISCORD_APPLICAION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`. (Do **not** commit `.env` — it is git-ignored.)
3. Deploy. Railway runs `npm start` (see `railway.json`); the bot connects to Discord and auto-registers its slash commands on startup — no separate deploy step needed.
4. Railway assigns a `PORT`; the bot starts a small HTTP liveness endpoint on it. No public domain is required for the bot to work.

## Configured servers

See `config.js` (`SERVERS`) and which servers each command offers (`COMMANDS`).

## Tests

`npm test`
