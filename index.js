require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const express = require('express');

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

// ---------- keep-alive web server ----------
// The bot itself doesn't receive HTTP traffic, so Render's free tier would
// normally spin it down after ~15 minutes of "inactivity." This tiny server
// gives it a URL to respond on so UptimeRobot can ping it and keep it awake.

const app = express();

app.get('/', (req, res) => {
  const status = client.isReady() ? 'online' : 'starting';
  res.send(`Beacon bot is ${status}.`);
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`[Beacon] Keep-alive server running on port ${port}`);
});
