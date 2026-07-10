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
const { SERVERS, COMMANDS } = require('./config');
const { registerCommands } = require('./commands');
const {
  normalizeTitle,
  parseSince,
  classifyThreads,
  collectAttachments,
  uploadInBatches,
  buildForumThreadPayload,
  buildPreview,
} = require('./lib/repost');
const { compressToFit } = require('./lib/images');

// Only these Discord user IDs may run the commands. Override via the
// ALLOWED_USER_IDS env var (comma-separated) without changing code.
const DEFAULT_ALLOWED_USER_IDS = ['1108031578208219326', '745694160002089130'];
const ALLOWED_USER_IDS = new Set(
  (process.env.ALLOWED_USER_IDS
    ? process.env.ALLOWED_USER_IDS.split(',')
    : DEFAULT_ALLOWED_USER_IDS
  )
    .map((s) => s.trim())
    .filter(Boolean)
);

// Target upload size per message. Discord's non-boosted per-message limit is
// ~10 MB, so we aim just under it. Raise MAX_UPLOAD_BYTES if the destination
// server is boosted (Tier 2 = 50 MB, Tier 3 = 100 MB) for higher image quality.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 9.5 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 10;

// Timezone used to interpret date filters (e.g. "07/07"). Override with TIMEZONE.
const TIMEZONE = process.env.TIMEZONE || 'America/New_York';

function fileNameFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || 'file';
  } catch {
    return 'file';
  }
}

// Download a source post's attachments as buffers, tagging which are images.
// Attachments that fail to download are skipped and counted.
async function downloadAttachments(item) {
  const downloaded = [];
  let skipped = 0;
  for (const a of item.attachments) {
    try {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const type = a.contentType || res.headers.get('content-type') || '';
      const name = a.name || fileNameFromUrl(a.url);
      downloaded.push({
        buffer,
        name,
        isImage: type.startsWith('image/'),
        isGif: type === 'image/gif' || /\.gif$/i.test(name),
      });
    } catch (err) {
      console.error(`Could not download an attachment for "${item.title}": ${err.message}`);
      skipped++;
    }
  }
  return { downloaded, skipped };
}

// Repost one source post into the destination forum. Images are compressed only
// as needed so that all attachments fit in the single initial thread message.
// Returns the number of attachments skipped (failed download or un-shrinkable).
async function repostItem(destForum, item) {
  const { downloaded, skipped } = await downloadAttachments(item);
  const { files, fits } = await compressToFit(downloaded, MAX_UPLOAD_BYTES);

  if (files.length === 0 || (fits && files.length <= MAX_FILES_PER_MESSAGE)) {
    await destForum.threads.create(
      buildForumThreadPayload(item.title, item.content, files)
    );
    return skipped;
  }

  // Rare fallback: still too large for one message (e.g. a big video) or more
  // than 10 attachments. Create the post with text, then upload the rest as
  // replies, splitting on 413 and skipping anything that still won't fit.
  const thread = await destForum.threads.create(
    buildForumThreadPayload(item.title, item.content, [])
  );
  let extraSkipped = 0;
  for (let i = 0; i < files.length; i += MAX_FILES_PER_MESSAGE) {
    const group = files.slice(i, i + MAX_FILES_PER_MESSAGE);
    extraSkipped += await uploadInBatches((batch) => thread.send({ files: batch }), group);
  }
  return skipped + extraSkipped;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
  presence: { status: 'invisible' },
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

  if (!ALLOWED_USER_IDS.has(interaction.user.id)) {
    await interaction.editReply('You are not authorized to use this command.');
    return;
  }

  const fromName = interaction.options.getString('from_server', true);
  const toName = interaction.options.getString('to_server', true);
  const includeArchived = interaction.options.getBoolean('include_archived') ?? false;

  let cutoff;
  try {
    cutoff = parseSince(interaction.options.getString('posted_after'), Date.now(), TIMEZONE);
  } catch (err) {
    await interaction.editReply(err.message);
    return;
  }

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

  let sourceThreads = await fetchSourceThreads(sourceForum, includeArchived);
  if (cutoff !== null) {
    sourceThreads = sourceThreads.filter((t) => t.createdTimestamp >= cutoff);
  }
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
    const attachments = collectAttachments(starter);
    items.push({
      title: thread.name,
      content: starter ? starter.content : '',
      attachments,
      attachmentCount: attachments.length,
    });
  }

  const cutoffNote =
    cutoff !== null
      ? `Filtering to posts created after ${new Intl.DateTimeFormat('en-US', {
          timeZone: TIMEZONE,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(cutoff))} (${TIMEZONE}).\n`
      : '';
  const previewText =
    cutoffNote +
    buildPreview(
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
  let skippedAttachments = 0;
  for (const item of items) {
    try {
      skippedAttachments += await repostItem(destForum, item);
      copied++;
    } catch (err) {
      console.error(`Failed to repost "${item.title}":`, err.message);
      errors++;
    }
  }

  const skippedNote =
    skippedAttachments > 0
      ? ` (${skippedAttachments} oversized image(s) skipped)`
      : '';
  await interaction.editReply({
    content:
      `Done. **${copied}** copied, **${duplicates.length}** skipped as duplicate(s), ` +
      `**${errors}** error(s).${skippedNote}`,
    components: [],
  });
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!(interaction.commandName in COMMANDS)) return;
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

client.once('clientReady', async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  // Auto-register slash commands on startup so hosts like Railway need no
  // separate deploy step. Set REGISTER_COMMANDS_ON_START=false to skip.
  if (process.env.REGISTER_COMMANDS_ON_START !== 'false') {
    try {
      await registerCommands(
        process.env.DISCORD_BOT_TOKEN,
        process.env.DISCORD_APPLICAION_ID
      );
    } catch (err) {
      console.error('Command registration on startup failed:', err);
    }
  }
});

// Minimal HTTP server so platforms like Railway detect an open port and can
// health-check the service. The Discord gateway connection is what keeps the
// process alive; this endpoint is just a liveness signal.
if (process.env.PORT) {
  require('http')
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('zrreposter ok');
    })
    .listen(process.env.PORT, () =>
      console.log(`Health server listening on ${process.env.PORT}`)
    );
}

client.login(process.env.DISCORD_BOT_TOKEN);
