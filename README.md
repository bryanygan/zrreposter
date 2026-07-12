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

Optional flags:
- `include_archived:true` — also scan archived posts.
- `posted_after:<value>` — only repost posts created after this point. Accepts a duration relative to now (`50h`, `2d`, `90 min`, `1w`) or a date (`07/07`, `07/07/2025`, `2026-07-07`). Dates mean midnight US Eastern (DST-aware); override the zone with the `TIMEZONE` env var (any IANA name, e.g. `America/Los_Angeles` or `UTC`).

The bot shows a preview of what will be copied and waits for you to click **Confirm** (60s timeout), then reports how many were copied / skipped / errored.

Only authorized users may run the commands (see `ALLOWED_USER_IDS` below).

### Goofish link cleaner

In one watched channel the bot auto-detects messy Goofish (闲鱼) listing links — `ssr.m.goofish.com` SSR pages, `h5.m.goofish.com` share links full of tracking params, and `www.goofish.com` desktop links — and replies with the short canonical form for each, e.g. `https://h5.m.goofish.com/item?id=1058488603283`. Multiple links in one message are all cleaned and de-duplicated by listing id. Replies are wrapped in `<>` to suppress Discord's link-preview embeds. The watched channel defaults to the `replinks` server's links channel; override with `GOOFISH_WATCH_GUILD_ID` / `GOOFISH_WATCH_CHANNEL_ID`.

### Images

All of a post's images are placed in the single initial thread message. If a post's images already fit under the size limit, they are copied untouched (no quality loss). If they exceed it, images are re-encoded to high-quality progressive JPEG (mozjpeg, with a dimension cap) — stepping down only as far as needed to fit — so nothing is dropped and quality stays high. JPEG is used rather than WebP because Discord tags animated-WebP as "GIF", which hides the forum preview image. Real GIFs pass through untouched so their animation is preserved. To allow larger, higher-quality images, boost the destination server and raise `MAX_UPLOAD_BYTES`.

## Optional environment variables

- `ALLOWED_USER_IDS` — comma-separated Discord user IDs allowed to run the commands. If unset, defaults to the two built-in IDs. Example: `ALLOWED_USER_IDS=111...,222...`
- `MAX_UPLOAD_BYTES` — target max bytes per uploaded message. Defaults to ~9 MB (safe for non-boosted servers). Raise it if the destination server is boosted (e.g. `52428800` for 50 MB). The bot self-corrects on oversized batches regardless.
- `REGISTER_COMMANDS_ON_START` — set to `false` to skip auto-registering slash commands on startup.
- `TIMEZONE` — IANA timezone used to interpret `posted_after` dates. Defaults to `America/New_York`.
- `GOOFISH_WATCH_GUILD_ID` / `GOOFISH_WATCH_CHANNEL_ID` — server and channel where the bot auto-cleans Goofish links. Default to the `replinks` server's links channel.

## Deploy on Railway

1. Push this repo to GitHub and create a Railway project from it.
2. In Railway → your service → **Variables**, set: `DISCORD_APPLICAION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`. (Do **not** commit `.env` — it is git-ignored.)
3. Deploy. Railway runs `npm start` (see `railway.json`); the bot connects to Discord and auto-registers its slash commands on startup — no separate deploy step needed.
4. Railway assigns a `PORT`; the bot starts a small HTTP liveness endpoint on it. No public domain is required for the bot to work.

## Configured servers

See `config.js` (`SERVERS`) and which servers each command offers (`COMMANDS`).

## Tests

`npm test`
