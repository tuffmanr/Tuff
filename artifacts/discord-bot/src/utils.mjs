import { EmbedBuilder, Colors } from 'discord.js';

export function parseDuration(str) {
  if (!str) return null;
  const units = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const match = str.match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  return parseInt(match[1]) * (units[match[2].toLowerCase()] || 0);
}

export function formatDuration(seconds) {
  if (!seconds) return 'Permanent';
  const units = [
    { label: 'week', secs: 604800 },
    { label: 'day', secs: 86400 },
    { label: 'hour', secs: 3600 },
    { label: 'minute', secs: 60 },
    { label: 'second', secs: 1 },
  ];
  for (const u of units) {
    if (seconds >= u.secs) {
      const val = Math.floor(seconds / u.secs);
      return `${val} ${u.label}${val !== 1 ? 's' : ''}`;
    }
  }
  return `${seconds}s`;
}

export function formatTimestamp(unixSecs) {
  return `<t:${unixSecs}:F>`;
}

export function modEmbed({ color, title, description, fields = [], footer }) {
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  if (fields.length) e.addFields(fields);
  if (footer) e.setFooter({ text: footer });
  return e;
}

export const MOD_COLORS = {
  warn: Colors.Yellow,
  strike: Colors.Orange,
  mute: Colors.DarkOrange,
  kick: Colors.Red,
  ban: Colors.DarkRed,
  unban: Colors.Green,
  unmute: Colors.Green,
  info: Colors.Blue,
  success: Colors.Green,
  error: Colors.Red,
  automod: Colors.Purple,
  join: Colors.Green,
  leave: Colors.Grey,
  lockdown: Colors.DarkRed,
};

export async function dmUser(user, embed) {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

export function isModerator(member) {
  return member.permissions.has('ModerateMembers') ||
    member.permissions.has('BanMembers') ||
    member.permissions.has('KickMembers') ||
    member.permissions.has('ManageGuild') ||
    member.permissions.has('Administrator');
}

export function isAdmin(member) {
  return member.permissions.has('Administrator') || member.permissions.has('ManageGuild');
}

export function canModerate(moderator, target) {
  if (target.id === moderator.guild.ownerId) return false;
  if (moderator.id === moderator.guild.ownerId) return true;
  if (!moderator.roles.highest || !target.roles.highest) return false;
  return moderator.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

export function strikeEmbed(strikes, userId) {
  const count = strikes.length;
  const color = count >= 3 ? Colors.DarkRed : count === 2 ? Colors.Orange : Colors.Yellow;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`Strike ${count}/3`)
    .setDescription(`<@${userId}> now has **${count} strike${count !== 1 ? 's' : ''}**.`)
    .addFields(
      strikes.slice(0, 5).map((s, i) => ({
        name: `Strike #${i + 1} — <t:${s.created_at}:R>`,
        value: `**Reason:** ${s.reason}\n**By:** <@${s.moderator_id}>`,
      }))
    )
    .setTimestamp();
}
