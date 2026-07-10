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
  classifyThreads,
  collectAttachments,
  chunkAttachments,
  buildForumThreadPayload,
  buildPreview,
} = require('./lib/repost');

// Only these Discord user IDs may run the commands.
const ALLOWED_USER_IDS = new Set(['1108031578208219326', '745694160002089130']);

// Keep each upload safely under Discord's per-message limit (25 MB base tier).
// Override with MAX_UPLOAD_BYTES if the destination server has a higher limit.
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 24 * 1024 * 1024;
const MAX_FILES_PER_MESSAGE = 10;

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
    const attachments = collectAttachments(starter);
    items.push({
      title: thread.name,
      content: starter ? starter.content : '',
      attachments,
      attachmentCount: attachments.length,
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
      // Split attachments into groups that each fit Discord's per-message
      // limits: the first group goes on the forum post, the rest as replies.
      const chunks = chunkAttachments(
        item.attachments,
        MAX_UPLOAD_BYTES,
        MAX_FILES_PER_MESSAGE
      );
      const firstFiles = (chunks[0] ?? []).map((a) => a.url);
      const payload = buildForumThreadPayload(item.title, item.content, firstFiles);
      const thread = await destForum.threads.create(payload);
      for (const chunk of chunks.slice(1)) {
        await thread.send({ files: chunk.map((a) => a.url) });
      }
      copied++;
    } catch (err) {
      console.error(`Failed to repost "${item.title}":`, err.message);
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
