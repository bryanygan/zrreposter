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
