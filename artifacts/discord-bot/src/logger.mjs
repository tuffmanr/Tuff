import { EmbedBuilder } from 'discord.js';
import { getSettings } from './database.mjs';
import { MOD_COLORS } from './utils.mjs';

const ACTION_TITLES = {
  warn: '⚠️ Warning Issued',
  strike: '🔴 Strike Issued',
  strike_ban: '🔨 Auto-Ban (3 Strikes)',
  mute: '🔇 Member Muted',
  unmute: '🔊 Member Unmuted',
  kick: '👢 Member Kicked',
  ban: '🔨 Member Banned',
  unban: '✅ Member Unbanned',
  automod: '🤖 AutoMod Action',
  lockdown: '🔒 Channel Lockdown',
  unlockdown: '🔓 Channel Unlocked',
  slowmode: '⏱️ Slowmode Updated',
  purge: '🗑️ Messages Purged',
  join: '📥 Member Joined',
  leave: '📤 Member Left',
  verify: '✅ Member Verified',
};

export async function sendLog(client, guildId, action, data = {}) {
  try {
    const settings = getSettings(guildId);
    if (!settings.log_channel_id) return;
    const channel = await client.channels.fetch(settings.log_channel_id).catch(() => null);
    if (!channel) return;

    const color = MOD_COLORS[action] || MOD_COLORS.info;
    const title = ACTION_TITLES[action] || action.toUpperCase();

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setTimestamp();

    if (data.user) {
      embed.addFields({ name: 'User', value: `${data.user.tag || data.user} (${data.userId || data.user.id})`, inline: true });
    }
    if (data.moderator) {
      embed.addFields({ name: 'Moderator', value: `${data.moderator.tag || data.moderator} (${data.moderatorId || data.moderator.id})`, inline: true });
    }
    if (data.reason) {
      embed.addFields({ name: 'Reason', value: data.reason });
    }
    if (data.duration) {
      embed.addFields({ name: 'Duration', value: data.duration, inline: true });
    }
    if (data.channel) {
      embed.addFields({ name: 'Channel', value: `<#${data.channel.id || data.channel}>`, inline: true });
    }
    if (data.count !== undefined) {
      embed.addFields({ name: 'Count', value: String(data.count), inline: true });
    }
    if (data.extra) {
      for (const [name, value] of Object.entries(data.extra)) {
        embed.addFields({ name, value: String(value), inline: true });
      }
    }
    if (data.description) {
      embed.setDescription(data.description);
    }

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send log:', err.message);
  }
}
