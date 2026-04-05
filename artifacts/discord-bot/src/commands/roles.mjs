import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Colors } from 'discord.js';
import { saveGuildRole, getAllGuildRoles, getSettings, updateSettings } from '../database.mjs';
import { modEmbed, MOD_COLORS } from '../utils.mjs';

// Role type definitions with colors and permissions
const ROLE_HIERARCHY = [
  {
    type: 'Manager',
    color: 0xED4245,
    emoji: '👑',
    description: 'Oversees the entire staff team',
    tiers: [
      { tier: 'Chief',  position: 16, permissions: ['Administrator'] },
      { tier: 'Head',   position: 15, permissions: ['ManageGuild', 'ManageChannels', 'ManageRoles', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages'] },
      { tier: 'Senior', position: 14, permissions: ['ManageChannels', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages'] },
      { tier: 'Junior', position: 13, permissions: ['KickMembers', 'ModerateMembers', 'ManageMessages'] },
    ],
  },
  {
    type: 'Admin',
    color: 0xFEE75C,
    emoji: '⚡',
    description: 'Handles server administration',
    tiers: [
      { tier: 'Chief',  position: 12, permissions: ['ManageGuild', 'ManageChannels', 'ManageRoles', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages'] },
      { tier: 'Head',   position: 11, permissions: ['ManageChannels', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages'] },
      { tier: 'Senior', position: 10, permissions: ['BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages'] },
      { tier: 'Junior', position: 9,  permissions: ['KickMembers', 'ModerateMembers', 'ManageMessages'] },
    ],
  },
  {
    type: 'Moderator',
    color: 0x57F287,
    emoji: '🛡️',
    description: 'Moderates the community',
    tiers: [
      { tier: 'Chief',  position: 8, permissions: ['BanMembers', 'KickMembers', 'ModerateMembers', 'ManageMessages', 'ViewAuditLog'] },
      { tier: 'Head',   position: 7, permissions: ['KickMembers', 'ModerateMembers', 'ManageMessages', 'ViewAuditLog'] },
      { tier: 'Senior', position: 6, permissions: ['ModerateMembers', 'ManageMessages'] },
      { tier: 'Junior', position: 5, permissions: ['ManageMessages'] },
    ],
  },
  {
    type: 'Staff',
    color: 0x5865F2,
    emoji: '⭐',
    description: 'General server staff',
    tiers: [
      { tier: 'Chief',  position: 4, permissions: ['ModerateMembers', 'ManageMessages'] },
      { tier: 'Head',   position: 3, permissions: ['ManageMessages'] },
      { tier: 'Senior', position: 2, permissions: ['ManageMessages'] },
      { tier: 'Junior', position: 1, permissions: [] },
    ],
  },
];

const PERM_MAP = {
  Administrator: 8n,
  ManageGuild: 32n,
  ManageChannels: 16n,
  ManageRoles: 268435456n,
  BanMembers: 4n,
  KickMembers: 2n,
  ModerateMembers: 1099511627776n,
  ManageMessages: 8192n,
  ViewAuditLog: 128n,
};

function buildPerms(permNames) {
  return permNames.reduce((acc, name) => acc | (PERM_MAP[name] || 0n), 0n);
}

export const commands = [
  // /setup (create all roles)
  {
    data: new SlashCommandBuilder()
      .setName('setuproles')
      .setDescription('Create the full staff role hierarchy for this server')
      .addBooleanOption(o => o.setName('overwrite').setDescription('Overwrite existing roles with the same name? (default: false)'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction, client) {
      await interaction.deferReply();

      const overwrite = interaction.options.getBoolean('overwrite') ?? false;
      const guild = interaction.guild;

      // Check bot has manage roles
      const botMember = guild.members.me;
      if (!botMember.permissions.has('ManageRoles')) {
        return interaction.editReply({ embeds: [modEmbed({ color: MOD_COLORS.error, title: '❌ Missing Permission', description: 'I need the **Manage Roles** permission to create roles.' })] });
      }

      const created = [];
      const skipped = [];
      const failed = [];

      for (const roleGroup of ROLE_HIERARCHY) {
        for (const tierDef of roleGroup.tiers) {
          const roleName = `${tierDef.tier} ${roleGroup.type}`;

          // Check if role already exists
          const existing = guild.roles.cache.find(r => r.name === roleName);
          if (existing && !overwrite) {
            saveGuildRole(guild.id, roleGroup.type, tierDef.tier, existing.id);
            skipped.push(roleName);
            continue;
          }

          try {
            const perms = buildPerms(tierDef.permissions);
            const role = await guild.roles.create({
              name: roleName,
              color: roleGroup.color,
              permissions: perms,
              hoist: tierDef.tier === 'Chief' || tierDef.tier === 'Head',
              mentionable: true,
              reason: `/setuproles by ${interaction.user.tag}`,
            });

            saveGuildRole(guild.id, roleGroup.type, tierDef.tier, role.id);
            created.push(roleName);
          } catch (err) {
            failed.push(`${roleName}: ${err.message}`);
          }
        }
      }

      // Build response embed
      const embed = new EmbedBuilder()
        .setColor(MOD_COLORS.success)
        .setTitle('⚙️ Role Setup Complete')
        .setDescription('Staff role hierarchy has been created.')
        .setTimestamp();

      if (created.length) embed.addFields({ name: `✅ Created (${created.length})`, value: created.map(r => `\`${r}\``).join(', ') });
      if (skipped.length) embed.addFields({ name: `⏭️ Already existed (${skipped.length})`, value: skipped.map(r => `\`${r}\``).join(', ') });
      if (failed.length) embed.addFields({ name: `❌ Failed (${failed.length})`, value: failed.join('\n') });

      embed.addFields({
        name: '📋 Role Hierarchy',
        value: ROLE_HIERARCHY.map(g =>
          `${g.emoji} **${g.type}**: Chief → Head → Senior → Junior`
        ).join('\n'),
      });

      return interaction.editReply({ embeds: [embed] });
    },
  },

  // /roles (view all configured roles)
  {
    data: new SlashCommandBuilder()
      .setName('roles')
      .setDescription('View the staff role hierarchy for this server'),
    async execute(interaction) {
      const guildRoles = getAllGuildRoles(interaction.guildId);

      const embed = new EmbedBuilder()
        .setColor(MOD_COLORS.info)
        .setTitle('📋 Staff Role Hierarchy')
        .setTimestamp();

      if (!guildRoles.length) {
        embed.setDescription('No roles configured. Run `/setuproles` to create the full hierarchy.');
        return interaction.reply({ embeds: [embed] });
      }

      for (const roleGroup of ROLE_HIERARCHY) {
        const tiers = ['Chief', 'Head', 'Senior', 'Junior'];
        const lines = tiers.map(tier => {
          const entry = guildRoles.find(r => r.role_type === roleGroup.type && r.tier === tier);
          return entry ? `${tier}: <@&${entry.role_id}>` : `${tier}: _not set_`;
        });
        embed.addFields({ name: `${roleGroup.emoji} ${roleGroup.type}`, value: lines.join('\n'), inline: true });
      }

      return interaction.reply({ embeds: [embed] });
    },
  },

  // /assignrole (give a staff role to a user)
  {
    data: new SlashCommandBuilder()
      .setName('assignrole')
      .setDescription('Assign a staff role to a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Role type').setRequired(true)
        .addChoices(ROLE_HIERARCHY.map(r => ({ name: r.type, value: r.type }))))
      .addStringOption(o => o.setName('tier').setDescription('Tier').setRequired(true)
        .addChoices(['Chief', 'Head', 'Senior', 'Junior'].map(t => ({ name: t, value: t }))))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const type = interaction.options.getString('type');
      const tier = interaction.options.getString('tier');
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });

      const guildRoles = getAllGuildRoles(interaction.guildId);
      const entry = guildRoles.find(r => r.role_type === type && r.tier === tier);
      if (!entry) return interaction.reply({ content: `❌ The **${tier} ${type}** role hasn't been created yet. Run \`/setuproles\` first.`, ephemeral: true });

      const role = interaction.guild.roles.cache.get(entry.role_id);
      if (!role) return interaction.reply({ content: `❌ Role not found in server. It may have been deleted — re-run \`/setuproles\`.`, ephemeral: true });

      await target.roles.add(role, `Assigned by ${interaction.user.tag}`);

      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Role Assigned', description: `Gave <@&${role.id}> to ${target.user.tag}.` })] });
    },
  },

  // /removerole (take away a staff role)
  {
    data: new SlashCommandBuilder()
      .setName('removerole')
      .setDescription('Remove a staff role from a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Role type').setRequired(true)
        .addChoices(ROLE_HIERARCHY.map(r => ({ name: r.type, value: r.type }))))
      .addStringOption(o => o.setName('tier').setDescription('Tier').setRequired(true)
        .addChoices(['Chief', 'Head', 'Senior', 'Junior'].map(t => ({ name: t, value: t }))))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction) {
      const target = interaction.options.getMember('user');
      const type = interaction.options.getString('type');
      const tier = interaction.options.getString('tier');
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });

      const guildRoles = getAllGuildRoles(interaction.guildId);
      const entry = guildRoles.find(r => r.role_type === type && r.tier === tier);
      if (!entry) return interaction.reply({ content: `❌ The **${tier} ${type}** role isn't configured.`, ephemeral: true });

      const role = interaction.guild.roles.cache.get(entry.role_id);
      if (!role) return interaction.reply({ content: `❌ Role not found in server.`, ephemeral: true });

      await target.roles.remove(role, `Removed by ${interaction.user.tag}`);
      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Role Removed', description: `Removed <@&${role.id}> from ${target.user.tag}.` })] });
    },
  },

  // /promote (move up a tier)
  {
    data: new SlashCommandBuilder()
      .setName('promote')
      .setDescription('Promote a staff member to the next tier')
      .addUserOption(o => o.setName('user').setDescription('Member to promote').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Role type').setRequired(true)
        .addChoices(ROLE_HIERARCHY.map(r => ({ name: r.type, value: r.type }))))
      .addStringOption(o => o.setName('from_tier').setDescription('Current tier').setRequired(true)
        .addChoices(['Junior', 'Senior', 'Head'].map(t => ({ name: t, value: t }))))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const type = interaction.options.getString('type');
      const fromTier = interaction.options.getString('from_tier');
      const tierOrder = ['Junior', 'Senior', 'Head', 'Chief'];
      const toTier = tierOrder[tierOrder.indexOf(fromTier) + 1];

      if (!target || !toTier) return interaction.reply({ content: '❌ Invalid promotion.', ephemeral: true });

      const guildRoles = getAllGuildRoles(interaction.guildId);
      const fromEntry = guildRoles.find(r => r.role_type === type && r.tier === fromTier);
      const toEntry = guildRoles.find(r => r.role_type === type && r.tier === toTier);

      if (!fromEntry || !toEntry) return interaction.reply({ content: `❌ Roles not configured. Run \`/setuproles\` first.`, ephemeral: true });

      const fromRole = interaction.guild.roles.cache.get(fromEntry.role_id);
      const toRole = interaction.guild.roles.cache.get(toEntry.role_id);

      if (fromRole) await target.roles.remove(fromRole).catch(() => {});
      if (toRole) await target.roles.add(toRole).catch(() => {});

      const { dmUser: dm } = await import('../utils.mjs');
      await dm(target.user, modEmbed({ color: MOD_COLORS.success, title: '🎉 You Have Been Promoted!', description: `Congratulations! You've been promoted from **${fromTier} ${type}** to **${toTier} ${type}** in **${interaction.guild.name}**!` }));

      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '🎉 Member Promoted', description: `${target.user.tag} has been promoted from **${fromTier} ${type}** → **${toTier} ${type}**.` })] });
    },
  },

  // /demote (move down a tier)
  {
    data: new SlashCommandBuilder()
      .setName('demote')
      .setDescription('Demote a staff member to the previous tier')
      .addUserOption(o => o.setName('user').setDescription('Member to demote').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Role type').setRequired(true)
        .addChoices(ROLE_HIERARCHY.map(r => ({ name: r.type, value: r.type }))))
      .addStringOption(o => o.setName('from_tier').setDescription('Current tier').setRequired(true)
        .addChoices(['Senior', 'Head', 'Chief'].map(t => ({ name: t, value: t }))))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const type = interaction.options.getString('type');
      const fromTier = interaction.options.getString('from_tier');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const tierOrder = ['Junior', 'Senior', 'Head', 'Chief'];
      const toTier = tierOrder[tierOrder.indexOf(fromTier) - 1];

      if (!target || !toTier) return interaction.reply({ content: '❌ Invalid demotion.', ephemeral: true });

      const guildRoles = getAllGuildRoles(interaction.guildId);
      const fromEntry = guildRoles.find(r => r.role_type === type && r.tier === fromTier);
      const toEntry = guildRoles.find(r => r.role_type === type && r.tier === toTier);

      if (!fromEntry || !toEntry) return interaction.reply({ content: `❌ Roles not configured.`, ephemeral: true });

      const fromRole = interaction.guild.roles.cache.get(fromEntry.role_id);
      const toRole = interaction.guild.roles.cache.get(toEntry.role_id);

      if (fromRole) await target.roles.remove(fromRole).catch(() => {});
      if (toRole) await target.roles.add(toRole).catch(() => {});

      const { dmUser: dm } = await import('../utils.mjs');
      await dm(target.user, modEmbed({ color: MOD_COLORS.warn, title: '⬇️ You Have Been Demoted', description: `You've been demoted from **${fromTier} ${type}** to **${toTier} ${type}** in **${interaction.guild.name}**.\n**Reason:** ${reason}` }));

      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.warn, title: '⬇️ Member Demoted', description: `${target.user.tag} demoted from **${fromTier} ${type}** → **${toTier} ${type}**.\n**Reason:** ${reason}` })] });
    },
  },

  // /fire (remove all staff roles)
  {
    data: new SlashCommandBuilder()
      .setName('fire')
      .setDescription('Remove all staff roles from a member (terminate from staff)')
      .addUserOption(o => o.setName('user').setDescription('Member to fire').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    async execute(interaction, client) {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });

      const guildRoles = getAllGuildRoles(interaction.guildId);
      let removed = 0;
      for (const entry of guildRoles) {
        const role = interaction.guild.roles.cache.get(entry.role_id);
        if (role && target.roles.cache.has(role.id)) {
          await target.roles.remove(role, reason).catch(() => {});
          removed++;
        }
      }

      const { dmUser: dm } = await import('../utils.mjs');
      await dm(target.user, modEmbed({ color: MOD_COLORS.error, title: '🔥 You Have Been Fired', description: `You have been removed from the staff team in **${interaction.guild.name}**.\n**Reason:** ${reason}` }));

      await interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.error, title: '🔥 Member Fired', description: `${target.user.tag} has been removed from all staff roles (${removed} role(s) removed).\n**Reason:** ${reason}` })] });
    },
  },
];
