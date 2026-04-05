import {
  addStrike, getStrikes, clearStrikes,
  addWarning, getWarnings, clearWarnings,
  addModLog, getModLogs,
  addMute, removeMute, getSettings,
} from './database.mjs';
import { sendLog } from './logger.mjs';
import { dmUser, modEmbed, MOD_COLORS, parseDuration, formatDuration, canModerate, strikeEmbed, isModerator, isAdmin } from './utils.mjs';

const PREFIX = '!';

function args(content, prefix, name) {
  return content.slice(prefix.length + name.length).trim().split(/\s+/).filter(Boolean);
}

async function resolveMember(guild, mention) {
  const id = mention.replace(/[<@!>]/g, '');
  return guild.members.fetch(id).catch(() => null);
}

async function resolveUser(client, mention) {
  const id = mention.replace(/[<@!>]/g, '');
  return client.users.fetch(id).catch(() => null);
}

export async function handlePrefix(message, client) {
  if (!message.guild || message.author.bot) return;
  const content = message.content;
  if (!content.startsWith(PREFIX)) return;

  const parts = content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const rest = parts.slice(1);

  switch (cmd) {
    // !help
    case 'help': {
      const embed = modEmbed({
        color: MOD_COLORS.info,
        title: '📖 ModBot — Prefix Commands (!)',
        description: 'All commands also available as slash commands (/).',
      });
      embed.addFields(
        {
          name: '⚖️ Moderation',
          value: [
            '`!warn @user <reason>` — Warn a member',
            '`!strike @user <reason>` — Strike (3 = ban)',
            '`!strikes @user` — View strikes',
            '`!clearstrikes @user` — Clear strikes',
            '`!mute @user [duration] [reason]` — Mute',
            '`!unmute @user` — Unmute',
            '`!kick @user [reason]` — Kick',
            '`!ban @user [reason]` — Ban',
            '`!unban <userId> [reason]` — Unban',
            '`!purge <amount>` — Delete messages',
            '`!warnings @user` — View warnings',
            '`!clearwarnings @user` — Clear warnings',
            '`!modlogs @user` — Mod history',
          ].join('\n'),
        },
        {
          name: '🔒 Server',
          value: [
            '`!lockdown [reason]` — Lock this channel',
            '`!unlock [reason]` — Unlock this channel',
            '`!lockall [reason]` — Lock entire server',
            '`!unlockall [reason]` — Unlock entire server',
            '`!slowmode <duration|off>` — Set slowmode',
          ].join('\n'),
        },
        {
          name: '📋 Info',
          value: [
            '`!userinfo [@user]` — User details',
            '`!serverinfo` — Server details',
            '`!avatar [@user]` — View avatar',
            '`!ping` — Bot latency',
          ].join('\n'),
        }
      );
      return message.channel.send({ embeds: [embed] });
    }

    // !ping
    case 'ping': {
      const sent = await message.channel.send('Pinging...');
      const latency = sent.createdTimestamp - message.createdTimestamp;
      sent.edit({ content: null, embeds: [modEmbed({ color: MOD_COLORS.info, title: '🏓 Pong!', description: `Bot: **${latency}ms** | API: **${Math.round(client.ws.ping)}ms**` })] });
      return;
    }

    // !warn @user <reason>
    case 'warn': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveMember(message.guild, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid member.');
      if (!canModerate(message.member, target)) return message.reply('❌ You cannot moderate this user.');
      const reason = rest.slice(1).join(' ') || 'No reason provided';
      const warnings = addWarning(message.guildId, target.id, message.author.id, reason);
      addModLog(message.guildId, target.id, message.author.id, 'warn', reason);
      await dmUser(target.user, modEmbed({ color: MOD_COLORS.warn, title: '⚠️ You Have Been Warned', description: `You were warned in **${message.guild.name}**.\n**Reason:** ${reason}\n**Total warnings:** ${warnings.length}` }));
      await sendLog(client, message.guildId, 'warn', { user: target.user, userId: target.id, moderator: message.author, moderatorId: message.author.id, reason });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.warn, title: '⚠️ Warning Issued', description: `Warned ${target.user.tag}. They now have ${warnings.length} warning(s).\n**Reason:** ${reason}` })] });
    }

    // !strike @user <reason>
    case 'strike': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveMember(message.guild, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid member.');
      if (!canModerate(message.member, target)) return message.reply('❌ You cannot moderate this user.');
      const reason = rest.slice(1).join(' ') || 'No reason provided';
      const strikes = addStrike(message.guildId, target.id, message.author.id, reason);
      addModLog(message.guildId, target.id, message.author.id, 'strike', reason);
      const dmEmbed = strikeEmbed(strikes, target.id);
      dmEmbed.setDescription(`You received a strike in **${message.guild.name}**.\n**Reason:** ${reason}${strikes.length >= 3 ? '\n\n⛔ **You have been banned for 3 strikes.**' : ''}`);
      await dmUser(target.user, dmEmbed);
      await sendLog(client, message.guildId, 'strike', { user: target.user, userId: target.id, moderator: message.author, moderatorId: message.author.id, reason, extra: { 'Strike Count': `${strikes.length}/3` } });
      if (strikes.length >= 3) {
        await target.ban({ reason: 'Accumulated 3 strikes' });
        clearStrikes(message.guildId, target.id);
        addModLog(message.guildId, target.id, message.author.id, 'ban', '3 strikes');
        return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.ban, title: '🔨 Strike Ban', description: `${target.user.tag} hit 3 strikes and was **banned**.` })] });
      }
      return message.channel.send({ embeds: [strikeEmbed(strikes, target.id)] });
    }

    // !strikes @user
    case 'strikes': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveUser(client, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid user.');
      const strikes = getStrikes(message.guildId, target.id);
      if (!strikes.length) return message.reply(`${target.tag} has no strikes.`);
      return message.channel.send({ embeds: [strikeEmbed(strikes, target.id)] });
    }

    // !clearstrikes @user
    case 'clearstrikes': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveUser(client, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid user.');
      clearStrikes(message.guildId, target.id);
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Strikes Cleared', description: `All strikes cleared for ${target.tag}.` })] });
    }

    // !mute @user [duration] [reason]
    case 'mute': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveMember(message.guild, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid member.');
      if (!canModerate(message.member, target)) return message.reply('❌ You cannot moderate this user.');
      let duration = null;
      let reasonStart = 1;
      if (rest[1] && parseDuration(rest[1])) { duration = parseDuration(rest[1]); reasonStart = 2; }
      const reason = rest.slice(reasonStart).join(' ') || 'No reason provided';
      const ms = duration ? duration * 1000 : 28 * 24 * 60 * 60 * 1000;
      await target.timeout(ms, reason);
      addMute(message.guildId, target.id, duration ? Math.floor(Date.now() / 1000) + duration : null);
      addModLog(message.guildId, target.id, message.author.id, 'mute', reason, duration);
      await dmUser(target.user, modEmbed({ color: MOD_COLORS.mute, title: '🔇 You Have Been Muted', description: `You were muted in **${message.guild.name}**.\n**Reason:** ${reason}\n**Duration:** ${formatDuration(duration)}` }));
      await sendLog(client, message.guildId, 'mute', { user: target.user, userId: target.id, moderator: message.author, moderatorId: message.author.id, reason, duration: formatDuration(duration) });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.mute, title: '🔇 Member Muted', description: `Muted ${target.user.tag} for **${formatDuration(duration)}**.\n**Reason:** ${reason}` })] });
    }

    // !unmute @user
    case 'unmute': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveMember(message.guild, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid member.');
      await target.timeout(null, 'Unmuted').catch(() => {});
      const settings = getSettings(message.guildId);
      if (settings.mute_role_id) {
        const r = message.guild.roles.cache.get(settings.mute_role_id);
        if (r) await target.roles.remove(r).catch(() => {});
      }
      removeMute(message.guildId, target.id);
      addModLog(message.guildId, target.id, message.author.id, 'unmute', 'Unmuted via prefix command');
      await dmUser(target.user, modEmbed({ color: MOD_COLORS.unmute, title: '🔊 You Have Been Unmuted', description: `You were unmuted in **${message.guild.name}**.` }));
      await sendLog(client, message.guildId, 'unmute', { user: target.user, userId: target.id, moderator: message.author, moderatorId: message.author.id });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.unmute, title: '🔊 Member Unmuted', description: `${target.user.tag} has been unmuted.` })] });
    }

    // !kick @user [reason]
    case 'kick': {
      if (!message.member.permissions.has('KickMembers')) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveMember(message.guild, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid member.');
      if (!canModerate(message.member, target)) return message.reply('❌ You cannot moderate this user.');
      const reason = rest.slice(1).join(' ') || 'No reason provided';
      await dmUser(target.user, modEmbed({ color: MOD_COLORS.kick, title: '👢 You Have Been Kicked', description: `You were kicked from **${message.guild.name}**.\n**Reason:** ${reason}` }));
      await target.kick(reason);
      addModLog(message.guildId, target.id, message.author.id, 'kick', reason);
      await sendLog(client, message.guildId, 'kick', { user: target.user, userId: target.id, moderator: message.author, moderatorId: message.author.id, reason });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.kick, title: '👢 Member Kicked', description: `${target.user.tag} was kicked.\n**Reason:** ${reason}` })] });
    }

    // !ban @user [reason]
    case 'ban': {
      if (!message.member.permissions.has('BanMembers')) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveMember(message.guild, rest[0]) : null;
      const user = target?.user || (rest[0] ? await resolveUser(client, rest[0]) : null);
      if (!user) return message.reply('❌ Mention a valid user.');
      if (target && !canModerate(message.member, target)) return message.reply('❌ You cannot moderate this user.');
      const reason = rest.slice(1).join(' ') || 'No reason provided';
      if (target) await dmUser(user, modEmbed({ color: MOD_COLORS.ban, title: '🔨 You Have Been Banned', description: `You were banned from **${message.guild.name}**.\n**Reason:** ${reason}` }));
      await message.guild.members.ban(user.id, { reason });
      addModLog(message.guildId, user.id, message.author.id, 'ban', reason);
      await sendLog(client, message.guildId, 'ban', { user, userId: user.id, moderator: message.author, moderatorId: message.author.id, reason });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.ban, title: '🔨 Member Banned', description: `${user.tag} was banned.\n**Reason:** ${reason}` })] });
    }

    // !unban <userId> [reason]
    case 'unban': {
      if (!message.member.permissions.has('BanMembers')) return message.reply('❌ Missing permissions.');
      const userId = rest[0]?.replace(/[<@!>]/g, '');
      if (!userId) return message.reply('❌ Provide a user ID.');
      const reason = rest.slice(1).join(' ') || 'No reason provided';
      try {
        const user = await client.users.fetch(userId);
        await message.guild.members.unban(userId, reason);
        addModLog(message.guildId, userId, message.author.id, 'unban', reason);
        await sendLog(client, message.guildId, 'unban', { user, userId, moderator: message.author, moderatorId: message.author.id, reason });
        return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.unban, title: '✅ User Unbanned', description: `${user.tag} was unbanned.\n**Reason:** ${reason}` })] });
      } catch {
        return message.reply('❌ Could not unban that user. Are they banned?');
      }
    }

    // !purge <amount> [@user]
    case 'purge':
    case 'clear': {
      if (!message.member.permissions.has('ManageMessages')) return message.reply('❌ Missing permissions.');
      const amount = parseInt(rest[0]);
      if (!amount || amount < 1 || amount > 100) return message.reply('❌ Provide a number between 1-100.');
      const filterUser = rest[1] ? await resolveUser(client, rest[1]) : null;
      await message.delete().catch(() => {});
      let msgs = await message.channel.messages.fetch({ limit: 100 });
      if (filterUser) msgs = msgs.filter(m => m.author.id === filterUser.id);
      const toDelete = [...msgs.values()].slice(0, amount);
      const deleted = await message.channel.bulkDelete(toDelete, true).catch(() => ({ size: 0 }));
      await sendLog(client, message.guildId, 'purge', { moderator: message.author, moderatorId: message.author.id, channel: message.channel, count: deleted.size });
      const notice = await message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.info, title: '🗑️ Purged', description: `Deleted ${deleted.size} message(s).` })] });
      setTimeout(() => notice.delete().catch(() => {}), 4000);
      return;
    }

    // !warnings @user
    case 'warnings': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveUser(client, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid user.');
      const warnings = getWarnings(message.guildId, target.id);
      if (!warnings.length) return message.reply(`${target.tag} has no warnings.`);
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder().setColor(MOD_COLORS.warn).setTitle(`⚠️ Warnings for ${target.tag}`).setDescription(`${warnings.length} total`)
        .addFields(warnings.slice(0, 10).map((w, i) => ({ name: `#${i + 1} — <t:${w.created_at}:R>`, value: `**Reason:** ${w.reason}\n**By:** <@${w.moderator_id}>` }))).setTimestamp();
      return message.channel.send({ embeds: [embed] });
    }

    // !clearwarnings @user
    case 'clearwarnings': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveUser(client, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid user.');
      clearWarnings(message.guildId, target.id);
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Warnings Cleared', description: `All warnings cleared for ${target.tag}.` })] });
    }

    // !modlogs @user
    case 'modlogs': {
      if (!isModerator(message.member)) return message.reply('❌ Missing permissions.');
      const target = rest[0] ? await resolveUser(client, rest[0]) : null;
      if (!target) return message.reply('❌ Mention a valid user.');
      const logs = getModLogs(message.guildId, target.id);
      if (!logs.length) return message.reply(`No mod history for ${target.tag}.`);
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder().setColor(MOD_COLORS.info).setTitle(`📋 Mod Logs for ${target.tag}`).setDescription(`${logs.length} total action(s)`)
        .addFields(logs.slice(0, 10).map((l, i) => ({ name: `#${i + 1} ${l.action.toUpperCase()} — <t:${l.created_at}:R>`, value: `**Reason:** ${l.reason || 'None'}\n**By:** <@${l.moderator_id}>` }))).setTimestamp();
      return message.channel.send({ embeds: [embed] });
    }

    // !lockdown [reason]
    case 'lockdown': {
      if (!message.member.permissions.has('ManageChannels')) return message.reply('❌ Missing permissions.');
      const reason = rest.join(' ') || 'No reason provided';
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }, { reason });
      await sendLog(client, message.guildId, 'lockdown', { moderator: message.author, moderatorId: message.author.id, channel: message.channel, reason });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.lockdown, title: '🔒 Channel Locked', description: `This channel has been locked.\n**Reason:** ${reason}` })] });
    }

    // !unlock [reason]
    case 'unlock': {
      if (!message.member.permissions.has('ManageChannels')) return message.reply('❌ Missing permissions.');
      const reason = rest.join(' ') || 'No reason provided';
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }, { reason });
      await sendLog(client, message.guildId, 'unlockdown', { moderator: message.author, moderatorId: message.author.id, channel: message.channel, reason });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '🔓 Channel Unlocked', description: `This channel has been unlocked.\n**Reason:** ${reason}` })] });
    }

    // !lockall [reason]
    case 'lockall': {
      if (!isAdmin(message.member)) return message.reply('❌ Missing permissions.');
      const reason = rest.join(' ') || 'Server lockdown';
      const channels = message.guild.channels.cache.filter(c => c.type === 0);
      let count = 0;
      for (const [, ch] of channels) { try { await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }, { reason }); count++; } catch {} }
      await sendLog(client, message.guildId, 'lockdown', { moderator: message.author, moderatorId: message.author.id, reason, description: `🚨 Server-wide lockdown: ${count} channels locked.` });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.lockdown, title: '🔒 Server Lockdown', description: `Locked **${count}** channels.\n**Reason:** ${reason}` })] });
    }

    // !unlockall [reason]
    case 'unlockall': {
      if (!isAdmin(message.member)) return message.reply('❌ Missing permissions.');
      const reason = rest.join(' ') || 'Lockdown lifted';
      const channels = message.guild.channels.cache.filter(c => c.type === 0);
      let count = 0;
      for (const [, ch] of channels) { try { await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }, { reason }); count++; } catch {} }
      await sendLog(client, message.guildId, 'unlockdown', { moderator: message.author, moderatorId: message.author.id, reason, description: `✅ Lockdown lifted: ${count} channels unlocked.` });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '🔓 Lockdown Lifted', description: `Unlocked **${count}** channels.\n**Reason:** ${reason}` })] });
    }

    // !slowmode <duration|off>
    case 'slowmode': {
      if (!message.member.permissions.has('ManageChannels')) return message.reply('❌ Missing permissions.');
      const d = rest[0];
      if (!d) return message.reply('❌ Usage: `!slowmode <duration|off>` e.g. `!slowmode 5s`');
      const seconds = d.toLowerCase() === 'off' ? 0 : (parseDuration(d) || 0);
      await message.channel.setRateLimitPerUser(seconds);
      await sendLog(client, message.guildId, 'slowmode', { moderator: message.author, moderatorId: message.author.id, channel: message.channel, description: seconds === 0 ? 'Slowmode disabled' : `Slowmode set to ${formatDuration(seconds)}` });
      return message.channel.send({ embeds: [modEmbed({ color: MOD_COLORS.info, title: '⏱️ Slowmode', description: seconds === 0 ? 'Slowmode disabled.' : `Slowmode set to **${formatDuration(seconds)}**.` })] });
    }

    // !userinfo [@user]
    case 'userinfo':
    case 'whois': {
      const target = rest[0] ? await resolveMember(message.guild, rest[0]) : message.member;
      if (!target) return message.reply('❌ User not found.');
      const user = target.user;
      const strikes = getStrikes(message.guildId, user.id);
      const warnings = getWarnings(message.guildId, user.id);
      const roles = target.roles.cache.filter(r => r.id !== message.guild.roles.everyone.id).sort((a, b) => b.position - a.position).map(r => `<@&${r.id}>`).slice(0, 10).join(', ') || 'None';
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder().setColor(target.displayHexColor || MOD_COLORS.info).setTitle(`👤 ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'ID', value: user.id, inline: true },
          { name: 'Nickname', value: target.nickname || 'None', inline: true },
          { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: true },
          { name: 'Joined Server', value: target.joinedTimestamp ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:F>` : 'Unknown', inline: true },
          { name: 'Strikes', value: `${strikes.length}/3`, inline: true },
          { name: 'Warnings', value: String(warnings.length), inline: true },
          { name: `Roles (${target.roles.cache.size - 1})`, value: roles },
        ).setTimestamp();
      return message.channel.send({ embeds: [embed] });
    }

    // !serverinfo
    case 'serverinfo': {
      const guild = message.guild;
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder().setColor(MOD_COLORS.info).setTitle(`🏠 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: 'Members', value: String(guild.memberCount), inline: true },
          { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
          { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
          { name: 'Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
          { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true },
        ).setTimestamp();
      return message.channel.send({ embeds: [embed] });
    }

    // !avatar [@user]
    case 'avatar': {
      const user = rest[0] ? await resolveUser(client, rest[0]) : message.author;
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder().setColor(MOD_COLORS.info).setTitle(`🖼️ ${user.tag}'s Avatar`).setImage(user.displayAvatarURL({ size: 1024 })).setTimestamp();
      return message.channel.send({ embeds: [embed] });
    }

    default:
      break;
  }
}
