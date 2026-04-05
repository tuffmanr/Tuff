import { Client, GatewayIntentBits, Collection, REST, Routes, Events } from 'discord.js';
import { handlePrefix } from './prefix.mjs';
import { commands as moderationCommands } from './commands/moderation.mjs';
import { commands as serverCommands } from './commands/server.mjs';
import { commands as infoCommands } from './commands/info.mjs';
import { commands as applicationCommands, handleApplicationModal } from './commands/applications.mjs';
import { commands as roleCommands } from './commands/roles.mjs';
import { getSettings, getExpiredMutes, removeMute } from './database.mjs';
import { sendLog } from './logger.mjs';
import { runAutomod, checkRaid } from './automod.mjs';
import { dmUser, modEmbed, MOD_COLORS } from './utils.mjs';

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('DISCORD_TOKEN is not set!');
  process.exit(1);
}

const allCommands = [...moderationCommands, ...serverCommands, ...infoCommands, ...applicationCommands, ...roleCommands];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,        // Privileged: enable in Discord Developer Portal
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,      // Privileged: enable in Discord Developer Portal
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration,
  ],
});

client.commands = new Collection();
for (const cmd of allCommands) {
  client.commands.set(cmd.data.name, cmd);
}

// Register slash commands on ready
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);

  const rest = new REST().setToken(TOKEN);
  const commandData = allCommands.map(c => c.data.toJSON());

  try {
    console.log(`Registering ${commandData.length} slash commands globally...`);
    await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commandData });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err.message);
  }

  // Expired mute cleanup loop
  setInterval(async () => {
    const expired = getExpiredMutes();
    for (const mute of expired) {
      removeMute(mute.guild_id, mute.user_id);
      try {
        const guild = await client.guilds.fetch(mute.guild_id).catch(() => null);
        if (!guild) continue;
        const member = await guild.members.fetch(mute.user_id).catch(() => null);
        if (!member) continue;
        const settings = getSettings(mute.guild_id);
        if (settings.mute_role_id) {
          const muteRole = guild.roles.cache.get(settings.mute_role_id);
          if (muteRole) await member.roles.remove(muteRole, 'Mute expired').catch(() => {});
        }
        await member.timeout(null, 'Mute expired').catch(() => {});
        await sendLog(client, mute.guild_id, 'unmute', {
          user: member.user, userId: member.id,
          moderator: client.user, moderatorId: client.user.id,
          reason: 'Mute duration expired',
        });
        const dmEmbed = modEmbed({ color: MOD_COLORS.unmute, title: '🔊 You Have Been Unmuted', description: 'Your mute has expired.' });
        await dmUser(member.user, dmEmbed);
      } catch {}
    }
  }, 30000);
});

// Interaction handler (slash commands + modals)
client.on(Events.InteractionCreate, async (interaction) => {
  // Modal submissions (applications)
  if (interaction.isModalSubmit()) {
    await handleApplicationModal(interaction, client).catch(err => console.error('Modal error:', err.message));
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, client);
  } catch (err) {
    console.error(`Command error [${interaction.commandName}]:`, err.message);
    const errMsg = { content: '❌ An error occurred while executing that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg).catch(() => {});
    } else {
      await interaction.reply(errMsg).catch(() => {});
    }
  }
});

// Message handler — prefix commands + AutoMod
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;

  // Run prefix commands first (skip automod on command messages)
  if (message.content.startsWith('!')) {
    await handlePrefix(message, client).catch(err => console.error('Prefix error:', err.message));
    return;
  }

  // AutoMod on regular messages
  await runAutomod(message, client);
});

// Member join
client.on(Events.GuildMemberAdd, async (member) => {
  const settings = getSettings(member.guild.id);

  // Log join
  const { logJoin } = await import('./database.mjs');
  logJoin(member.guild.id, member.id);

  // Raid check
  await checkRaid(member, client);

  // Welcome message
  if (settings.welcome_channel_id) {
    try {
      const channel = await client.channels.fetch(settings.welcome_channel_id).catch(() => null);
      if (channel) {
        const msg = settings.welcome_message
          .replace('{user}', `<@${member.id}>`)
          .replace('{username}', member.user.username)
          .replace('{server}', member.guild.name)
          .replace('{count}', String(member.guild.memberCount));

        const embed = modEmbed({
          color: MOD_COLORS.join,
          title: '📥 Member Joined',
          description: msg,
          fields: [
            { name: 'Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Member Count', value: String(member.guild.memberCount), inline: true },
          ],
        });
        embed.setThumbnail(member.user.displayAvatarURL({ size: 128 }));
        await channel.send({ embeds: [embed] });
      }
    } catch {}
  }

  // Log event
  await sendLog(client, member.guild.id, 'join', {
    user: member.user, userId: member.id,
    description: `**${member.user.tag}** joined the server. Account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>.`,
  });
});

// Member leave
client.on(Events.GuildMemberRemove, async (member) => {
  const settings = getSettings(member.guild.id);

  if (settings.welcome_channel_id) {
    try {
      const channel = await client.channels.fetch(settings.welcome_channel_id).catch(() => null);
      if (channel) {
        const msg = settings.farewell_message
          .replace('{user}', member.user.tag)
          .replace('{username}', member.user.username)
          .replace('{server}', member.guild.name)
          .replace('{count}', String(member.guild.memberCount));

        const embed = modEmbed({
          color: MOD_COLORS.leave,
          title: '📤 Member Left',
          description: msg,
          fields: [{ name: 'Member Count', value: String(member.guild.memberCount), inline: true }],
        });
        await channel.send({ embeds: [embed] });
      }
    } catch {}
  }

  await sendLog(client, member.guild.id, 'leave', {
    user: member.user, userId: member.id,
    description: `**${member.user.tag}** left the server.`,
  });
});

// Ban audit log
client.on(Events.GuildBanAdd, async (ban) => {
  await sendLog(client, ban.guild.id, 'ban', {
    user: ban.user, userId: ban.user.id,
    reason: ban.reason || 'No reason provided',
    description: `**${ban.user.tag}** was banned.`,
  });
});

// Unban audit log
client.on(Events.GuildBanRemove, async (ban) => {
  await sendLog(client, ban.guild.id, 'unban', {
    user: ban.user, userId: ban.user.id,
    reason: ban.reason || 'No reason provided',
    description: `**${ban.user.tag}** was unbanned.`,
  });
});

// Handle errors gracefully
client.on(Events.Error, (err) => {
  console.error('Discord client error:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err?.message || err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

client.login(TOKEN).catch(err => {
  if (err.message?.includes('disallowed intents')) {
    console.error('');
    console.error('❌ LOGIN FAILED: Privileged Gateway Intents not enabled!');
    console.error('');
    console.error('You must enable these intents in the Discord Developer Portal:');
    console.error('  1. Go to https://discord.com/developers/applications');
    console.error('  2. Select your application → Bot');
    console.error('  3. Under "Privileged Gateway Intents", enable:');
    console.error('     ✅ SERVER MEMBERS INTENT');
    console.error('     ✅ MESSAGE CONTENT INTENT');
    console.error('  4. Click Save and restart the bot.');
    console.error('');
  } else {
    console.error('Login failed:', err.message);
  }
  process.exit(1);
});
