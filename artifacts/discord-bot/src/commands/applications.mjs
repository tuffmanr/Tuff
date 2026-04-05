import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
} from 'discord.js';
import {
  createApplication, getApplication, getPendingApplications,
  getUserApplications, reviewApplication, getSettings, getAllGuildRoles,
} from '../database.mjs';
import { sendLog } from '../logger.mjs';
import { dmUser, modEmbed, MOD_COLORS } from '../utils.mjs';

const ROLE_TYPES = ['Staff', 'Moderator', 'Admin', 'Manager'];
const TIERS = ['Junior', 'Senior', 'Head', 'Chief'];

const ROLE_COLORS = {
  Staff: 0x5865F2,
  Moderator: 0x57F287,
  Admin: 0xFEE75C,
  Manager: 0xED4245,
};

const STATUS_COLORS = {
  pending: MOD_COLORS.warn,
  accepted: MOD_COLORS.success,
  denied: MOD_COLORS.error,
};

const STATUS_EMOJI = {
  pending: '⏳',
  accepted: '✅',
  denied: '❌',
};

function appEmbed(app, username) {
  const color = STATUS_COLORS[app.status] || MOD_COLORS.info;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`📋 Application #${app.id} — ${app.tier} ${app.role_type}`)
    .setDescription(`**Applicant:** <@${app.user_id}>${username ? ` (${username})` : ''}\n**Status:** ${STATUS_EMOJI[app.status]} ${app.status.toUpperCase()}`)
    .addFields(
      { name: '🎂 Age', value: app.age, inline: true },
      { name: '🌍 Timezone', value: app.timezone, inline: true },
      { name: '📅 Submitted', value: `<t:${app.created_at}:R>`, inline: true },
      { name: '📚 Previous Experience', value: app.experience },
      { name: '💬 Why do you want this role?', value: app.why },
      { name: '🧩 Scenario Response', value: app.scenario },
      ...(app.reviewer_id ? [{ name: `Reviewed by`, value: `<@${app.reviewer_id}>`, inline: true }] : []),
      ...(app.review_reason ? [{ name: 'Review Note', value: app.review_reason, inline: true }] : []),
    )
    .setTimestamp();
}

export const commands = [
  // /apply
  {
    data: new SlashCommandBuilder()
      .setName('apply')
      .setDescription('Apply for a staff position')
      .addStringOption(o => o.setName('role').setDescription('Role to apply for').setRequired(true)
        .addChoices(...ROLE_TYPES.map(r => ({ name: r, value: r }))))
      .addStringOption(o => o.setName('tier').setDescription('Tier to apply for').setRequired(true)
        .addChoices(...TIERS.map(t => ({ name: t, value: t })))),
    async execute(interaction) {
      const roleType = interaction.options.getString('role');
      const tier = interaction.options.getString('tier');

      const modal = new ModalBuilder()
        .setCustomId(`apply_modal_${roleType}_${tier}`)
        .setTitle(`Apply for ${tier} ${roleType}`);

      const ageInput = new TextInputBuilder().setCustomId('age').setLabel('How old are you?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10);
      const tzInput = new TextInputBuilder().setCustomId('timezone').setLabel('Your timezone (e.g. EST, GMT+2)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);
      const expInput = new TextInputBuilder().setCustomId('experience').setLabel('Previous mod/staff experience').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
      const whyInput = new TextInputBuilder().setCustomId('why').setLabel('Why do you want this role?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
      const scenarioInput = new TextInputBuilder()
        .setCustomId('scenario')
        .setLabel('A spammer is being rude. What do you do?')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(ageInput),
        new ActionRowBuilder().addComponents(tzInput),
        new ActionRowBuilder().addComponents(expInput),
        new ActionRowBuilder().addComponents(whyInput),
        new ActionRowBuilder().addComponents(scenarioInput),
      );

      await interaction.showModal(modal);
    },
  },

  // /application (view/accept/deny/list/pending)
  {
    data: new SlashCommandBuilder()
      .setName('application')
      .setDescription('Manage staff applications')
      .addSubcommand(s => s.setName('view').setDescription('View an application by ID').addIntegerOption(o => o.setName('id').setDescription('Application ID').setRequired(true)))
      .addSubcommand(s => s.setName('accept').setDescription('Accept an application')
        .addIntegerOption(o => o.setName('id').setDescription('Application ID').setRequired(true))
        .addStringOption(o => o.setName('note').setDescription('Optional note to applicant')))
      .addSubcommand(s => s.setName('deny').setDescription('Deny an application')
        .addIntegerOption(o => o.setName('id').setDescription('Application ID').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for denial')))
      .addSubcommand(s => s.setName('pending').setDescription('List all pending applications'))
      .addSubcommand(s => s.setName('myapps').setDescription('View your own application history'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'view') {
        const id = interaction.options.getInteger('id');
        const app = getApplication(id);
        if (!app || app.guild_id !== interaction.guildId) return interaction.reply({ content: '❌ Application not found.', ephemeral: true });
        let username = null;
        try { const u = await client.users.fetch(app.user_id); username = u.tag; } catch {}
        return interaction.reply({ embeds: [appEmbed(app, username)], ephemeral: true });
      }

      if (sub === 'accept') {
        const id = interaction.options.getInteger('id');
        const note = interaction.options.getString('note') || 'Congratulations!';
        const app = getApplication(id);
        if (!app || app.guild_id !== interaction.guildId) return interaction.reply({ content: '❌ Application not found.', ephemeral: true });
        if (app.status !== 'pending') return interaction.reply({ content: `❌ Application is already ${app.status}.`, ephemeral: true });

        reviewApplication(id, interaction.user.id, 'accepted', note);

        // Assign the role if it exists
        try {
          const member = await interaction.guild.members.fetch(app.user_id).catch(() => null);
          if (member) {
            const roles = getAllGuildRoles(interaction.guildId);
            const roleEntry = roles.find(r => r.role_type === app.role_type && r.tier === app.tier);
            if (roleEntry) {
              const role = interaction.guild.roles.cache.get(roleEntry.role_id);
              if (role) await member.roles.add(role, `Application #${id} accepted`);
            }
          }
        } catch {}

        // DM the applicant
        try {
          const user = await client.users.fetch(app.user_id);
          await dmUser(user, new EmbedBuilder()
            .setColor(MOD_COLORS.success)
            .setTitle(`✅ Application Accepted — ${app.tier} ${app.role_type}`)
            .setDescription(`Your application in **${interaction.guild.name}** has been **accepted**!`)
            .addFields({ name: 'Note from staff', value: note })
            .setTimestamp());
        } catch {}

        await sendLog(client, interaction.guildId, 'verify', {
          user: { tag: `App #${id}`, id: app.user_id }, userId: app.user_id,
          moderator: interaction.user, moderatorId: interaction.user.id,
          description: `Application #${id} for **${app.tier} ${app.role_type}** was **accepted**.\nNote: ${note}`,
        });

        return interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.success, title: '✅ Application Accepted', description: `Application #${id} (**${app.tier} ${app.role_type}**) has been accepted. The applicant has been notified.` })] });
      }

      if (sub === 'deny') {
        const id = interaction.options.getInteger('id');
        const reason = interaction.options.getString('reason') || 'Your application did not meet our requirements at this time.';
        const app = getApplication(id);
        if (!app || app.guild_id !== interaction.guildId) return interaction.reply({ content: '❌ Application not found.', ephemeral: true });
        if (app.status !== 'pending') return interaction.reply({ content: `❌ Application is already ${app.status}.`, ephemeral: true });

        reviewApplication(id, interaction.user.id, 'denied', reason);

        // DM the applicant
        try {
          const user = await client.users.fetch(app.user_id);
          await dmUser(user, new EmbedBuilder()
            .setColor(MOD_COLORS.error)
            .setTitle(`❌ Application Denied — ${app.tier} ${app.role_type}`)
            .setDescription(`Your application in **${interaction.guild.name}** has been **denied**.`)
            .addFields({ name: 'Reason', value: reason })
            .setFooter({ text: 'You may reapply in the future.' })
            .setTimestamp());
        } catch {}

        await sendLog(client, interaction.guildId, 'automod', {
          user: { tag: `App #${id}`, id: app.user_id }, userId: app.user_id,
          moderator: interaction.user, moderatorId: interaction.user.id,
          description: `Application #${id} for **${app.tier} ${app.role_type}** was **denied**.\nReason: ${reason}`,
        });

        return interaction.reply({ embeds: [modEmbed({ color: MOD_COLORS.error, title: '❌ Application Denied', description: `Application #${id} has been denied. The applicant has been notified.` })] });
      }

      if (sub === 'pending') {
        const apps = getPendingApplications(interaction.guildId);
        if (!apps.length) return interaction.reply({ content: '📭 No pending applications.', ephemeral: true });

        const embed = new EmbedBuilder()
          .setColor(MOD_COLORS.info)
          .setTitle('📋 Pending Applications')
          .setDescription(`${apps.length} pending application(s)\nUse \`/application view <id>\` to view details, \`/application accept/deny <id>\` to review.`)
          .addFields(apps.slice(0, 20).map(a => ({
            name: `#${a.id} — ${a.tier} ${a.role_type}`,
            value: `<@${a.user_id}> • Submitted <t:${a.created_at}:R>`,
            inline: false,
          })))
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (sub === 'myapps') {
        const apps = getUserApplications(interaction.guildId, interaction.user.id);
        if (!apps.length) return interaction.reply({ content: '📭 You have no applications.', ephemeral: true });

        const embed = new EmbedBuilder()
          .setColor(MOD_COLORS.info)
          .setTitle('📋 Your Applications')
          .addFields(apps.slice(0, 10).map(a => ({
            name: `#${a.id} — ${a.tier} ${a.role_type} • ${STATUS_EMOJI[a.status]} ${a.status.toUpperCase()}`,
            value: `Submitted <t:${a.created_at}:R>${a.review_reason ? `\n**Note:** ${a.review_reason}` : ''}`,
            inline: false,
          })))
          .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    },
  },
];

// Modal submit handler
export async function handleApplicationModal(interaction, client) {
  if (!interaction.isModalSubmit()) return false;
  if (!interaction.customId.startsWith('apply_modal_')) return false;

  const parts = interaction.customId.split('_');
  const roleType = parts[2];
  const tier = parts[3];

  const answers = {
    age: interaction.fields.getTextInputValue('age'),
    timezone: interaction.fields.getTextInputValue('timezone'),
    experience: interaction.fields.getTextInputValue('experience'),
    why: interaction.fields.getTextInputValue('why'),
    scenario: interaction.fields.getTextInputValue('scenario'),
  };

  const result = createApplication(interaction.guildId, interaction.user.id, roleType, tier, answers);

  if (result.error) {
    return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
  }

  // Notify in the app channel / log channel
  await sendLog(client, interaction.guildId, 'join', {
    user: interaction.user, userId: interaction.user.id,
    description: `📋 **${interaction.user.tag}** submitted an application for **${tier} ${roleType}**.\nUse \`/application pending\` to review.`,
  });

  const settings = getSettings(interaction.guildId);

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(ROLE_COLORS[roleType] || MOD_COLORS.info)
      .setTitle(`📬 Application Submitted — ${tier} ${roleType}`)
      .setDescription(`Your application has been submitted and is **pending review**.\nYou'll receive a DM when it's been reviewed.\n\nUse \`/application myapps\` to check your application status.`)
      .setTimestamp()],
    ephemeral: true,
  });

  return true;
}
