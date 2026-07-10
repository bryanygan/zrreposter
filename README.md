# zrreposter

Discord bot that copies forum listings between two servers with `/bulkrepost`.

## Setup

1. `npm install`
2. Ensure `.env` has `DISCORD_APPLICAION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`.
3. In the Discord Developer Portal → your app → Bot: enable the **Message Content Intent** (privileged).
4. Invite the bot to **both** servers with permissions: View Channels, Read Message History, Send Messages, Create Public Threads, Send Messages in Threads.
5. Register the command: `npm run deploy`
6. Start the bot: `npm start`

## Usage

In either server, run `/bulkrepost from_server:<name> to_server:<name>`.
Optionally add `include_archived:true` to also scan archived posts.
The bot shows a preview of what will be copied and waits for you to click **Confirm** (60s timeout), then reports how many were copied / skipped / errored.

## Configured servers

- `closetclearout` and `zrserver` (see `config.js`).

## Tests

`npm test`
