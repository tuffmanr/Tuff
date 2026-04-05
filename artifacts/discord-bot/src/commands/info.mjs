import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getStrikes, getWarnings, getModLogs } from '../database.mjs';
import { MOD_COLORS } from '../utils.mjs';

export const commands = [
  // USERINFO
  {
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('View info about a user')
      .addUserOption(o => o.setName('user').setDescription('User to look up'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      const target = interaction.options.getMember('user') || interaction.member;
      const user = target.user;
      const strikes = getStrikes(interaction.guildId, user.id);
      const warnings = getWarnings(interaction.guildId, user.id);

      const roles = target.roles.cache
        .filter(r => r.id !== interaction.guild.roles.everyone.id)
        .sort((a, b) => b.position - a.position)
        .map(r => `<@&${r.id}>`)
        .slice(0, 10)
        .join(', ') || 'None';

      const embed = new EmbedBuilder()
        .setColor(target.displayHexColor || MOD_COLORS.info)
        .setTitle(`👤 ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'ID', value: user.id, inline: true },
          { name: 'Nickname', value: target.nickname || 'None', inline: true },
          { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
          { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: true },
          { name: 'Joined Server', value: target.joinedTimestamp ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:F>` : 'Unknown', inline: true },
          { name: 'Strikes', value: `${strikes.length}/3`, inline: true },
          { name: 'Warnings', value: String(warnings.length), inline: true },
          { name: `Roles (${target.roles.cache.size - 1})`, value: roles },
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    },
  },

  // SERVERINFO
  {
    data: new SlashCommandBuilder()
      .setName('serverinfo')
      .setDescription('View server information'),
    async execute(interaction) {
      const guild = interaction.guild;
      await guild.fetch();

      const embed = new EmbedBuilder()
        .setColor(MOD_COLORS.info)
        .setTitle(`🏠 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: 'Members', value: String(guild.memberCount), inline: true },
          { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
          { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
          { name: 'Boost Level', value: `Level ${guild.premiumTier}`, inline: true },
          { name: 'Boosts', value: String(guild.premiumSubscriptionCount || 0), inline: true },
          { name: 'Verification Level', value: ['None', 'Low', 'Medium', 'High', 'Very High'][guild.verificationLevel], inline: true },
          { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true },
          { name: 'Server ID', value: guild.id, inline: true },
        )
        .setFooter({ text: `Requested by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    },
  },

  // AVATAR
  {
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('View a user\'s avatar')
      .addUserOption(o => o.setName('user').setDescription('User')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const embed = new EmbedBuilder()
        .setColor(MOD_COLORS.info)
        .setTitle(`🖼️ ${user.tag}'s Avatar`)
        .setImage(user.displayAvatarURL({ size: 1024 }))
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    },
  },

  // ROLEINFO
  {
    data: new SlashCommandBuilder()
      .setName('roleinfo')
      .setDescription('View info about a role')
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
    async execute(interaction) {
      const role = interaction.options.getRole('role');
      const perms = role.permissions.toArray().join(', ') || 'None';

      const embed = new EmbedBuilder()
        .setColor(role.hexColor)
        .setTitle(`🏷️ Role: ${role.name}`)
        .addFields(
          { name: 'ID', value: role.id, inline: true },
          { name: 'Color', value: role.hexColor, inline: true },
          { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
          { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
          { name: 'Members', value: String(role.members.size), inline: true },
          { name: 'Position', value: String(role.position), inline: true },
          { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:F>`, inline: false },
          { name: 'Permissions', value: perms.length > 1024 ? perms.slice(0, 1020) + '...' : perms || 'None', inline: false },
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    },
  },

  // PING
  {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Check bot latency'),
    async execute(interaction) {
      const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
      const embed = new EmbedBuilder()
        .setColor(MOD_COLORS.info)
        .setTitle('🏓 Pong!')
        .addFields(
          { name: 'Bot Latency', value: `${sent.createdTimestamp - interaction.createdTimestamp}ms`, inline: true },
          { name: 'API Latency', value: `${Math.round(interaction.client.ws.ping)}ms`, inline: true },
        );
      await interaction.editReply({ content: null, embeds: [embed] });
    },
  },

  // HELP
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show all available commands'),
    async execute(interaction) {
      const embed = new EmbedBuilder()
        .setColor(MOD_COLORS.info)
        .setTitle('📖 ModBot Commands')
        .setDescription('A full-featured moderation bot with AutoMod, strikes, and security.')
        .addFields(
          {
            name: '⚖️ Moderation',
            value: [
              '`/warn` — Warn a member',
              '`/strike` — Strike a member (3 = auto-ban)',
              '`/strikes` — View member strikes',
              '`/clearstrikes` — Clear all strikes',
              '`/mute` — Mute with optional duration',
              '`/unmute` — Unmute a member',
              '`/kick` — Kick a member',
              '`/ban` — Ban a member',
              '`/unban` — Unban by user ID',
              '`/purge` — Bulk delete messages',
              '`/warnings` — View warnings',
              '`/clearwarnings` — Clear warnings',
              '`/modlogs` — Full mod history',
            ].join('\n'),
          },
          {
            name: '🔒 Server Security',
            value: [
              '`/lockdown` — Lock a channel',
              '`/unlock` — Unlock a channel',
              '`/lockall` — Lock entire server',
              '`/unlockall` — Unlock entire server',
              '`/slowmode` — Set channel slowmode',
            ].join('\n'),
          },
          {
            name: '⚙️ Configuration',
            value: [
              '`/setup logchannel` — Set log channel',
              '`/setup welcomechannel` — Set welcome channel',
              '`/setup muterole` — Set mute role',
              '`/setup welcomemessage` — Set welcome message',
              '`/setup view` — View current settings',
              '`/automod toggle` — Enable/disable AutoMod',
              '`/automod linkfilter` — Toggle link filter',
              '`/automod capsfilter` — Toggle caps filter',
              '`/automod spamprotection` — Toggle spam protection',
              '`/automod raidprotection` — Toggle raid protection',
              '`/automod addbadword` — Add banned word',
              '`/automod removebadword` — Remove banned word',
              '`/automod maxmentions` — Set mention limit',
              '`/automod accountage` — Min account age',
            ].join('\n'),
          },
          {
            name: '📋 Info',
            value: [
              '`/userinfo` — User details + strike/warn count',
              '`/serverinfo` — Server details',
              '`/roleinfo` — Role details',
              '`/avatar` — View avatar',
              '`/ping` — Bot latency',
            ].join('\n'),
          },
          {
            name: '🤖 AutoMod Features (automatic)',
            value: [
              '• Bad word filter',
              '• Discord invite link filter',
              '• Spam detection (5+ msgs in 5s)',
              '• Excessive caps filter',
              '• Mass mention protection',
              '• Raid detection (10+ joins in 10s)',
              '• New account kick (configurable age)',
              '• DM notification on every action',
            ].join('\n'),
          },
        )
        .setFooter({ text: 'Strike system: 3 strikes = automatic ban with DM notification' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    },
  },
];
