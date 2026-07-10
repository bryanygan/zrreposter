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
