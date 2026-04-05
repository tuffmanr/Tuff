import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';

mkdirSync('./data', { recursive: true });

const db = new DatabaseSync('./data/modbot.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS strikes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS mod_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    duration INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    log_channel_id TEXT,
    welcome_channel_id TEXT,
    mute_role_id TEXT,
    verification_role_id TEXT,
    automod_enabled INTEGER NOT NULL DEFAULT 1,
    spam_protection INTEGER NOT NULL DEFAULT 1,
    link_filter INTEGER NOT NULL DEFAULT 0,
    caps_filter INTEGER NOT NULL DEFAULT 1,
    caps_threshold INTEGER NOT NULL DEFAULT 70,
    raid_protection INTEGER NOT NULL DEFAULT 1,
    bad_words TEXT NOT NULL DEFAULT '[]',
    allowed_links TEXT NOT NULL DEFAULT '[]',
    slowmode_threshold INTEGER NOT NULL DEFAULT 5,
    max_mentions INTEGER NOT NULL DEFAULT 5,
    max_lines INTEGER NOT NULL DEFAULT 15,
    join_age_minimum INTEGER NOT NULL DEFAULT 0,
    welcome_message TEXT NOT NULL DEFAULT 'Welcome to the server, {user}!',
    farewell_message TEXT NOT NULL DEFAULT '{user} has left the server.'
  );

  CREATE TABLE IF NOT EXISTS mutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS join_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

function toPlain(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row));
}

function toPlainAll(rows) {
  return rows.map(toPlain);
}

export function getSettings(guildId) {
  let row = toPlain(db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId));
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)').run(guildId);
    row = toPlain(db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId));
  }
  row.bad_words = JSON.parse(row.bad_words || '[]');
  row.allowed_links = JSON.parse(row.allowed_links || '[]');
  return row;
}

export function updateSettings(guildId, settings) {
  const current = getSettings(guildId);
  const merged = { ...current, ...settings };
  if (Array.isArray(merged.bad_words)) merged.bad_words = JSON.stringify(merged.bad_words);
  if (Array.isArray(merged.allowed_links)) merged.allowed_links = JSON.stringify(merged.allowed_links);
  db.prepare(`
    INSERT INTO guild_settings (guild_id, log_channel_id, welcome_channel_id, mute_role_id, verification_role_id,
      automod_enabled, spam_protection, link_filter, caps_filter, caps_threshold, raid_protection,
      bad_words, allowed_links, slowmode_threshold, max_mentions, max_lines, join_age_minimum,
      welcome_message, farewell_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      log_channel_id = excluded.log_channel_id,
      welcome_channel_id = excluded.welcome_channel_id,
      mute_role_id = excluded.mute_role_id,
      verification_role_id = excluded.verification_role_id,
      automod_enabled = excluded.automod_enabled,
      spam_protection = excluded.spam_protection,
      link_filter = excluded.link_filter,
      caps_filter = excluded.caps_filter,
      caps_threshold = excluded.caps_threshold,
      raid_protection = excluded.raid_protection,
      bad_words = excluded.bad_words,
      allowed_links = excluded.allowed_links,
      slowmode_threshold = excluded.slowmode_threshold,
      max_mentions = excluded.max_mentions,
      max_lines = excluded.max_lines,
      join_age_minimum = excluded.join_age_minimum,
      welcome_message = excluded.welcome_message,
      farewell_message = excluded.farewell_message
  `).run(
    merged.guild_id, merged.log_channel_id ?? null, merged.welcome_channel_id ?? null,
    merged.mute_role_id ?? null, merged.verification_role_id ?? null,
    merged.automod_enabled, merged.spam_protection, merged.link_filter,
    merged.caps_filter, merged.caps_threshold, merged.raid_protection, merged.bad_words,
    merged.allowed_links, merged.slowmode_threshold, merged.max_mentions, merged.max_lines,
    merged.join_age_minimum, merged.welcome_message, merged.farewell_message
  );
}

export function addStrike(guildId, userId, moderatorId, reason) {
  db.prepare('INSERT INTO strikes (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, moderatorId, reason);
  return getStrikes(guildId, userId);
}

export function getStrikes(guildId, userId) {
  return toPlainAll(db.prepare('SELECT * FROM strikes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC').all(guildId, userId));
}

export function clearStrikes(guildId, userId) {
  db.prepare('DELETE FROM strikes WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

export function removeStrike(strikeId) {
  db.prepare('DELETE FROM strikes WHERE id = ?').run(strikeId);
}

export function addWarning(guildId, userId, moderatorId, reason) {
  db.prepare('INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, moderatorId, reason);
  return toPlainAll(db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC').all(guildId, userId));
}

export function getWarnings(guildId, userId) {
  return toPlainAll(db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC').all(guildId, userId));
}

export function clearWarnings(guildId, userId) {
  db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

export function addModLog(guildId, userId, moderatorId, action, reason, duration = null) {
  db.prepare('INSERT INTO mod_logs (guild_id, user_id, moderator_id, action, reason, duration) VALUES (?, ?, ?, ?, ?, ?)').run(guildId, userId, moderatorId, action, reason ?? null, duration);
}

export function getModLogs(guildId, userId) {
  return toPlainAll(db.prepare('SELECT * FROM mod_logs WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50').all(guildId, userId));
}

export function addMute(guildId, userId, expiresAt = null) {
  db.prepare('INSERT OR REPLACE INTO mutes (guild_id, user_id, expires_at) VALUES (?, ?, ?)').run(guildId, userId, expiresAt);
}

export function removeMute(guildId, userId) {
  db.prepare('DELETE FROM mutes WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

export function getExpiredMutes() {
  return toPlainAll(db.prepare('SELECT * FROM mutes WHERE expires_at IS NOT NULL AND expires_at <= ?').all(Math.floor(Date.now() / 1000)));
}

export function logJoin(guildId, userId) {
  db.prepare('INSERT INTO join_log (guild_id, user_id) VALUES (?, ?)').run(guildId, userId);
}

export function getRecentJoins(guildId, seconds) {
  const since = Math.floor(Date.now() / 1000) - seconds;
  return toPlainAll(db.prepare('SELECT * FROM join_log WHERE guild_id = ? AND joined_at >= ?').all(guildId, since));
}

export default db;
