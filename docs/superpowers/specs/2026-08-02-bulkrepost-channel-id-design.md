# /bulkrepost — Explicit Channel ID Inputs

**Date:** 2026-08-02
**Status:** Approved design

## Purpose

`/bulkrepost` currently resolves the source and destination forum channel from a fixed
`forumChannelId` baked into `config.js` per server name. The operator wants to instead
type in the specific forum channel ID to read from and post to each time, within either
of the two servers `/bulkrepost` already supports (`zrserver`, `closetclearout`).

## Scope

- **In scope:** `/bulkrepost` command definition and its handler in `index.js`.
- **Out of scope:** `/testbulkrepost` (unchanged — keeps using the fixed `forumChannelId`
  per server from `config.js`). `config.js` itself is unchanged.

## Change

### Command definition (`commands.js`)

`/bulkrepost` gains two new **required** string options, added after `to_server`:

- `from_channel_id` — forum channel ID to read source posts from.
- `to_channel_id` — forum channel ID to post reposts into.

`from_server` / `to_server` remain required dropdowns (unchanged choices: `closetclearout`,
`zrserver`) — they're still needed to resolve which **guild** to look in.

Only `/bulkrepost` gets these new options; `/testbulkrepost`'s definition is untouched.
Since `buildCommands()` currently applies the same option set to every command in
`COMMANDS`, it needs a per-command branch so the two new options are only added when
`cmdName === 'bulkrepost'`.

### Handler (`index.js`, `handleBulkRepost`)

- Read the two new options: `interaction.options.getString('from_channel_id', true)` and
  `to_channel_id` likewise.
- `from` / `to` (looked up via `SERVERS[fromName]` / `SERVERS[toName]`) are still used for
  `serverId` (guild lookup) only — `forumChannelId` on those objects is no longer read by
  this handler.
- `getForumChannel(from.serverId, fromChannelId)` and `getForumChannel(to.serverId,
  toChannelId)` replace the old `from.forumChannelId` / `to.forumChannelId` calls.
- No new validation: an invalid/inaccessible channel ID already surfaces through the
  existing try/catch around `getForumChannel` ("Could not access a forum channel: ...").

## Error Handling

Unchanged except for the source of the channel ID: existing checks (`fromName === toName`,
unknown server selection, forum-channel-fetch failure) all still apply. A bad channel ID
(wrong ID, bot lacks access, or channel isn't a forum) is caught by the existing
`getForumChannel` try/catch and reported the same way as today.

## Testing

- **Unit (`commands.test.js`):** `/bulkrepost`'s built command JSON includes
  `from_channel_id` and `to_channel_id` as required string options; `/testbulkrepost`'s
  does not.
- **Manual:** Run `/bulkrepost` against real channel IDs in zrserver/closetclearout,
  confirm the preview and repost still work end-to-end with an explicitly-typed channel ID.
