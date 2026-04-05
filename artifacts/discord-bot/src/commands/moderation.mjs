import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import {
  addStrike, getStrikes, clearStrikes, removeStrike,
  addWarning, getWarnings, clearWarnings,
  addMute, removeMute, addModLog,
} from '../database.mjs';
import { sendLog } from '../logger.mjs';
import { dmUser, modEmbed, MOD_COLORS, parseDuration, formatDuration, canModerate, strikeEmbed } from '../utils.mjs';

async function applyMute(member, settings, duration, reason, client, moderator) {
  let muteRole = settings.mute_role_id ? member.guild.roles.cache.get(settings.mute_role_id) : null;

  if (!muteRole) {
    // Use Discord timeout as fallback
    const ms = duration ? duration * 1000 : 28 * 24 * 60 * 60 * 1000;
    await member.timeout(ms, reason);
    addMute(member.guild.id, member.id, duration ? Math.floor(Date.now() / 1000) + duration : null);
    return true;
  }

  await member.roles.add(muteRole, reason);
  addMute(member.guild.id, member.id, duration ? Math.floor(Date.now() / 1000) + duration : null);
  return true;
}

export const commands = [
  // WARN
  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member')
      .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for warning').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason');
      if (!target) return interaction.reply({ content: 'User not found in server.', ephemeral: true });
      if (!canModerate(interaction.member, target)) return interaction.reply({ content: 'You cannot moderate this user.', ephemeral: true });

      const warnings = addWarning(interaction.guildId, target.id, interaction.user.id, reason);
      addModLog(interaction.guildId, target.id, interaction.user.id, 'warn', reason);

      const embed = modEmbed({
        color: MOD_COLORS.warn,
        title: '⚠️ You Have Been Warned',
        description: `You received a warning in **${interaction.guild.name}**.`,
        fields: [
          { name: 'Reason', value: reason },
          { name: 'Total Warnings', value: String(warnings.length), inline: true },
          { name: 'Moderator', value: interaction.user.tag, inline: true },
        ],
      });
      await dmUser(target.user, embed);

      await sendLog(client, interaction.guildId, 'warn', {
        user: target.user, userId: target.id,
        moderator: interaction.user, moderatorId: interaction.user.id,
        reason,
      });

      await interaction.reply({
        embeds: [modEmbed({ color: MOD_COLORS.warn, title: '⚠️ Warning Issued', description: `Warned ${target.user.tag}. They have ${warnings.length} warning(s).`, fields: [{ name: 'Reason', value: reason }] })],
      });
    },
  },

  // STRIKE
  {
    data: new SlashCommandBuilder()
      .setName('strike')
      .setDescription('Give a member a strike (3 strikes = ban)')
      .addUserOption(o => o.setName('user').setDescription('Member to strike').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for strike').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason');
      if (!target) return interaction.reply({ content: 'User not found.', ephemeral: true });
      if (!canModerate(interaction.member, target)) return interaction.reply({ content: 'You cannot moderate this user.', ephemeral: true });

      const strikes = addStrike(interaction.guildId, target.id, interaction.user.id, reason);
      addModLog(interaction.guildId, target.id, interaction.user.id, 'strike', reason);

      const dmEmbed = strikeEmbed(strikes, target.id);
      dmEmbed.setTitle(`🔴 Strike ${strikes.length}/3 — ${interaction.guild.name}`);
      dmEmbed.setDescription(`You received a strike in **${interaction.guild.name}**.\n**Reason:** ${reason}${strikes.length >= 3 ? '\n\n⛔ **You have been banned for accumulating 3 strikes.**' : ''}`);
      await dmUser(target.user, dmEmbed);

      await sendLog(client, interaction.guildId, 'strike', {
        user: target.user, userId: target.id,
        moderator: interaction.user, moderatorId: interaction.user.id,
        reason,
        extra: { 'Strike Count': `${strikes.length}/3` },
      });

      if (strikes.length >= 3) {
        addModLog(interaction.guildId, target.id, interaction.user.id, 'ban', 'Accumulated 3 strikes');
        await target.ban({ reason: 'Accumulated 3 strikes' });
        clearStrikes(interaction.guildId, target.id);
        await sendLog(client, interaction.guildId, 'strike_ban', {
          user: target.user, userId: target.id,
          moderator: interaction.user, moderatorId: interaction.user.id,
          reason: 'Accumulated 3 strikes',
        });
        return interaction.reply({
          embeds: [modEmbed({ color: MOD_COLORS.ban, title: '🔨 Strike Ban', description: `${target.user.tag} reached 3 strikes and has been **banned**.` })],
        });
      }

      await interaction.reply({
        embeds: [strikeEmbed(strikes, target.id)],
      });
    },
  },

  // STRIKES (view)
  {
    data: new SlashCommandBuilder()
      .setName('strikes')
      .setDescription('View a member\'s strikes')
      .addUserOption(o => o.setName('user').setDescription('Member to check').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      const target = interaction.options.getUser('user');
      const strikes = getStrikes(interaction.guildId, target.id);
      if (!strikes.length) return interaction.reply({ content: `${target.tag} has no strikes.`, ephemeral: true });
      await interaction.reply({ embeds: [strikeEmbed(strikes, target.id)] });
    },
  },

  // CLEARSTRIKES
  {
    data: new SlashCommandBuilder()
      .setName('clearstrikes')
      .setDescription('Clear all strikes for a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      const target = interaction.options.getUser('user');
      clearStrikes(interaction.guildId, target.id);
      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Strikes Cleared', description: `All strikes cleared for ${target.tag}.` })] });
    },
  },

  // MUTE
  {
    data: new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Mute a member')
      .addUserOption(o => o.setName('user').setDescription('Member to mute').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 10m, 1h, 1d). Leave empty for permanent.'))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const durationStr = interaction.options.getString('duration');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: 'User not found.', ephemeral: true });
      if (!canModerate(interaction.member, target)) return interaction.reply({ content: 'You cannot moderate this user.', ephemeral: true });

      const duration = durationStr ? parseDuration(durationStr) : null;
      const { getSettings } = await import('../database.mjs');
      const settings = getSettings(interaction.guildId);
      await applyMute(target, settings, duration, reason, client, interaction.user);
      addModLog(interaction.guildId, target.id, interaction.user.id, 'mute', reason, duration);

      const dmEmbed = modEmbed({
        color: MOD_COLORS.mute,
        title: '🔇 You Have Been Muted',
        description: `You were muted in **${interaction.guild.name}**.`,
        fields: [
          { name: 'Reason', value: reason },
          { name: 'Duration', value: formatDuration(duration), inline: true },
        ],
      });
      await dmUser(target.user, dmEmbed);

      await sendLog(client, interaction.guildId, 'mute', {
        user: target.user, userId: target.id,
        moderator: interaction.user, moderatorId: interaction.user.id,
        reason, duration: formatDuration(duration),
      });

      await interaction.reply({
        embeds: [modEmbed({ color: MOD_COLORS.mute, title: '🔇 Member Muted', description: `Muted ${target.user.tag} for **${formatDuration(duration)}**.`, fields: [{ name: 'Reason', value: reason }] })],
      });
    },
  },

  // UNMUTE
  {
    data: new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Unmute a member')
      .addUserOption(o => o.setName('user').setDescription('Member to unmute').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: 'User not found.', ephemeral: true });

      // Remove timeout
      try { await target.timeout(null, reason); } catch {}

      const { getSettings } = await import('../database.mjs');
      const settings = getSettings(interaction.guildId);
      if (settings.mute_role_id) {
        const muteRole = interaction.guild.roles.cache.get(settings.mute_role_id);
        if (muteRole) await target.roles.remove(muteRole, reason).catch(() => {});
      }

      removeMute(interaction.guildId, target.id);
      addModLog(interaction.guildId, target.id, interaction.user.id, 'unmute', reason);

      const dmEmbed = modEmbed({ color: MOD_COLORS.unmute, title: '🔊 You Have Been Unmuted', description: `You were unmuted in **${interaction.guild.name}**.\n**Reason:** ${reason}` });
      await dmUser(target.user, dmEmbed);

      await sendLog(client, interaction.guildId, 'unmute', {
        user: target.user, userId: target.id,
        moderator: interaction.user, moderatorId: interaction.user.id,
        reason,
      });

      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.unmute, title: '🔊 Member Unmuted', description: `${target.user.tag} has been unmuted.` })] });
    },
  },

  // KICK
  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server')
      .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: 'User not found.', ephemeral: true });
      if (!canModerate(interaction.member, target)) return interaction.reply({ content: 'You cannot moderate this user.', ephemeral: true });

      const dmEmbed = modEmbed({ color: MOD_COLORS.kick, title: '👢 You Have Been Kicked', description: `You were kicked from **${interaction.guild.name}**.\n**Reason:** ${reason}` });
      await dmUser(target.user, dmEmbed);

      await target.kick(reason);
      addModLog(interaction.guildId, target.id, interaction.user.id, 'kick', reason);

      await sendLog(client, interaction.guildId, 'kick', {
        user: target.user, userId: target.id,
        moderator: interaction.user, moderatorId: interaction.user.id,
        reason,
      });

      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.kick, title: '👢 Member Kicked', description: `${target.user.tag} was kicked.\n**Reason:** ${reason}` })] });
    },
  },

  // BAN
  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server')
      .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .addIntegerOption(o => o.setName('delete_days').setDescription('Days of messages to delete (0-7)').setMinValue(0).setMaxValue(7))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user') || await interaction.guild.members.fetch(interaction.options.getUser('user').id).catch(() => null);
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

      if (target && !canModerate(interaction.member, target)) return interaction.reply({ content: 'You cannot moderate this user.', ephemeral: true });

      try {
        const dmEmbed = modEmbed({ color: MOD_COLORS.ban, title: '🔨 You Have Been Banned', description: `You were banned from **${interaction.guild.name}**.\n**Reason:** ${reason}` });
        if (target) await dmUser(target.user, dmEmbed);
      } catch {}

      await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
      addModLog(interaction.guildId, user.id, interaction.user.id, 'ban', reason);

      await sendLog(client, interaction.guildId, 'ban', {
        user, userId: user.id,
        moderator: interaction.user, moderatorId: interaction.user.id,
        reason,
      });

      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.ban, title: '🔨 Member Banned', description: `${user.tag} was banned.\n**Reason:** ${reason}` })] });
    },
  },

  // UNBAN
  {
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user by ID')
      .addStringOption(o => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    async execute(interaction, client) {
      const userId = interaction.options.getString('user_id');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      try {
        const user = await client.users.fetch(userId);
        await interaction.guild.members.unban(userId, reason);
        addModLog(interaction.guildId, userId, interaction.user.id, 'unban', reason);
        await sendLog(client, interaction.guildId, 'unban', {
          user, userId,
          moderator: interaction.user, moderatorId: interaction.user.id,
          reason,
        });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.unban, title: '✅ User Unbanned', description: `${user.tag} has been unbanned.\n**Reason:** ${reason}` })] });
      } catch {
        await interaction.reply({ content: 'Could not unban that user. Are they banned?', ephemeral: true });
      }
    },
  },

  // PURGE
  {
    data: new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Delete multiple messages')
      .addIntegerOption(o => o.setName('amount').setDescription('Number of messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    async execute(interaction, client) {
      const amount = interaction.options.getInteger('amount');
      const targetUser = interaction.options.getUser('user');

      await interaction.deferReply({ ephemeral: true });

      try {
        let messages = await interaction.channel.messages.fetch({ limit: 100 });
        if (targetUser) messages = messages.filter(m => m.author.id === targetUser.id);
        const toDelete = [...messages.values()].slice(0, amount);
        const deleted = await interaction.channel.bulkDelete(toDelete, true);

        await sendLog(client, interaction.guildId, 'purge', {
          moderator: interaction.user, moderatorId: interaction.user.id,
          channel: interaction.channel,
          count: deleted.size,
          description: targetUser ? `Purged ${deleted.size} messages from ${targetUser.tag}` : `Purged ${deleted.size} messages`,
        });

        await interaction.editReply({ content: `Deleted ${deleted.size} messages.` });
      } catch {
        await interaction.editReply({ content: 'Failed to delete messages. Messages older than 14 days cannot be bulk deleted.' });
      }
    },
  },

  // WARNINGS
  {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('View a member\'s warnings')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      const target = interaction.options.getUser('user');
      const warnings = getWarnings(interaction.guildId, target.id);
      if (!warnings.length) return interaction.reply({ content: `${target.tag} has no warnings.`, ephemeral: true });

      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder()
        .setColor(MOD_COLORS.warn)
        .setTitle(`⚠️ Warnings for ${target.tag}`)
        .setDescription(`${warnings.length} total warning(s)`)
        .addFields(warnings.slice(0, 10).map((w, i) => ({
          name: `#${i + 1} — <t:${w.created_at}:R>`,
          value: `**Reason:** ${w.reason}\n**By:** <@${w.moderator_id}>`,
        })))
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    },
  },

  // CLEARWARNINGS
  {
    data: new SlashCommandBuilder()
      .setName('clearwarnings')
      .setDescription('Clear all warnings for a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      const target = interaction.options.getUser('user');
      clearWarnings(interaction.guildId, target.id);
      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Warnings Cleared', description: `All warnings cleared for ${target.tag}.` })] });
    },
  },

  // MODLOGS
  {
    data: new SlashCommandBuilder()
      .setName('modlogs')
      .setDescription('View mod history for a user')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      const target = interaction.options.getUser('user');
      const { getModLogs } = await import('../database.mjs');
      const logs = getModLogs(interaction.guildId, target.id);
      if (!logs.length) return interaction.reply({ content: `No mod history for ${target.tag}.`, ephemeral: true });

      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder()
        .setColor(MOD_COLORS.info)
        .setTitle(`📋 Mod Logs for ${target.tag}`)
        .setDescription(`${logs.length} total action(s)`)
        .addFields(logs.slice(0, 10).map((l, i) => ({
          name: `#${i + 1} ${l.action.toUpperCase()} — <t:${l.created_at}:R>`,
          value: `**Reason:** ${l.reason || 'None'}\n**By:** <@${l.moderator_id}>`,
        })))
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    },
  },
];
