const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { SERVERS, COMMANDS } = require('./config');

const DESCRIPTIONS = {
  bulkrepost: 'Copy forum listings from one server to another',
  testbulkrepost: 'Test: copy forum listings between servers (includes test servers)',
};

// Build the JSON command definitions for every command in config.COMMANDS.
function buildCommands() {
  return Object.entries(COMMANDS).map(([cmdName, serverNames]) => {
    const choices = serverNames.map((name) => ({ name, value: name }));
    return new SlashCommandBuilder()
      .setName(cmdName)
      .setDescription(DESCRIPTIONS[cmdName] ?? 'Copy forum listings between servers')
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
  });
}

// Distinct guild IDs the bot manages (several server names can share one guild).
function uniqueGuildIds() {
  return [...new Set(Object.values(SERVERS).map((s) => s.serverId))];
}

// Register all commands as guild commands (instant availability) in every guild.
async function registerCommands(token, appId) {
  if (!token) throw new Error('Missing DISCORD_BOT_TOKEN');
  if (!appId) throw new Error('Missing DISCORD_APPLICAION_ID');
  const rest = new REST({ version: '10' }).setToken(token);
  const body = buildCommands();
  for (const guildId of uniqueGuildIds()) {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    console.log(`Registered ${body.length} command(s) in guild ${guildId}.`);
  }
}

module.exports = { buildCommands, uniqueGuildIds, registerCommands };
