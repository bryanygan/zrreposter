# zrreposter — Discord Forum Repost Bot

**Date:** 2026-07-10
**Status:** Approved design

## Purpose

A Discord bot that copies forum listings from one server's forum channel to another
server's forum channel, preserving each post's title, starter-message text, and image
attachments. Used by a single operator across two known servers to mirror listings.

## Scope

- **In scope:** Copy the starter post (title + text + image/file attachments) of each
  forum thread from a source forum channel to a destination forum channel, skipping
  duplicates, with a confirmation preview before posting.
- **Out of scope:** Copying forum tags, copying reply messages (starter post only),
  copying reactions, editing/deleting previously reposted content, and any server other
  than the two configured.

## Stack

- Node.js
- discord.js v14
- Credentials loaded from `.env` (already present): `DISCORD_APPLICAION_ID` (note: this
  is the exact key spelling in the existing file), `DISCORD_PUBLIC_KEY`,
  `DISCORD_BOT_TOKEN`.

## Configuration

`config.js` exports a map of server **name** → server metadata:

```js
{
  closetclearout: { serverId: "1149124608964952065", forumChannelId: "1162475530109595869" },
  zrserver:       { serverId: "1108034288366125068", forumChannelId: "1496003997788799026" },
}
```

Only these two entries exist. Adding a server later is a one-line addition here.

## The `/bulkrepost` Slash Command

Registered via a standalone `deploy-commands.js` script (run once, and again whenever the
command definition changes).

**Options:**

- `from_server` — string, **required**, choices: `closetclearout`, `zrserver`.
- `to_server` — string, **required**, choices: `closetclearout`, `zrserver`.
- `include_archived` — boolean, **optional**, default `false`.

## Interaction Flow

1. **Defer.** Call `interaction.deferReply()` immediately (bulk work exceeds Discord's
   3-second response window).
2. **Resolve.** Look up `from_server` and `to_server` in the config map to get their forum
   channel IDs. If a name is missing from the map (should not happen given fixed choices),
   or `from_server === to_server`, edit the reply with a clear error and stop.
3. **Gather source threads.** Fetch **active** threads from the source forum channel. If
   `include_archived` is true, also fetch archived threads. (Forum listings auto-archive
   over time, so the archived fetch is what enables backfilling older posts.)
4. **Gather destination titles.** Fetch active **and** archived threads from the
   destination forum channel; build a set of their titles, normalized (trimmed,
   lowercased) for duplicate comparison.
5. **Classify.** For each source thread, sort oldest→newest by creation time. A thread is
   a **duplicate** if its normalized title is already in the destination title set;
   otherwise it is **new**.
6. **Preview + confirm.** `editReply()` with:
   - A list of the **new** posts to be reposted — each line showing the (truncated) title
     and its image/attachment count.
   - A count of posts skipped as duplicates.
   - If the list is long, cap displayed lines and append "…and N more" to stay under
     Discord's 2000-character message limit.
   - Two buttons: **Confirm** and **Cancel**.
   - If there are zero new posts, skip the buttons and just report "nothing new to repost."
7. **Await decision.** Use a message component collector scoped to the original invoking
   user, with a 60-second timeout.
   - **Confirm:** proceed to repost (step 8).
   - **Cancel or timeout:** edit the message to say nothing was posted; disable buttons.
8. **Repost.** For each new source thread, oldest→newest:
   - Fetch the starter message (`thread.fetchStarterMessage()`).
   - Download each image/file attachment from its source URL and re-upload it (so the file
     lives on the destination, not hot-linked from the source).
   - Create a new forum thread in the destination channel with `name` = source title,
     message `content` = starter text, and `files` = the re-uploaded attachments.
   - Wrap each post in try/catch so one failure does not abort the run; count failures.
9. **Summary.** `editReply()` (or follow-up) with the final tally: **X copied, Y skipped as
   duplicates, Z errors.**

## Modules

- **`config.js`** — server name → `{ serverId, forumChannelId }` map. No logic.
- **`deploy-commands.js`** — builds the `/bulkrepost` command definition and registers it
  with Discord via REST. Standalone script.
- **`repost.js`** — pure-ish core logic, decoupled from the interaction lifecycle:
  - `normalizeTitle(title)` → normalized string for comparison.
  - `classifyThreads(sourceThreads, destinationTitleSet)` → `{ toRepost, duplicates }`.
  - `buildPreview(toRepost, duplicateCount)` → preview message string (with truncation /
    capping).
  - `repostThread(destForumChannel, sourceThread)` → performs one copy (fetch starter,
    re-upload attachments, create thread). Returns success/failure.
  - These take plain data / channel objects so they can be unit-tested with mocks.
- **`index.js`** — creates the discord.js client with required intents, logs in, and on
  `interactionCreate` for `/bulkrepost` orchestrates the flow above, calling into
  `repost.js`.

## Discord Requirements / Caveats

- The bot must be **invited to both servers** with permissions: View Channels, Read
  Message History (source), and Create Public Threads / Send Messages in Threads
  (destination forum).
- The **Message Content intent** must be enabled in the Discord Developer Portal and
  requested by the client — required to read starter-post text.
- Required gateway intents: `Guilds` (thread metadata) and `MessageContent` (starter
  text). Attachment URLs are available on the fetched starter message without additional
  intents.
- Rate limiting is handled by discord.js automatically; per-post creation is sequential to
  stay well within limits.

## Duplicate Semantics

- Match is by **normalized title only** (trim + lowercase), exact after normalization.
- Comparison is against the destination forum's active **and** archived threads, so
  re-running the command will not create copies of posts already mirrored.

## Testing

- **Unit (`repost.js`):** `normalizeTitle` edge cases (whitespace, case); `classifyThreads`
  correctly partitions new vs. duplicate; `buildPreview` truncation and capping behavior;
  attachment mapping shape. Discord objects are mocked.
- **Manual:** End-to-end run against the two real servers — verify preview accuracy,
  confirm/cancel behavior, correct titles/text/images on the destination, and duplicate
  skipping on a second run.

## Error Handling

- Missing/invalid server resolution → clear error reply, no work done.
- `from_server === to_server` → rejected before any fetching.
- Per-post failure during repost → caught, counted, does not abort remaining posts.
- Confirmation timeout → treated as cancel; nothing posted.
