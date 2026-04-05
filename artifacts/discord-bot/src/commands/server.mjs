import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getSettings, updateSettings } from '../database.mjs';
import { sendLog } from '../logger.mjs';
import { modEmbed, MOD_COLORS, parseDuration, formatDuration } from '../utils.mjs';

export const commands = [
  // SLOWMODE
  {
    data: new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Set channel slowmode')
      .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 5s, 1m) or "off"').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel (defaults to current)').addChannelTypes(ChannelType.GuildText))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction, client) {
      const durationStr = interaction.options.getString('duration');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const seconds = durationStr.toLowerCase() === 'off' ? 0 : (parseDuration(durationStr) || 0);

      await channel.setRateLimitPerUser(seconds, `Slowmode set by ${interaction.user.tag}`);
      await sendLog(client, interaction.guildId, 'slowmode', {
        moderator: interaction.user, moderatorId: interaction.user.id,
        channel,
        description: seconds === 0 ? `Slowmode disabled in <#${channel.id}>` : `Slowmode set to ${formatDuration(seconds)} in <#${channel.id}>`,
      });

      await interaction.reply({
        embeds: [modEmbed({
          color: MOD_COLORS.info,
          title: '⏱️ Slowmode Updated',
          description: seconds === 0 ? `Slowmode disabled in <#${channel.id}>` : `Slowmode set to **${formatDuration(seconds)}** in <#${channel.id}>`,
        })],
      });
    },
  },

  // LOCKDOWN
  {
    data: new SlashCommandBuilder()
      .setName('lockdown')
      .setDescription('Lock a channel (prevent everyone from sending messages)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to lock (defaults to current)').addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction, client) {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const reason = interaction.options.getString('reason') || 'No reason provided';

      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, { reason });
      await sendLog(client, interaction.guildId, 'lockdown', {
        moderator: interaction.user, moderatorId: interaction.user.id,
        channel, reason,
      });

      await interaction.reply({
        embeds: [modEmbed({ color: MOD_COLORS.lockdown, title: '🔒 Channel Locked', description: `<#${channel.id}> has been locked.\n**Reason:** ${reason}` })],
      });
    },
  },

  // UNLOCK
  {
    data: new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Unlock a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to unlock (defaults to current)').addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction, client) {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const reason = interaction.options.getString('reason') || 'No reason provided';

      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }, { reason });
      await sendLog(client, interaction.guildId, 'unlockdown', {
        moderator: interaction.user, moderatorId: interaction.user.id,
        channel, reason,
      });

      await interaction.reply({
        embeds: [modEmbed({ color: MOD_COLORS.success, title: '🔓 Channel Unlocked', description: `<#${channel.id}> has been unlocked.\n**Reason:** ${reason}` })],
      });
    },
  },

  // LOCKDOWN ALL
  {
    data: new SlashCommandBuilder()
      .setName('lockall')
      .setDescription('Lock ALL text channels (server-wide lockdown)')
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction, client) {
      const reason = interaction.options.getString('reason') || 'Server lockdown';
      await interaction.deferReply();
      const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
      let count = 0;
      for (const [, ch] of channels) {
        try {
          await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, { reason });
          count++;
        } catch {}
      }
      await sendLog(client, interaction.guildId, 'lockdown', {
        moderator: interaction.user, moderatorId: interaction.user.id,
        reason,
        description: `🚨 Server-wide lockdown: ${count} channels locked.`,
      });
      await interaction.editReply({
        embeds: [modEmbed({ color: MOD_COLORS.lockdown, title: '🔒 Server Lockdown', description: `Locked **${count}** channels.\n**Reason:** ${reason}` })],
      });
    },
  },

  // UNLOCK ALL
  {
    data: new SlashCommandBuilder()
      .setName('unlockall')
      .setDescription('Unlock ALL text channels')
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction, client) {
      const reason = interaction.options.getString('reason') || 'Lockdown lifted';
      await interaction.deferReply();
      const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
      let count = 0;
      for (const [, ch] of channels) {
        try {
          await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }, { reason });
          count++;
        } catch {}
      }
      await sendLog(client, interaction.guildId, 'unlockdown', {
        moderator: interaction.user, moderatorId: interaction.user.id,
        reason,
        description: `✅ Lockdown lifted: ${count} channels unlocked.`,
      });
      await interaction.editReply({
        embeds: [modEmbed({ color: MOD_COLORS.success, title: '🔓 Lockdown Lifted', description: `Unlocked **${count}** channels.\n**Reason:** ${reason}` })],
      });
    },
  },

  // SETUP
  {
    data: new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Configure bot settings')
      .addSubcommand(s => s.setName('logchannel').setDescription('Set mod log channel').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('welcomechannel').setDescription('Set welcome/farewell channel').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('muterole').setDescription('Set mute role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
      .addSubcommand(s => s.setName('welcomemessage').setDescription('Set welcome message ({user} = mention)').addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)))
      .addSubcommand(s => s.setName('farewellmessage').setDescription('Set farewell message ({user} = tag)').addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)))
      .addSubcommand(s => s.setName('view').setDescription('View current settings'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const settings = getSettings(interaction.guildId);

      if (sub === 'logchannel') {
        const ch = interaction.options.getChannel('channel');
        updateSettings(interaction.guildId, { log_channel_id: ch.id });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Log Channel Set', description: `Mod logs will be sent to <#${ch.id}>.` })] });
      } else if (sub === 'welcomechannel') {
        const ch = interaction.options.getChannel('channel');
        updateSettings(interaction.guildId, { welcome_channel_id: ch.id });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Welcome Channel Set', description: `Welcome/farewell messages will be sent to <#${ch.id}>.` })] });
      } else if (sub === 'muterole') {
        const role = interaction.options.getRole('role');
        updateSettings(interaction.guildId, { mute_role_id: role.id });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Mute Role Set', description: `Mute role set to ${role}.` })] });
      } else if (sub === 'welcomemessage') {
        const msg = interaction.options.getString('message');
        updateSettings(interaction.guildId, { welcome_message: msg });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Welcome Message Set', description: `\`\`\`${msg}\`\`\`` })] });
      } else if (sub === 'farewellmessage') {
        const msg = interaction.options.getString('message');
        updateSettings(interaction.guildId, { farewell_message: msg });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Farewell Message Set', description: `\`\`\`${msg}\`\`\`` })] });
      } else if (sub === 'view') {
        const { EmbedBuilder } = await import('discord.js');
        const embed = new EmbedBuilder()
          .setColor(MOD_COLORS.info)
          .setTitle('⚙️ Bot Settings')
          .addFields(
            { name: 'Log Channel', value: settings.log_channel_id ? `<#${settings.log_channel_id}>` : 'Not set', inline: true },
            { name: 'Welcome Channel', value: settings.welcome_channel_id ? `<#${settings.welcome_channel_id}>` : 'Not set', inline: true },
            { name: 'Mute Role', value: settings.mute_role_id ? `<@&${settings.mute_role_id}>` : 'Using timeout', inline: true },
            { name: 'AutoMod', value: settings.automod_enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Spam Protection', value: settings.spam_protection ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Link Filter', value: settings.link_filter ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Caps Filter', value: settings.caps_filter ? `✅ ${settings.caps_threshold}%` : '❌ Disabled', inline: true },
            { name: 'Raid Protection', value: settings.raid_protection ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Max Mentions', value: String(settings.max_mentions), inline: true },
            { name: 'Bad Words', value: settings.bad_words.length ? settings.bad_words.join(', ') : 'None', inline: false },
            { name: 'Welcome Message', value: settings.welcome_message, inline: false },
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }
    },
  },

  // AUTOMOD
  {
    data: new SlashCommandBuilder()
      .setName('automod')
      .setDescription('Configure AutoMod settings')
      .addSubcommand(s => s.setName('toggle').setDescription('Enable/disable AutoMod').addBooleanOption(o => o.setName('enabled').setDescription('Enable?').setRequired(true)))
      .addSubcommand(s => s.setName('linkfilter').setDescription('Toggle link filter').addBooleanOption(o => o.setName('enabled').setDescription('Enable?').setRequired(true)))
      .addSubcommand(s => s.setName('capsfilter').setDescription('Toggle caps filter').addBooleanOption(o => o.setName('enabled').setDescription('Enable?').setRequired(true)).addIntegerOption(o => o.setName('threshold').setDescription('% threshold (default 70)').setMinValue(50).setMaxValue(100)))
      .addSubcommand(s => s.setName('spamprotection').setDescription('Toggle spam protection').addBooleanOption(o => o.setName('enabled').setDescription('Enable?').setRequired(true)))
      .addSubcommand(s => s.setName('raidprotection').setDescription('Toggle raid protection').addBooleanOption(o => o.setName('enabled').setDescription('Enable?').setRequired(true)))
      .addSubcommand(s => s.setName('addbadword').setDescription('Add a bad word').addStringOption(o => o.setName('word').setDescription('Word to add').setRequired(true)))
      .addSubcommand(s => s.setName('removebadword').setDescription('Remove a bad word').addStringOption(o => o.setName('word').setDescription('Word to remove').setRequired(true)))
      .addSubcommand(s => s.setName('maxmentions').setDescription('Set max mentions per message').addIntegerOption(o => o.setName('count').setDescription('Max mentions').setRequired(true).setMinValue(1).setMaxValue(20)))
      .addSubcommand(s => s.setName('accountage').setDescription('Minimum account age to join (0 = disabled)').addIntegerOption(o => o.setName('hours').setDescription('Minimum age in hours').setRequired(true).setMinValue(0)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const settings = getSettings(interaction.guildId);

      if (sub === 'toggle') {
        const v = interaction.options.getBoolean('enabled');
        updateSettings(interaction.guildId, { automod_enabled: v ? 1 : 0 });
        await interaction.reply({ embeds: [modEmbed({ color: v ? MOD_COLORS.success : MOD_COLORS.error, title: `🤖 AutoMod ${v ? 'Enabled' : 'Disabled'}` })] });
      } else if (sub === 'linkfilter') {
        const v = interaction.options.getBoolean('enabled');
        updateSettings(interaction.guildId, { link_filter: v ? 1 : 0 });
        await interaction.reply({ embeds: [modEmbed({ color: v ? MOD_COLORS.success : MOD_COLORS.error, title: `🔗 Link Filter ${v ? 'Enabled' : 'Disabled'}` })] });
      } else if (sub === 'capsfilter') {
        const v = interaction.options.getBoolean('enabled');
        const threshold = interaction.options.getInteger('threshold') ?? settings.caps_threshold;
        updateSettings(interaction.guildId, { caps_filter: v ? 1 : 0, caps_threshold: threshold });
        await interaction.reply({ embeds: [modEmbed({ color: v ? MOD_COLORS.success : MOD_COLORS.error, title: `🔤 Caps Filter ${v ? `Enabled (${threshold}%)` : 'Disabled'}` })] });
      } else if (sub === 'spamprotection') {
        const v = interaction.options.getBoolean('enabled');
        updateSettings(interaction.guildId, { spam_protection: v ? 1 : 0 });
        await interaction.reply({ embeds: [modEmbed({ color: v ? MOD_COLORS.success : MOD_COLORS.error, title: `🛡️ Spam Protection ${v ? 'Enabled' : 'Disabled'}` })] });
      } else if (sub === 'raidprotection') {
        const v = interaction.options.getBoolean('enabled');
        updateSettings(interaction.guildId, { raid_protection: v ? 1 : 0 });
        await interaction.reply({ embeds: [modEmbed({ color: v ? MOD_COLORS.success : MOD_COLORS.error, title: `⚔️ Raid Protection ${v ? 'Enabled' : 'Disabled'}` })] });
      } else if (sub === 'addbadword') {
        const word = interaction.options.getString('word').toLowerCase();
        const words = [...new Set([...settings.bad_words, word])];
        updateSettings(interaction.guildId, { bad_words: words });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Bad Word Added', description: `\`${word}\` added to the filter.` })], ephemeral: true });
      } else if (sub === 'removebadword') {
        const word = interaction.options.getString('word').toLowerCase();
        const words = settings.bad_words.filter(w => w !== word);
        updateSettings(interaction.guildId, { bad_words: words });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Bad Word Removed', description: `\`${word}\` removed from the filter.` })], ephemeral: true });
      } else if (sub === 'maxmentions') {
        const count = interaction.options.getInteger('count');
        updateSettings(interaction.guildId, { max_mentions: count });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Max Mentions Updated', description: `Max mentions per message set to **${count}**.` })] });
      } else if (sub === 'accountage') {
        const hours = interaction.options.getInteger('hours');
        updateSettings(interaction.guildId, { join_age_minimum: hours * 3600 });
        await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Account Age Requirement Updated', description: hours === 0 ? 'Disabled.' : `Accounts less than **${hours} hours** old will be kicked on join.` })] });
      }
    },
  },
];
