require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const express = require('express');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged - must be enabled in Dev Portal
  ],
});

const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID;
const ACCEPTED_ROLE_ID = process.env.ACCEPTED_ROLE_ID;
const WEBSITE_URL = process.env.WEBSITE_URL; // e.g. https://project-beacon.onrender.com

// userId-sessionLabel -> Timeout, so a user can't stack duplicate reminders for the same session
const scheduledReminders = new Map();

const CUTE_PEOPLE = ['Liv', 'Vicipedia', 'Alphadarkman', 'Farlue', 'ver', 'aesily', 'Rocksink', 'Carrot daddy', 'nobody is cute, im gay', 'geneseck', 'Yellow Di-duck'];

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
    .toJSON(),

  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Show the Beacon session schedule')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Get a link to the Beacon application')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your Beacon application status')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('nextsession')
    .setDescription('Show the next upcoming Beacon session')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remindme')
    .setDescription('Get a DM 15 minutes before the next session')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('cute')
    .setDescription('Shows a random cute person')
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

// ---------- schedule ----------

const SESSIONS = [
  { label: 'Session 1', start: 1786465800, end: 1786476600 },
  { label: 'Session 2', start: 1786811400, end: 1786822200 },
  { label: 'Session 3', start: 1786897800, end: 1786908600 },
  { label: 'Session 4', start: 1787416200, end: 1787427000, note: 'Build Day' },
  { label: 'Session 5', start: 1787502600, end: 1787513400 },
  { label: 'Session 6', start: 1788021000, end: 1788031800 },
  { label: 'Session 7', start: 1788107400, end: 1788118200 },
];

function buildScheduleEmbed() {
  const lines = [];
  for (const s of SESSIONS) {
    if (s.note) {
      lines.push('', `**${s.note}**`);
    }
    lines.push(`🌍 **${s.label}** — <t:${s.start}:F> (<t:${s.start}:t>–<t:${s.end}:t>)`);
  }

  return new EmbedBuilder()
    .setTitle('📅 Beacon Schedule')
    .setDescription(lines.join('\n').trim())
    .setColor(0x5865f2);
}

function buildNextSessionEmbed() {
  const now = Math.floor(Date.now() / 1000);
  const next = SESSIONS.find((s) => s.end > now);

  if (!next) {
    return new EmbedBuilder()
      .setTitle('📅 Next Session')
      .setDescription('No upcoming sessions scheduled right now.')
      .setColor(0x5865f2);
  }

  const status = next.start > now ? 'Upcoming' : 'Happening now';
  const lines = [
    `🌍 **${next.label}**${next.note ? ` (${next.note})` : ''} — ${status}`,
    `📅 <t:${next.start}:F>`,
    `🕒 <t:${next.start}:t> – <t:${next.end}:t>  (<t:${next.start}:R>)`,
  ];

  return new EmbedBuilder()
    .setTitle('📅 Next Session')
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2);
}

function scheduleReminder(user, session) {
  const key = `${user.id}-${session.label}`;
  if (scheduledReminders.has(key)) return 'already';

  const now = Math.floor(Date.now() / 1000);
  const reminderAt = session.start - 15 * 60;
  const msUntilReminder = (reminderAt - now) * 1000;

  if (reminderAt <= now) return 'too_late';

  // setTimeout caps out around ~24.8 days; Beacon sessions are within that window,
  // but guard anyway so it doesn't silently fire immediately on overflow.
  if (msUntilReminder > 2147483647) return 'too_far';

  const timeout = setTimeout(async () => {
    scheduledReminders.delete(key);
    try {
      await user.send(
        `⏰ **${session.label}** starts in 15 minutes! <t:${session.start}:t> (<t:${session.start}:R>)`
      );
    } catch (err) {
      console.log(`[Beacon] Couldn't DM ${user.tag} for reminder (DMs likely closed).`);
    }
  }, msUntilReminder);

  scheduledReminders.set(key, timeout);
  return 'scheduled';
}

// ---------- role assignment logic ----------

async function runRoleAction(interaction, mode) {
  // mode: 'give' or 'remove'
  const invoker = interaction.member; // GuildMember, since these are guild-only commands
  if (!invoker || !invoker.roles.cache.has(OWNER_ROLE_ID)) {
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
  if (process.env.DEPLOY_COMMANDS === 'true') {
    await registerCommands();
  } else {
    console.log('[Beacon] Skipping command registration (DEPLOY_COMMANDS not "true").');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'giverole') {
      await runRoleAction(interaction, 'give');
    } else if (interaction.commandName === 'removerole') {
      await runRoleAction(interaction, 'remove');
    } else if (interaction.commandName === 'schedule') {
      await interaction.reply({ embeds: [buildScheduleEmbed()] }); // not ephemeral - visible to everyone
    } else if (interaction.commandName === 'nextsession') {
      await interaction.reply({ embeds: [buildNextSessionEmbed()] }); // not ephemeral - visible to everyone
    } else if (interaction.commandName === 'remindme') {
      const now = Math.floor(Date.now() / 1000);
      const next = SESSIONS.find((s) => s.end > now);

      if (!next) {
        await interaction.reply({ content: 'No upcoming sessions to remind you about right now.', ephemeral: true });
      } else {
        const result = scheduleReminder(interaction.user, next);
        if (result === 'scheduled') {
          await interaction.reply({ content: `Got it — I'll DM you 15 minutes before **${next.label}** (<t:${next.start}:t>).`, ephemeral: true });
        } else if (result === 'already') {
          await interaction.reply({ content: `You're already set for a reminder before **${next.label}**.`, ephemeral: true });
        } else if (result === 'too_late') {
          await interaction.reply({ content: `**${next.label}** is starting too soon (or already started) to set a 15-minute reminder.`, ephemeral: true });
        } else {
          await interaction.reply({ content: `**${next.label}** is too far out to schedule yet — try again closer to the date.`, ephemeral: true });
        }
      }
    } else if (interaction.commandName === 'apply') {
      if (!WEBSITE_URL) {
        return interaction.reply({ content: 'Application link isn\'t configured yet — ask an owner to set `WEBSITE_URL`.', ephemeral: true });
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Apply to Beacon')
          .setStyle(ButtonStyle.Link)
          .setURL(`${WEBSITE_URL}/applications.html`)
      );
      await interaction.reply({
        content: 'Ready to apply? Hit the button below.',
        components: [row],
        ephemeral: true,
      });
    } else if (interaction.commandName === 'status') {
      if (!ACCEPTED_ROLE_ID) {
        return interaction.reply({ content: 'Status checks aren\'t configured yet — ask an owner to set `ACCEPTED_ROLE_ID`.', ephemeral: true });
      }
      const member = interaction.member;
      const accepted = member && member.roles.cache.has(ACCEPTED_ROLE_ID);
      const message = accepted
        ? '✅ Your application status: **Accepted**'
        : '⏳ Your application status: **Denied or in review**';
      await interaction.reply({ content: message, ephemeral: true });
    } else if (interaction.commandName === 'cute') {
      const pick = CUTE_PEOPLE[Math.floor(Math.random() * CUTE_PEOPLE.length)];
      await interaction.reply(`🥰 **${pick}** is the cutest!`);
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
