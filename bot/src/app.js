'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { status } = require('minecraft-server-util');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const VERSION = '0.4.0';
const EPHEMERAL = MessageFlags.Ephemeral;
const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`[CONFIG] ${name} fehlt in bot/.env.`);
}

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

function readJson(file, fallback) {
  try {
    const target = path.join(dataDir, file);
    return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : fallback;
  } catch (error) {
    console.error(`[DATA] ${file} konnte nicht gelesen werden:`, error);
    return fallback;
  }
}

function writeJson(file, value) {
  const target = path.join(dataDir, file);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, target);
}

const state = {
  config: readJson('config.json', {}),
  verifications: readJson('verifications.json', {}),
  whitelist: readJson('whitelist.json', []),
  projects: readJson('projects.json', []),
  content: readJson('content.json', []),
  tickets: readJson('tickets.json', []),
  minecraft: {
    online: false,
    players: 0,
    maxPlayers: 0,
    version: null,
    motd: null,
    latency: null,
    updatedAt: null,
  },
};

const configured = name => state.config[name] || process.env[name] || null;
const saveConfig = () => writeJson('config.json', state.config);
const validMinecraftName = name => /^[A-Za-z0-9_]{3,16}$/.test(name);
const safeChannelName = value => value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 70);

function addTextChannelOption(builder, name, description, required = false) {
  return builder.addChannelOption(option => option
    .setName(name)
    .setDescription(description)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setRequired(required));
}

let setup = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Richtet Rollen und Kanäle für den Bot ein.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addRoleOption(option => option.setName('verifiziert_rolle').setDescription('Rolle nach Regelbestätigung').setRequired(true));
setup = addTextChannelOption(setup, 'regel_log', 'Kanal für Regelbestätigungen', true);
setup = addTextChannelOption(setup, 'whitelist_team', 'Teamkanal für Whitelist-Anträge', true);
setup = addTextChannelOption(setup, 'projekt_kanal', 'Kanal für Bauprojekte', true);
setup = addTextChannelOption(setup, 'bot_log', 'Interner Bot-Logkanal', true);
setup = setup
  .addRoleOption(option => option.setName('whitelist_rolle').setDescription('Optionale Rolle nach Whitelist-Annahme'))
  .addRoleOption(option => option.setName('support_rolle').setDescription('Teamrolle für Tickets'))
  .addChannelOption(option => option.setName('ticket_kategorie').setDescription('Kategorie für neue Tickets').addChannelTypes(ChannelType.GuildCategory))
  .addChannelOption(option => option.setName('ticket_log').setDescription('Kanal für Ticket-Logs').addChannelTypes(ChannelType.GuildText))
  .addChannelOption(option => option.setName('content_kanal').setDescription('Kanal für Content-Beiträge').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

const commands = [
  setup,
  new SlashCommandBuilder().setName('regelnachricht').setDescription('Erstellt die Nachricht zur Regelbestätigung.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('statusnachricht').setDescription('Erstellt eine automatisch aktualisierte Minecraft-Statusnachricht.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('whitelist').setDescription('Sendet deinen Minecraft-Namen für die Whitelist.').addStringOption(o => o.setName('minecraft_name').setDescription('Dein Minecraft-Name').setRequired(true)),
  new SlashCommandBuilder().setName('hier-baue-ich').setDescription('Meldet oder aktualisiert dein Bauprojekt.')
    .addStringOption(o => o.setName('projekt').setDescription('Name des Projekts').setRequired(true))
    .addStringOption(o => o.setName('bereich').setDescription('Bauort oder Bereich').setRequired(true))
    .addStringOption(o => o.setName('status').setDescription('Aktueller Stand')),
  new SlashCommandBuilder().setName('content').setDescription('Meldet einen Community-Beitrag.')
    .addStringOption(o => o.setName('typ').setDescription('Art des Beitrags').setRequired(true).addChoices(
      { name: 'Video', value: 'Video' }, { name: 'Stream', value: 'Stream' },
      { name: 'Clip', value: 'Clip' }, { name: 'Screenshot', value: 'Screenshot' },
    ))
    .addStringOption(o => o.setName('link').setDescription('Link zum Beitrag').setRequired(true)),
  new SlashCommandBuilder().setName('ticket').setDescription('Erstellt ein privates Support-Ticket.')
    .addStringOption(o => o.setName('typ').setDescription('Thema des Tickets').setRequired(true).addChoices(
      { name: 'Allgemeine Hilfe', value: 'hilfe' }, { name: 'Spieler melden', value: 'meldung' },
      { name: 'Technisches Problem', value: 'technik' }, { name: 'Sonstiges', value: 'sonstiges' },
    ))
    .addStringOption(o => o.setName('grund').setDescription('Beschreibe dein Anliegen kurz').setRequired(true)),
  new SlashCommandBuilder().setName('rollencheck').setDescription('Prüft wichtige Bot-Berechtigungen.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('botinfo').setDescription('Zeigt Informationen über den Bot.'),
  new SlashCommandBuilder().setName('ping').setDescription('Zeigt die Reaktionszeit des Bots.'),
  new SlashCommandBuilder().setName('hilfe').setDescription('Zeigt alle verfügbaren Befehle.'),
].map(command => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log(`[DISCORD] ${commands.length} Slash-Commands registriert.`);
}

async function sendLog(guild, title, description, color = 0x5865f2, channelKey = 'BOT_LOG_CHANNEL_ID') {
  const channel = guild.channels.cache.get(configured(channelKey));
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()] }).catch(() => {});
}

function rulesMessage() {
  return {
    embeds: [new EmbedBuilder().setColor(0x883232).setTitle('📜 Regelwerk bestätigen')
      .setDescription('Lies das Regelwerk aufmerksam. Mit dem Button bestätigst du, dass du es gelesen, verstanden und akzeptiert hast.')
      .setFooter({ text: `Planlos Create • Bot v${VERSION}` })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rules_accept').setLabel('Regeln akzeptieren').setStyle(ButtonStyle.Success),
    )],
  };
}

function minecraftEmbed() {
  const mc = state.minecraft;
  return new EmbedBuilder().setColor(mc.online ? 0x35a854 : 0xc0392b)
    .setTitle('⚙️ Planlos Create Serverstatus')
    .setDescription(mc.online ? 'Der Minecraft-Server ist **online**.' : 'Der Minecraft-Server ist derzeit **offline**.')
    .addFields(
      { name: 'Status', value: mc.online ? '🟢 Online' : '🔴 Offline', inline: true },
      { name: 'Spieler', value: mc.online ? `${mc.players}/${mc.maxPlayers}` : '–', inline: true },
      { name: 'Ping', value: mc.latency == null ? '–' : `${Math.round(mc.latency)} ms`, inline: true },
      { name: 'Version', value: mc.version || 'Unbekannt', inline: true },
      { name: 'Adresse', value: process.env.MINECRAFT_DISPLAY_ADDRESS || process.env.MINECRAFT_HOST || 'Nicht eingerichtet', inline: true },
    ).setFooter({ text: `Automatische Aktualisierung • Bot v${VERSION}` }).setTimestamp(new Date(mc.updatedAt || Date.now()));
}

async function updateStatusMessage() {
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  const channel = guild?.channels.cache.get(state.config.STATUS_CHANNEL_ID);
  if (!channel?.isTextBased() || !state.config.STATUS_MESSAGE_ID) return;
  const message = await channel.messages.fetch(state.config.STATUS_MESSAGE_ID).catch(() => null);
  if (message) await message.edit({ embeds: [minecraftEmbed()] }).catch(() => {});
}

async function createTicket(interaction) {
  const categoryId = configured('TICKET_CATEGORY_ID');
  const supportRoleId = configured('SUPPORT_ROLE_ID');
  if (!categoryId || !supportRoleId) return interaction.reply({ content: 'Das Ticket-System wurde noch nicht mit `/setup` eingerichtet.', flags: EPHEMERAL });
  const open = state.tickets.find(ticket => ticket.userId === interaction.user.id && ticket.status === 'open');
  if (open) return interaction.reply({ content: `Du hast bereits ein offenes Ticket: <#${open.channelId}>`, flags: EPHEMERAL });

  const type = interaction.options.getString('typ', true);
  const reason = interaction.options.getString('grund', true).slice(0, 1000);
  const channel = await interaction.guild.channels.create({
    name: safeChannelName(`ticket-${interaction.user.username}`),
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: `Ticket von ${interaction.user.tag} (${interaction.user.id})`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    ],
  });
  const ticket = { id: `${Date.now()}-${interaction.user.id}`, channelId: channel.id, userId: interaction.user.id, type, reason, status: 'open', createdAt: new Date().toISOString() };
  state.tickets.push(ticket);
  writeJson('tickets.json', state.tickets);
  await channel.send({
    content: `<@${interaction.user.id}> <@&${supportRoleId}>`,
    embeds: [new EmbedBuilder().setColor(0x3498db).setTitle(`🎫 Neues Ticket: ${type}`).setDescription(reason)
      .addFields({ name: 'Erstellt von', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Ticket-ID', value: `\`${ticket.id}\``, inline: true }).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ticket_close:${ticket.id}`).setLabel('Ticket schließen').setStyle(ButtonStyle.Danger),
    )],
  });
  await sendLog(interaction.guild, 'Ticket erstellt', `<@${interaction.user.id}> hat <#${channel.id}> erstellt.`, 0x3498db, 'TICKET_LOG_CHANNEL_ID');
  return interaction.reply({ content: `Dein Ticket wurde erstellt: <#${channel.id}>`, flags: EPHEMERAL });
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`[DISCORD] Eingeloggt als ${readyClient.user.tag}`);
  console.log(`[START] Planlos Create Bot v${VERSION} ist bereit.`);
  await readyClient.user.setPresence({ activities: [{ name: 'Planlos Create Server' }], status: 'online' });
  await refreshMinecraftStatus();
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === 'rules_accept') {
        const roleId = configured('VERIFIED_ROLE_ID');
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return interaction.reply({ content: 'Die Verifiziert-Rolle ist nicht eingerichtet.', flags: EPHEMERAL });
        if (interaction.member.roles.cache.has(roleId)) return interaction.reply({ content: 'Du hast die Regeln bereits bestätigt.', flags: EPHEMERAL });
        await interaction.member.roles.add(role, 'Regelwerk akzeptiert');
        state.verifications[interaction.user.id] = { userId: interaction.user.id, username: interaction.user.username, acceptedAt: new Date().toISOString() };
        writeJson('verifications.json', state.verifications);
        await sendLog(interaction.guild, 'Regelwerk bestätigt', `<@${interaction.user.id}> hat das Regelwerk akzeptiert.`, 0x35a854, 'RULES_LOG_CHANNEL_ID');
        return interaction.reply({ content: 'Regelwerk erfolgreich bestätigt.', flags: EPHEMERAL });
      }

      if (interaction.customId.startsWith('wl_accept:') || interaction.customId.startsWith('wl_reject:')) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Dafür fehlen dir die Rechte.', flags: EPHEMERAL });
        const [action, requestId] = interaction.customId.split(':');
        const request = state.whitelist.find(entry => entry.id === requestId);
        if (!request || request.status !== 'pending') return interaction.reply({ content: 'Dieser Antrag ist nicht mehr offen.', flags: EPHEMERAL });
        request.status = action === 'wl_accept' ? 'accepted' : 'rejected';
        request.reviewedBy = interaction.user.id;
        request.reviewedAt = new Date().toISOString();
        writeJson('whitelist.json', state.whitelist);
        const member = await interaction.guild.members.fetch(request.discordId).catch(() => null);
        if (request.status === 'accepted' && member) {
          const role = interaction.guild.roles.cache.get(configured('WHITELIST_ROLE_ID'));
          if (role) await member.roles.add(role, 'Whitelist angenommen').catch(() => {});
        }
        if (member) await member.send(`Dein Whitelist-Antrag für **${request.minecraftName}** wurde **${request.status === 'accepted' ? 'angenommen' : 'abgelehnt'}**.`).catch(() => {});
        const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(request.status === 'accepted' ? 0x35a854 : 0xc0392b)
          .addFields({ name: 'Entscheidung', value: `${request.status === 'accepted' ? '✅ Angenommen' : '❌ Abgelehnt'} von <@${interaction.user.id}>` });
        return interaction.update({ embeds: [embed], components: [] });
      }

      if (interaction.customId.startsWith('ticket_close:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = state.tickets.find(entry => entry.id === ticketId);
        if (!ticket || ticket.status !== 'open') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen.', flags: EPHEMERAL });
        const allowed = ticket.userId === interaction.user.id || interaction.member.roles.cache.has(configured('SUPPORT_ROLE_ID')) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
        if (!allowed) return interaction.reply({ content: 'Du darfst dieses Ticket nicht schließen.', flags: EPHEMERAL });
        ticket.status = 'closed';
        ticket.closedBy = interaction.user.id;
        ticket.closedAt = new Date().toISOString();
        writeJson('tickets.json', state.tickets);
        await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x7f8c8d).addFields({ name: 'Geschlossen', value: `Von <@${interaction.user.id}>` })], components: [] });
        await interaction.channel.permissionOverwrites.edit(ticket.userId, { SendMessages: false });
        await interaction.channel.setName(safeChannelName(`geschlossen-${interaction.channel.name}`));
        await sendLog(interaction.guild, 'Ticket geschlossen', `<#${interaction.channel.id}> wurde von <@${interaction.user.id}> geschlossen.`, 0x7f8c8d, 'TICKET_LOG_CHANNEL_ID');
        return;
      }

      if (interaction.customId.startsWith('project_done:') || interaction.customId.startsWith('project_delete:')) {
        const [action, projectId] = interaction.customId.split(':');
        const project = state.projects.find(entry => entry.id === projectId);
        if (!project) return interaction.reply({ content: 'Projekt nicht gefunden.', flags: EPHEMERAL });
        if (project.discordId !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'Du kannst nur dein eigenes Projekt bearbeiten.', flags: EPHEMERAL });
        if (action === 'project_delete') {
          state.projects = state.projects.filter(entry => entry.id !== projectId);
          writeJson('projects.json', state.projects);
          await interaction.message.delete().catch(() => {});
          return;
        }
        project.status = 'Abgeschlossen';
        project.updatedAt = new Date().toISOString();
        writeJson('projects.json', state.projects);
        return interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x35a854).spliceFields(1, 1, { name: 'Status', value: '✅ Abgeschlossen', inline: true })], components: [] });
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup') {
      state.config = {
        ...state.config,
        VERIFIED_ROLE_ID: interaction.options.getRole('verifiziert_rolle', true).id,
        RULES_LOG_CHANNEL_ID: interaction.options.getChannel('regel_log', true).id,
        WHITELIST_CHANNEL_ID: interaction.options.getChannel('whitelist_team', true).id,
        PROJECT_CHANNEL_ID: interaction.options.getChannel('projekt_kanal', true).id,
        BOT_LOG_CHANNEL_ID: interaction.options.getChannel('bot_log', true).id,
        WHITELIST_ROLE_ID: interaction.options.getRole('whitelist_rolle')?.id || null,
        SUPPORT_ROLE_ID: interaction.options.getRole('support_rolle')?.id || null,
        TICKET_CATEGORY_ID: interaction.options.getChannel('ticket_kategorie')?.id || null,
        TICKET_LOG_CHANNEL_ID: interaction.options.getChannel('ticket_log')?.id || null,
        CONTENT_CHANNEL_ID: interaction.options.getChannel('content_kanal')?.id || null,
      };
      saveConfig();
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x35a854).setTitle('✅ Bot-Setup gespeichert').setDescription('Rollen, Kanäle und das Ticket-System wurden eingerichtet.')], flags: EPHEMERAL });
    }
    if (interaction.commandName === 'regelnachricht') { await interaction.channel.send(rulesMessage()); return interaction.reply({ content: 'Regelnachricht wurde erstellt.', flags: EPHEMERAL }); }
    if (interaction.commandName === 'statusnachricht') {
      const message = await interaction.channel.send({ embeds: [minecraftEmbed()] });
      state.config.STATUS_CHANNEL_ID = interaction.channel.id;
      state.config.STATUS_MESSAGE_ID = message.id;
      saveConfig();
      return interaction.reply({ content: 'Statusnachricht wurde erstellt.', flags: EPHEMERAL });
    }
    if (interaction.commandName === 'ticket') return createTicket(interaction);
    if (interaction.commandName === 'whitelist') {
      const minecraftName = interaction.options.getString('minecraft_name', true).trim();
      if (!validMinecraftName(minecraftName)) return interaction.reply({ content: 'Der Minecraft-Name muss 3–16 Zeichen lang sein und darf nur Buchstaben, Zahlen und `_` enthalten.', flags: EPHEMERAL });
      if (state.whitelist.some(entry => entry.discordId === interaction.user.id && entry.status === 'pending')) return interaction.reply({ content: 'Du hast bereits einen offenen Antrag.', flags: EPHEMERAL });
      const request = { id: `${Date.now()}-${interaction.user.id}`, discordId: interaction.user.id, discordName: interaction.user.username, minecraftName, status: 'pending', createdAt: new Date().toISOString() };
      state.whitelist.push(request);
      writeJson('whitelist.json', state.whitelist);
      const channel = interaction.guild.channels.cache.get(configured('WHITELIST_CHANNEL_ID'));
      if (!channel?.isTextBased()) return interaction.reply({ content: 'Der Whitelist-Teamkanal ist nicht eingerichtet.', flags: EPHEMERAL });
      await channel.send({
        embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('📝 Neuer Whitelist-Antrag').addFields(
          { name: 'Discord', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Minecraft-Name', value: minecraftName, inline: true }, { name: 'Status', value: '⏳ Offen', inline: true },
        ).setTimestamp()],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`wl_accept:${request.id}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`wl_reject:${request.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
        )],
      });
      return interaction.reply({ content: `Whitelist-Antrag für **${minecraftName}** gesendet.`, flags: EPHEMERAL });
    }
    if (interaction.commandName === 'hier-baue-ich') {
      const existing = state.projects.find(entry => entry.discordId === interaction.user.id && entry.status !== 'Abgeschlossen');
      const project = existing || { id: `${Date.now()}-${interaction.user.id}`, discordId: interaction.user.id, discordName: interaction.user.username, createdAt: new Date().toISOString() };
      project.project = interaction.options.getString('projekt', true);
      project.area = interaction.options.getString('bereich', true);
      project.status = interaction.options.getString('status') || 'In Arbeit';
      project.updatedAt = new Date().toISOString();
      if (!existing) state.projects.push(project);
      const channel = interaction.guild.channels.cache.get(configured('PROJECT_CHANNEL_ID')) || interaction.channel;
      const embed = new EmbedBuilder().setColor(0xd07b35).setTitle(`🏗️ ${project.project}`).setDescription(`Projekt von <@${interaction.user.id}>`).addFields(
        { name: 'Bereich', value: project.area, inline: true }, { name: 'Status', value: project.status, inline: true }, { name: 'Aktualisiert', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`project_done:${project.id}`).setLabel('Abschließen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`project_delete:${project.id}`).setLabel('Löschen').setStyle(ButtonStyle.Danger),
      );
      if (existing?.messageId) {
        const oldChannel = interaction.guild.channels.cache.get(existing.channelId);
        const oldMessage = await oldChannel?.messages.fetch(existing.messageId).catch(() => null);
        if (oldMessage) { await oldMessage.edit({ embeds: [embed], components: [row] }); writeJson('projects.json', state.projects); return interaction.reply({ content: 'Projekt aktualisiert.', flags: EPHEMERAL }); }
      }
      const message = await channel.send({ embeds: [embed], components: [row] });
      project.channelId = channel.id; project.messageId = message.id;
      writeJson('projects.json', state.projects);
      return interaction.reply({ content: 'Projekt eingetragen.', flags: EPHEMERAL });
    }
    if (interaction.commandName === 'content') {
      const item = { id: `${Date.now()}-${interaction.user.id}`, discordId: interaction.user.id, type: interaction.options.getString('typ', true), url: interaction.options.getString('link', true), createdAt: new Date().toISOString() };
      try { new URL(item.url); } catch { return interaction.reply({ content: 'Bitte gib einen vollständigen gültigen Link an.', flags: EPHEMERAL }); }
      state.content.push(item); writeJson('content.json', state.content);
      const channel = interaction.guild.channels.cache.get(configured('CONTENT_CHANNEL_ID')) || interaction.channel;
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(`🎥 Neuer ${item.type}-Beitrag`).setDescription(`Von <@${interaction.user.id}>\n\n${item.url}`).setTimestamp()] });
      return interaction.reply({ content: 'Beitrag veröffentlicht.', flags: EPHEMERAL });
    }
    if (interaction.commandName === 'rollencheck') {
      const me = interaction.guild.members.me;
      const problems = [];
      for (const [permission, label] of [[PermissionFlagsBits.ManageRoles, 'Rollen verwalten'], [PermissionFlagsBits.ManageChannels, 'Kanäle verwalten'], [PermissionFlagsBits.SendMessages, 'Nachrichten senden']]) {
        if (!me.permissions.has(permission)) problems.push(`❌ \`${label}\` fehlt.`);
      }
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(problems.length ? 0xc0392b : 0x35a854).setTitle(problems.length ? '⚠️ Rechteprüfung' : '✅ Rechteprüfung').setDescription(problems.join('\n') || 'Alle grundlegenden Berechtigungen sind vorhanden.')], flags: EPHEMERAL });
    }
    if (interaction.commandName === 'ping') {
      const sent = await interaction.reply({ content: 'Ping wird gemessen …', flags: EPHEMERAL, withResponse: true });
      const latency = sent.resource?.message?.createdTimestamp ? sent.resource.message.createdTimestamp - interaction.createdTimestamp : 0;
      return interaction.editReply(`🏓 Bot: **${latency} ms**\n🌐 Discord: **${Math.round(client.ws.ping)} ms**`);
    }
    if (interaction.commandName === 'hilfe') return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x883232).setTitle(`📘 Planlos Create Bot – Hilfe v${VERSION}`).addFields(
        { name: 'Community', value: '`/whitelist` · `/hier-baue-ich` · `/content` · `/ticket`' },
        { name: 'Information', value: '`/botinfo` · `/ping` · `/hilfe`' },
        { name: 'Administration', value: '`/setup` · `/regelnachricht` · `/statusnachricht` · `/rollencheck`' },
      )], flags: EPHEMERAL,
    });
    if (interaction.commandName === 'botinfo') {
      const uptimeSeconds = Math.floor(process.uptime());
      const uptime = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x883232).setTitle(`⚙️ Planlos Create Bot v${VERSION}`).addFields(
        { name: 'Discord', value: client.isReady() ? '🟢 Online' : '🔴 Offline', inline: true },
        { name: 'Minecraft', value: state.minecraft.online ? '🟢 Online' : '🔴 Offline', inline: true },
        { name: 'Uptime', value: uptime, inline: true },
        { name: 'Mitglieder', value: String(interaction.guild?.memberCount || 0), inline: true },
        { name: 'Offene Tickets', value: String(state.tickets.filter(t => t.status === 'open').length), inline: true },
        { name: 'Offene Whitelist-Anträge', value: String(state.whitelist.filter(w => w.status === 'pending').length), inline: true },
        { name: 'Slash-Commands', value: String(commands.length), inline: true },
      ).setTimestamp()], flags: EPHEMERAL });
    }
  } catch (error) {
    console.error('[DISCORD] Interaktionsfehler:', error);
    const message = 'Bei der Ausführung ist ein Fehler aufgetreten. Bitte prüfe die Bot-Logs.';
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, flags: EPHEMERAL }).catch(() => {});
    else await interaction.reply({ content: message, flags: EPHEMERAL }).catch(() => {});
  }
});

async function refreshMinecraftStatus() {
  const host = process.env.MINECRAFT_HOST;
  if (!host) { state.minecraft.updatedAt = new Date().toISOString(); return updateStatusMessage(); }
  try {
    const result = await status(host, Number(process.env.MINECRAFT_PORT || 25565), { timeout: 5000, enableSRV: true });
    state.minecraft = { online: true, players: result.players.online, maxPlayers: result.players.max, version: result.version.name, motd: result.motd.clean, latency: result.roundTripLatency, updatedAt: new Date().toISOString() };
  } catch (error) {
    state.minecraft = { online: false, players: 0, maxPlayers: 0, version: null, motd: null, latency: null, updatedAt: new Date().toISOString() };
    console.warn(`[MINECRAFT] Statusabfrage fehlgeschlagen: ${error.message}`);
  }
  await updateStatusMessage();
}

function startApi() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.WEBSITE_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'planlos-create-bot', version: VERSION, uptime: process.uptime(), timestamp: new Date().toISOString() }));
  app.use('/api', (req, res, next) => {
    const expected = process.env.API_KEY;
    if (!expected || expected === 'change-me-to-a-long-random-secret') return res.status(503).json({ error: 'API_KEY ist nicht sicher konfiguriert.' });
    const provided = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
    return provided === expected ? next() : res.status(401).json({ error: 'Nicht autorisiert.' });
  });
  app.get('/api/minecraft/status', (_req, res) => res.json(state.minecraft));
  app.get('/api/discord/stats', (_req, res) => res.json({ members: client.guilds.cache.get(process.env.GUILD_ID)?.memberCount || 0, botOnline: client.isReady(), botUser: client.user?.tag || null, version: VERSION }));
  app.get('/api/projects', (_req, res) => res.json(state.projects));
  app.get('/api/content', (_req, res) => res.json(state.content));
  app.get('/api/whitelist', (_req, res) => res.json(state.whitelist));
  app.get('/api/tickets', (_req, res) => res.json(state.tickets));
  const port = Number(process.env.API_PORT || 27051);
  const host = process.env.API_HOST || '0.0.0.0';
  app.listen(port, host, () => console.log(`[API] Läuft auf http://${host}:${port}`));
}

(async () => {
  console.log(`[START] Starte Planlos Create Bot v${VERSION} …`);
  await registerCommands();
  startApi();
  setInterval(refreshMinecraftStatus, Math.max(30, Number(process.env.STATUS_INTERVAL_SECONDS || 60)) * 1000).unref();
  await client.login(process.env.DISCORD_TOKEN);
})().catch(error => {
  console.error('[START] Der Bot konnte nicht gestartet werden:', error);
  process.exit(1);
});
