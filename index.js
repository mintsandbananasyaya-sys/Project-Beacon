require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged - must be enabled in Dev Portal
  ],
});

const OWNER_ID = process.env.OWNER_ID;

// ---------- slash command definitions ----------

const commands = [
  new SlashCommandBuilder()
    .setName('giverole')
    .setDescription('Owner only: give a role to everyone, a role group, or one person')
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('Role to give').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('target')
        .setDescription('Who to give it to')
        .setRequired(true)
        .addChoices(
          { name: 'Everyone', value: 'all' },
          { name: 'Everyone with a specific role', value: 'role' },
          { name: 'One person', value: 'user' }
        )
    )
    .addRoleOption((opt) =>
      opt
        .setName('target_role')
        .setDescription('Required if target = "Everyone with a specific role"')
        .setRequired(false)
    )
    .addUserOption((opt) =>
      opt
        .setName('target_user')
        .setDescription('Required if target = "One person"')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // extra safety net, real check is OWNER_ID
    .toJSON(),

  new SlashCommandBuilder()
    .setName('removerole')
    .setDescription('Owner only: remove a role from everyone, a role group, or one person')
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('Role to remove').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('target')
        .setDescription('Who to remove it from')
        .setRequired(true)
        .addChoices(
          { name: 'Everyone', value: 'all' },
          { name: 'Everyone with a specific role', value: 'role' },
          { name: 'One person', value: 'user' }
        )
    )
    .addRoleOption((opt) =>
      opt
        .setName('target_role')
        .setDescription('Required if target = "Everyone with a specific role"')
        .setRequired(false)
    )
    .addUserOption((opt) =>
      opt
        .setName('target_user')
        .setDescription('Required if target = "One person"')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    // Guild-scoped registration = updates instantly (vs up to 1hr for global)
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log('[Beacon] Slash commands registered.');
  } catch (err) {
    console.error('[Beacon] Failed to register commands:', err);
  }
}

// ---------- role assignment logic ----------

async function runRoleAction(interaction, mode) {
  // mode: 'give' or 'remove'
  if (interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
  }

  const role = interaction.options.getRole('role');
  const target = interaction.options.getString('target');
  const targetRole = interaction.options.getRole('target_role');
  const targetUser = interaction.options.getUser('target_user');

  if (target === 'role' && !targetRole) {
    return interaction.reply({ content: 'You picked "Everyone with a specific role" but didn\'t supply `target_role`.', ephemeral: true });
  }
  if (target === 'user' && !targetUser) {
    return interaction.reply({ content: 'You picked "One person" but didn\'t supply `target_user`.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const botMember = await guild.members.fetchMe();

  // Role hierarchy check - bot must sit above the role it's assigning/removing
  if (role.position >= botMember.roles.highest.position) {
    return interaction.editReply(
      `I can't manage **${role.name}** — my highest role needs to be above it in Server Settings > Roles.`
    );
  }

  let members;
  if (target === 'user') {
    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.editReply('Could not find that member in this server.');
    members = [member];
  } else {
    await guild.members.fetch(); // populate cache
    members = target === 'all'
      ? [...guild.members.cache.values()]
      : [...guild.members.cache.filter((m) => m.roles.cache.has(targetRole.id)).values()];
  }

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const member of members) {
    const hasRole = member.roles.cache.has(role.id);
    if (mode === 'give' && hasRole) { skipped++; continue; }
    if (mode === 'remove' && !hasRole) { skipped++; continue; }
    if (member.user.bot && target !== 'user') { skipped++; continue; }

    try {
      if (mode === 'give') {
        await member.roles.add(role);
      } else {
        await member.roles.remove(role);
      }
      success++;
    } catch (err) {
      failed++;
    }
  }

  const verb = mode === 'give' ? 'Gave' : 'Removed';
  const prep = mode === 'give' ? 'to' : 'from';
  return interaction.editReply(
    `${verb} **${role.name}** ${prep} ${success} member(s). Skipped ${skipped} (already correct / bots). Failed on ${failed}.`
  );
}

// ---------- events ----------

client.once('ready', async () => {
  console.log(`[Beacon] Online as ${client.user.tag}`);
  client.user.setActivity('the signal', { type: ActivityType.Watching });
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'giverole') {
      await runRoleAction(interaction, 'give');
    } else if (interaction.commandName === 'removerole') {
      await runRoleAction(interaction, 'remove');
    }
  } catch (err) {
    console.error('[Beacon] Command error:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('Something went wrong running that command.');
    } else {
      await interaction.reply({ content: 'Something went wrong running that command.', ephemeral: true });
    }
  }
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
