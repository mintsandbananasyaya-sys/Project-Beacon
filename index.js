require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log(`[Beacon] Online as ${client.user.tag}`);
  client.user.setActivity('the signal', { type: ActivityType.Watching });
});

client.on('error', (err) => {
  console.error('[Beacon] Client error:', err);
});

client.login(process.env.DISCORD_TOKEN);
