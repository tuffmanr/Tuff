import { getSettings } from './database.mjs';
import { sendLog } from './logger.mjs';
import { dmUser, modEmbed, MOD_COLORS } from './utils.mjs';

const spamMap = new Map();
const SPAM_WINDOW = 5000;
const SPAM_THRESHOLD = 5;

function trackSpam(userId) {
  const now = Date.now();
  if (!spamMap.has(userId)) spamMap.set(userId, []);
  const times = spamMap.get(userId).filter(t => now - t < SPAM_WINDOW);
  times.push(now);
  spamMap.set(userId, times);
  return times.length;
}

const URL_REGEX = /https?:\/\/[^\s]+/gi;
const INVITE_REGEX = /(discord\.gg|discord\.com\/invite)\/\w+/gi;
const EVERYONE_REGEX = /@(everyone|here)/g;

export async function runAutomod(message, client) {
  if (!message.guild || message.author.bot) return false;
  if (message.member?.permissions.has('ModerateMembers')) return false;

  const settings = getSettings(message.guild.id);
  if (!settings.automod_enabled) return false;

  const content = message.content;
  const member = message.member;

  // Bad word filter
  if (settings.bad_words.length > 0) {
    const lower = content.toLowerCase();
    const found = settings.bad_words.find(w => lower.includes(w.toLowerCase()));
    if (found) {
      await handleViolation(message, client, `Bad word detected: \`${found}\``, 'automod');
      return true;
    }
  }

  // Discord invite filter
  if (INVITE_REGEX.test(content)) {
    const isAllowed = settings.allowed_links.some(l => content.includes(l));
    if (!isAllowed) {
      await handleViolation(message, client, 'Unauthorized Discord invite link', 'automod');
      return true;
    }
  }
  INVITE_REGEX.lastIndex = 0;

  // Link filter
  if (settings.link_filter && URL_REGEX.test(content)) {
    const urls = content.match(URL_REGEX) || [];
    const isAllowed = urls.every(url => settings.allowed_links.some(l => url.includes(l)));
    if (!isAllowed) {
      await handleViolation(message, client, 'Unauthorized link', 'automod');
      return true;
    }
  }
  URL_REGEX.lastIndex = 0;

  // Caps filter
  if (settings.caps_filter && content.length > 10) {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 5) {
      const upperPct = (content.replace(/[^A-Z]/g, '').length / letters.length) * 100;
      if (upperPct >= settings.caps_threshold) {
        await handleViolation(message, client, `Excessive caps (${Math.round(upperPct)}%)`, 'automod');
        return true;
      }
    }
  }

  // Mention spam
  const mentions = message.mentions.users.size + message.mentions.roles.size;
  if (mentions > settings.max_mentions) {
    await handleViolation(message, client, `Mass mention (${mentions} mentions)`, 'automod');
    return true;
  }

  // Line spam
  const lines = content.split('\n').length;
  if (lines > settings.max_lines) {
    await handleViolation(message, client, `Excessive line count (${lines} lines)`, 'automod');
    return true;
  }

  // Spam detection
  if (settings.spam_protection) {
    const count = trackSpam(message.author.id);
    if (count >= SPAM_THRESHOLD) {
      spamMap.set(message.author.id, []);
      await handleViolation(message, client, 'Spam detected', 'automod', true);
      return true;
    }
  }

  return false;
}

async function handleViolation(message, client, reason, action, mute = false) {
  try {
    await message.delete().catch(() => {});

    const embed = modEmbed({
      color: MOD_COLORS.automod,
      title: '🤖 AutoMod',
      description: `Your message in **${message.guild.name}** was removed.\n**Reason:** ${reason}`,
    });
    await dmUser(message.author, embed);

    if (mute && message.member) {
      try {
        await message.member.timeout(60 * 1000, `AutoMod: ${reason}`);
      } catch {}
    }

    await sendLog(client, message.guild.id, 'automod', {
      user: message.author,
      userId: message.author.id,
      channel: message.channel,
      reason,
      description: mute ? 'Message deleted + 60s timeout applied' : 'Message deleted',
    });
  } catch (err) {
    console.error('AutoMod error:', err.message);
  }
}

// Raid protection: if X joins happen within Y seconds, lock the server
const raidTracker = new Map();
export async function checkRaid(member, client) {
  const guildId = member.guild.id;
  const settings = getSettings(guildId);
  if (!settings.raid_protection) return;

  if (!raidTracker.has(guildId)) raidTracker.set(guildId, []);
  const now = Date.now();
  const joins = raidTracker.get(guildId).filter(t => now - t < 10000);
  joins.push(now);
  raidTracker.set(guildId, joins);

  if (joins.length >= 10) {
    raidTracker.set(guildId, []);
    await activateRaidMode(member.guild, client);
  }

  // Account age check
  if (settings.join_age_minimum > 0) {
    const accountAge = (Date.now() - member.user.createdTimestamp) / 1000;
    if (accountAge < settings.join_age_minimum) {
      try {
        await member.kick(`Account too new (${Math.floor(accountAge / 3600)}h old, minimum ${Math.floor(settings.join_age_minimum / 3600)}h required)`);
        await sendLog(client, guildId, 'kick', {
          user: member.user,
          userId: member.id,
          moderator: client.user,
          moderatorId: client.user.id,
          reason: `Security: Account too new (${Math.floor(accountAge / 3600)}h old)`,
        });
      } catch {}
    }
  }
}

async function activateRaidMode(guild, client) {
  try {
    const channels = guild.channels.cache.filter(c => c.isTextBased() && c.permissionsFor(guild.roles.everyone));
    for (const [, channel] of channels) {
      try {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      } catch {}
    }
    await sendLog(client, guild.id, 'lockdown', {
      description: '🚨 **RAID DETECTED** — Server locked down automatically. Use `/unlock` to restore access.',
    });
  } catch (err) {
    console.error('Raid lockdown error:', err.message);
  }
}
