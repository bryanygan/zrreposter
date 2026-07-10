require('dotenv').config();
const { registerCommands } = require('./commands');

(async () => {
  try {
    await registerCommands(
      process.env.DISCORD_BOT_TOKEN,
      process.env.DISCORD_APPLICAION_ID
    );
    console.log('Done.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
