# zrreposter Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Discord bot with a `/bulkrepost` command that copies forum listings (title, starter text, images) from one configured server's forum channel to another, skipping duplicates, with a confirmation preview.

**Architecture:** discord.js v14 client. Pure, unit-tested logic (title normalization, dedup classification, attachment collection, payload/preview building) lives in `lib/repost.js`. Discord I/O (fetching threads, confirmation buttons, creating forum posts) lives in `index.js`. Slash-command registration is a standalone `deploy-commands.js` script. A small `config.js` maps server names to server + forum-channel IDs.

**Tech Stack:** Node.js 20, discord.js ^14, dotenv, `node:test` (built-in) for unit tests. CommonJS modules.

## Global Constraints

- Node.js 18+ (dev/prod uses Node 20). CommonJS (`require`/`module.exports`).
- discord.js `^14`, dotenv `^16`. No other runtime deps. Tests use built-in `node:test` + `node:assert` — no test framework dependency.
- Env keys, verbatim from existing `.env`: `DISCORD_APPLICAION_ID` (this exact misspelling — missing "N"), `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`.
- Two servers only: `closetclearout` = server `1149124608964952065`, forum `1162475530109595869`; `zrserver` = server `1108034288366125068`, forum `1496003997788799026`.
- Copy **starter post only** (title + text + attachments). **No tags.** Duplicate = same **normalized title** (trimmed + lowercased). Repost order: **oldest → newest**.
- Discord limits: forum thread `name` ≤ 100 chars, message `content` ≤ 2000 chars.
- `.env` is git-ignored and must never be committed.

---

### Task 1: Project scaffold & config

**Files:**
- Create: `package.json`
- Create: `config.js`
- Test: `config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.js` exports `SERVERS`, an object keyed by server name → `{ serverId: string, forumChannelId: string }`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "zrreposter",
  "version": "1.0.0",
  "description": "Discord bot to repost forum listings between servers",
  "main": "index.js",
  "type": "commonjs",
  "scripts": {
    "start": "node index.js",
    "deploy": "node deploy-commands.js",
    "test": "node --test"
  },
  "dependencies": {
    "discord.js": "^14.16.3",
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `discord.js` and `dotenv` present, no errors. (`node_modules/` is already git-ignored.)

- [ ] **Step 3: Create `config.js`**

```js
const SERVERS = {
  closetclearout: {
    serverId: '1149124608964952065',
    forumChannelId: '1162475530109595869',
  },
  zrserver: {
    serverId: '1108034288366125068',
    forumChannelId: '1496003997788799026',
  },
};

module.exports = { SERVERS };
```

- [ ] **Step 4: Write the config test**

Create `config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { SERVERS } = require('./config');

test('config has both servers with ids', () => {
  assert.deepStrictEqual(Object.keys(SERVERS).sort(), ['closetclearout', 'zrserver']);
  for (const name of Object.keys(SERVERS)) {
    assert.match(SERVERS[name].serverId, /^\d+$/);
    assert.match(SERVERS[name].forumChannelId, /^\d+$/);
  }
});
```

- [ ] **Step 5: Run the test**

Run: `npm test`
Expected: PASS (1 test passing).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json config.js config.test.js
git commit -m "chore: scaffold project and server config"
```

---

### Task 2: Core repost logic (`lib/repost.js`)

**Files:**
- Create: `lib/repost.js`
- Test: `lib/repost.test.js`

**Interfaces:**
- Consumes: nothing (pure functions; Discord objects passed in are duck-typed).
- Produces:
  - `normalizeTitle(title: string) => string` — trimmed, lowercased.
  - `classifyThreads(sourceThreads: Array<{name, createdTimestamp}>, destTitleSet: Set<string>) => { toRepost: Thread[], duplicates: Thread[] }` — sorted oldest→newest.
  - `collectAttachmentUrls(starterMessage: {attachments} | null) => string[]`.
  - `buildForumThreadPayload(title: string, content: string, attachmentUrls: string[]) => { name: string, message: { content: string, files: string[] } }`.
  - `buildPreview(items: Array<{title: string, attachmentCount: number}>, duplicateCount: number) => string`.

- [ ] **Step 1: Write the failing tests**

Create `lib/repost.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeTitle,
  classifyThreads,
  collectAttachmentUrls,
  buildForumThreadPayload,
  buildPreview,
} = require('./repost');

test('normalizeTitle trims and lowercases', () => {
  assert.strictEqual(normalizeTitle('  Hello World  '), 'hello world');
  assert.strictEqual(normalizeTitle('CAPS'), 'caps');
  assert.strictEqual(normalizeTitle(null), '');
});

test('classifyThreads sorts oldest first and splits duplicates', () => {
  const threads = [
    { name: 'B', createdTimestamp: 200 },
    { name: 'A', createdTimestamp: 100 },
    { name: 'Dup', createdTimestamp: 300 },
  ];
  const dest = new Set(['dup']);
  const { toRepost, duplicates } = classifyThreads(threads, dest);
  assert.deepStrictEqual(toRepost.map((t) => t.name), ['A', 'B']);
  assert.deepStrictEqual(duplicates.map((t) => t.name), ['Dup']);
});

test('collectAttachmentUrls maps attachment urls', () => {
  const starter = {
    attachments: new Map([
      ['1', { url: 'https://cdn/x.png' }],
      ['2', { url: 'https://cdn/y.png' }],
    ]),
  };
  assert.deepStrictEqual(collectAttachmentUrls(starter), [
    'https://cdn/x.png',
    'https://cdn/y.png',
  ]);
  assert.deepStrictEqual(collectAttachmentUrls(null), []);
});

test('buildForumThreadPayload truncates name to 100 and keeps files', () => {
  const p = buildForumThreadPayload('x'.repeat(120), 'body', ['u1']);
  assert.strictEqual(p.name.length, 100);
  assert.strictEqual(p.message.content, 'body');
  assert.deepStrictEqual(p.message.files, ['u1']);
});

test('buildForumThreadPayload falls back to title when no content and no files', () => {
  const p = buildForumThreadPayload('Title', '', []);
  assert.strictEqual(p.message.content, 'Title');
});

test('buildForumThreadPayload truncates content to 2000', () => {
  const p = buildForumThreadPayload('t', 'y'.repeat(2500), []);
  assert.strictEqual(p.message.content.length, 2000);
});

test('buildPreview lists items and duplicate count', () => {
  const items = [
    { title: 'A', attachmentCount: 2 },
    { title: 'B', attachmentCount: 0 },
  ];
  const out = buildPreview(items, 3);
  assert.match(out, /A \(2 images\)/);
  assert.match(out, /B \(0 images\)/);
  assert.match(out, /3.*duplicate/i);
});

test('buildPreview handles empty list', () => {
  assert.match(buildPreview([], 0), /Nothing new/i);
});

test('buildPreview caps long lists with a "more" line', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ title: 'T' + i, attachmentCount: 1 }));
  const out = buildPreview(items, 0);
  assert.match(out, /and \d+ more/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './repost'`.

- [ ] **Step 3: Implement `lib/repost.js`**

```js
const THREAD_NAME_MAX = 100;
const MESSAGE_CONTENT_MAX = 2000;
const PREVIEW_MAX_LINES = 25;
const PREVIEW_MAX_CHARS = 1900;

function truncate(str, max) {
  const s = String(str ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function normalizeTitle(title) {
  return String(title ?? '').trim().toLowerCase();
}

function classifyThreads(sourceThreads, destTitleSet) {
  const sorted = [...sourceThreads].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );
  const toRepost = [];
  const duplicates = [];
  for (const thread of sorted) {
    if (destTitleSet.has(normalizeTitle(thread.name))) {
      duplicates.push(thread);
    } else {
      toRepost.push(thread);
    }
  }
  return { toRepost, duplicates };
}

function collectAttachmentUrls(starterMessage) {
  if (!starterMessage || !starterMessage.attachments) return [];
  return [...starterMessage.attachments.values()].map((a) => a.url);
}

function buildForumThreadPayload(title, content, attachmentUrls) {
  const name = truncate(String(title ?? '').trim() || 'Untitled', THREAD_NAME_MAX);
  let body = truncate(content, MESSAGE_CONTENT_MAX);
  const files = [...attachmentUrls];
  if (!body && files.length === 0) {
    body = name;
  }
  return { name, message: { content: body, files } };
}

function buildPreview(items, duplicateCount) {
  if (items.length === 0) {
    return duplicateCount > 0
      ? `Nothing new to repost — ${duplicateCount} already exist as duplicate(s).`
      : 'Nothing new to repost.';
  }

  const header =
    `**${items.length}** post(s) to repost` +
    (duplicateCount > 0 ? `, **${duplicateCount}** skipped as duplicate(s)` : '') +
    ':';

  const lines = [];
  let shown = 0;
  for (const item of items) {
    if (shown >= PREVIEW_MAX_LINES) break;
    const t = truncate(String(item.title ?? '').trim() || 'Untitled', 80);
    const n = item.attachmentCount;
    lines.push(`• ${t} (${n} image${n === 1 ? '' : 's'})`);
    shown++;
  }

  const remaining = items.length - shown;
  let body = [header, ...lines].join('\n');
  if (remaining > 0) body += `\n…and ${remaining} more`;
  if (body.length > PREVIEW_MAX_CHARS) {
    body = body.slice(0, PREVIEW_MAX_CHARS - 1) + '…';
  }
  return body;
}

module.exports = {
  normalizeTitle,
  classifyThreads,
  collectAttachmentUrls,
  buildForumThreadPayload,
  buildPreview,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all `lib/repost.test.js` and `config.test.js` tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/repost.js lib/repost.test.js
git commit -m "feat: add core repost logic with unit tests"
```

---

### Task 3: Slash-command registration (`deploy-commands.js`)

**Files:**
- Create: `deploy-commands.js`

**Interfaces:**
- Consumes: `SERVERS` from `config.js`; env `DISCORD_APPLICAION_ID`, `DISCORD_BOT_TOKEN`.
- Produces: registers a guild-scoped `/bulkrepost` command in both servers (guild commands appear instantly, unlike global commands). No exported API.

- [ ] **Step 1: Create `deploy-commands.js`**

```js
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { SERVERS } = require('./config');

const choices = Object.keys(SERVERS).map((name) => ({ name, value: name }));

const command = new SlashCommandBuilder()
  .setName('bulkrepost')
  .setDescription('Copy forum listings from one server to another')
  .addStringOption((opt) =>
    opt
      .setName('from_server')
      .setDescription('Source server')
      .setRequired(true)
      .addChoices(...choices)
  )
  .addStringOption((opt) =>
    opt
      .setName('to_server')
      .setDescription('Destination server')
      .setRequired(true)
      .addChoices(...choices)
  )
  .addBooleanOption((opt) =>
    opt
      .setName('include_archived')
      .setDescription('Also scan archived posts (default: false)')
      .setRequired(false)
  )
  .toJSON();

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
const appId = process.env.DISCORD_APPLICAION_ID;

(async () => {
  try {
    for (const [name, { serverId }] of Object.entries(SERVERS)) {
      await rest.put(Routes.applicationGuildCommands(appId, serverId), {
        body: [command],
      });
      console.log(`Registered /bulkrepost in ${name} (${serverId}).`);
    }
    console.log('Done.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Verify it parses/loads without hitting Discord**

Run: `node -e "require('./deploy-commands.js')"` is **not** used (it would call Discord). Instead verify syntax only:
Run: `node --check deploy-commands.js`
Expected: no output, exit code 0 (syntax valid).

- [ ] **Step 3: Commit**

```bash
git add deploy-commands.js
git commit -m "feat: add slash command registration script"
```

> **Note (manual, requires the bot in both servers):** After Task 4, run `npm run deploy` once to register the command. Re-run only when the command definition changes.

---

### Task 4: Bot client & interaction handler (`index.js`)

**Files:**
- Create: `index.js`

**Interfaces:**
- Consumes: `SERVERS` from `config.js`; `normalizeTitle`, `classifyThreads`, `collectAttachmentUrls`, `buildForumThreadPayload`, `buildPreview` from `lib/repost.js`; env `DISCORD_BOT_TOKEN`.
- Produces: the runnable bot (`npm start`). No exported API.

- [ ] **Step 1: Create `index.js`**

```js
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const { SERVERS } = require('./config');
const {
  normalizeTitle,
  classifyThreads,
  collectAttachmentUrls,
  buildForumThreadPayload,
  buildPreview,
} = require('./lib/repost');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
});

async function getForumChannel(guildId, channelId) {
  const guild = await client.guilds.fetch(guildId);
  return guild.channels.fetch(channelId);
}

async function fetchSourceThreads(forumChannel, includeArchived) {
  const active = await forumChannel.threads.fetchActive();
  let threads = [...active.threads.values()];
  if (includeArchived) {
    const archived = await forumChannel.threads.fetchArchived({ limit: 100 });
    threads = threads.concat([...archived.threads.values()]);
  }
  return threads;
}

async function fetchDestinationTitleSet(forumChannel) {
  const set = new Set();
  const active = await forumChannel.threads.fetchActive();
  for (const t of active.threads.values()) set.add(normalizeTitle(t.name));
  const archived = await forumChannel.threads.fetchArchived({ limit: 100 });
  for (const t of archived.threads.values()) set.add(normalizeTitle(t.name));
  return set;
}

async function handleBulkRepost(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const fromName = interaction.options.getString('from_server', true);
  const toName = interaction.options.getString('to_server', true);
  const includeArchived = interaction.options.getBoolean('include_archived') ?? false;

  if (fromName === toName) {
    await interaction.editReply('Source and destination servers must be different.');
    return;
  }
  const from = SERVERS[fromName];
  const to = SERVERS[toName];
  if (!from || !to) {
    await interaction.editReply('Unknown server selection.');
    return;
  }

  let sourceForum;
  let destForum;
  try {
    sourceForum = await getForumChannel(from.serverId, from.forumChannelId);
    destForum = await getForumChannel(to.serverId, to.forumChannelId);
  } catch (err) {
    await interaction.editReply(`Could not access a forum channel: ${err.message}`);
    return;
  }

  const sourceThreads = await fetchSourceThreads(sourceForum, includeArchived);
  const destTitles = await fetchDestinationTitleSet(destForum);
  const { toRepost, duplicates } = classifyThreads(sourceThreads, destTitles);

  // Fetch starter messages up front for content + attachment counts.
  const items = [];
  for (const thread of toRepost) {
    let starter = null;
    try {
      starter = await thread.fetchStarterMessage();
    } catch {
      starter = null;
    }
    const attachmentUrls = collectAttachmentUrls(starter);
    items.push({
      title: thread.name,
      content: starter ? starter.content : '',
      attachmentUrls,
      attachmentCount: attachmentUrls.length,
    });
  }

  const previewText = buildPreview(
    items.map((i) => ({ title: i.title, attachmentCount: i.attachmentCount })),
    duplicates.length
  );

  if (items.length === 0) {
    await interaction.editReply(previewText);
    return;
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('repost_confirm')
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('repost_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
  );

  const preview = await interaction.editReply({
    content: previewText + '\n\nRepost these? This cannot be undone.',
    components: [confirmRow],
  });

  let decision;
  try {
    decision = await preview.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: 60000,
    });
  } catch {
    await interaction.editReply({
      content: 'Timed out — nothing was reposted.',
      components: [],
    });
    return;
  }

  if (decision.customId === 'repost_cancel') {
    await decision.update({ content: 'Cancelled — nothing was reposted.', components: [] });
    return;
  }

  await decision.update({ content: `Reposting ${items.length} post(s)…`, components: [] });

  let copied = 0;
  let errors = 0;
  for (const item of items) {
    try {
      const payload = buildForumThreadPayload(item.title, item.content, item.attachmentUrls);
      await destForum.threads.create(payload);
      copied++;
    } catch (err) {
      console.error(`Failed to repost "${item.title}":`, err);
      errors++;
    }
  }

  await interaction.editReply({
    content:
      `Done. **${copied}** copied, **${duplicates.length}** skipped as duplicate(s), ` +
      `**${errors}** error(s).`,
    components: [],
  });
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'bulkrepost') return;
  try {
    await handleBulkRepost(interaction);
  } catch (err) {
    console.error(err);
    const msg = `Something went wrong: ${err.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: msg, components: [] }).catch(() => {});
    } else {
      await interaction
        .reply({ content: msg, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

client.once('ready', (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check index.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify the full test suite still passes**

Run: `npm test`
Expected: PASS (all tests from Tasks 1–2).

- [ ] **Step 4: Commit**

```bash
git add index.js
git commit -m "feat: add bot client and /bulkrepost interaction handler"
```

---

### Task 5: Docs & manual end-to-end verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: setup/run instructions; a manual verification checklist.

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage"
```

- [ ] **Step 3: Manual end-to-end verification (requires bot in both servers)**

Perform in order and confirm each:

1. `npm run deploy` → prints "Registered /bulkrepost" for both servers, no errors.
2. `npm start` → prints "Logged in as ...".
3. In Discord, run `/bulkrepost from_server:closetclearout to_server:zrserver`.
   - Preview lists your recent (active) source posts with correct titles and image counts; duplicate count is accurate.
4. Click **Confirm** → destination `zrserver` forum receives new posts with matching title, text, and images (images are uploaded to the destination, not hot-linked). Summary reports the right counts.
5. Run the same command again → all now show as duplicates, `0 copied`.
6. Run with `include_archived:true` → archived source posts also appear in the preview.
7. Run and click **Cancel** (and separately, let it time out 60s) → reports nothing was reposted; destination unchanged.

---

## Notes / Known Limitations

- Archived-thread fetch is capped at 100 (`fetchArchived({ limit: 100 })`) per forum. If a forum has more than 100 archived posts, older ones beyond 100 are not scanned. Acceptable for current use; revisit with pagination (`before` cursor) if needed.
- Global vs guild commands: registration is guild-scoped for instant availability in the two known servers.
- If `fetchStarterMessage()` fails for a post, it is reposted with empty text (title fallback) and no images rather than aborting the run.
