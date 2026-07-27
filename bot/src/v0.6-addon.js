'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const VERSION = '0.6.0';
const EPHEMERAL = MessageFlags.Ephemeral;
const dataDir = path.join(__dirname, '..', 'data');
const webDir = path.join(__dirname, '..', '..', 'webpanel');
const readJson = (file, fallback) => {
  try {
    const target = path.join(dataDir, file);
    return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : fallback;
  } catch (error) {
    console.error(`[V0.6] ${file} konnte nicht gelesen werden:`, error);
    return fallback;
  }
};
const writeJson = (file, value) => {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, file);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, target);
};
const config = () => readJson('config.json', {});
const tickets = () => readJson('tickets.json', []);
const safeName = value => value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'ticket';

const extraCommands = [
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Erstellt das Ticket-Auswahlpanel.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('ticket-umbenennen').setDescription('Benennt das aktuelle Ticket um.')
    .addStringOption(o => o.setName('name').setDescription('Neuer Kanalname').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-hinzufuegen').setDescription('Fügt einen Benutzer zum Ticket hinzu.')
    .addUserOption(o => o.setName('user').setDescription('Benutzer').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-entfernen').setDescription('Entfernt einen Benutzer aus dem Ticket.')
    .addUserOption(o => o.setName('user').setDescription('Benutzer').setRequired(true)),
].map(command => command.toJSON());

const originalPut = REST.prototype.put;
REST.prototype.put = function patchedPut(route, options = {}) {
  if (Array.isArray(options.body)) {
    const names = new Set(options.body.map(command => command.name));
    options = { ...options, body: [...options.body, ...extraCommands.filter(command => !names.has(command.name))] };
  }
  return originalPut.call(this, route, options);
};

function getOpenTicket(channelId) {
  return tickets().find(ticket => ticket.channelId === channelId && ticket.status === 'open');
}

function isSupport(interaction) {
  const supportRoleId = config().SUPPORT_ROLE_ID;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
    || Boolean(supportRoleId && interaction.member?.roles?.cache?.has(supportRoleId));
}

async function createPanelTicket(interaction, type) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const settings = config();
  if (!settings.TICKET_CATEGORY_ID || !settings.SUPPORT_ROLE_ID) return interaction.editReply('Das Ticket-System ist noch nicht vollständig mit `/setup` eingerichtet.');
  const allTickets = tickets();
  const existing = allTickets.find(ticket => ticket.userId === interaction.user.id && ticket.status === 'open');
  if (existing) return interaction.editReply(`Du hast bereits ein offenes Ticket: <#${existing.channelId}>`);

  const channel = await interaction.guild.channels.create({
    name: safeName(`ticket-${type}-${interaction.user.username}`),
    type: ChannelType.GuildText,
    parent: settings.TICKET_CATEGORY_ID,
    topic: `Ticket von ${interaction.user.tag} (${interaction.user.id}) | Typ: ${type}`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: settings.SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    ],
  });

  const ticket = {
    id: `${Date.now()}-${interaction.user.id}`,
    channelId: channel.id,
    userId: interaction.user.id,
    type,
    reason: `Über Ticket-Panel erstellt (${type})`,
    status: 'open',
    createdAt: new Date().toISOString(),
    claimedBy: null,
    addedUsers: [],
  };
  allTickets.push(ticket);
  writeJson('tickets.json', allTickets);

  await channel.send({
    content: `<@${interaction.user.id}> <@&${settings.SUPPORT_ROLE_ID}>`,
    embeds: [new EmbedBuilder().setColor(0x2f81f7).setTitle(`🎫 ${type}`).setDescription('Beschreibe dein Anliegen bitte möglichst genau. Ein Teammitglied kümmert sich darum.').addFields(
      { name: 'Erstellt von', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Status', value: '🟡 Offen', inline: true },
      { name: 'Ticket-ID', value: `\`${ticket.id}\``, inline: false },
    ).setFooter({ text: `Planlos Create Ticket-System v${VERSION}` }).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ticket_claim:${ticket.id}`).setLabel('Ticket übernehmen').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ticket_close:${ticket.id}`).setLabel('Ticket schließen').setStyle(ButtonStyle.Danger),
    )],
  });
  return interaction.editReply(`Dein Ticket wurde erstellt: <#${channel.id}>`);
}

async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_panel_select') {
    return createPanelTicket(interaction, interaction.values[0]);
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_claim:')) {
    const allTickets = tickets();
    const ticket = allTickets.find(entry => entry.id === interaction.customId.split(':')[1] && entry.status === 'open');
    if (!ticket) return interaction.reply({ content: 'Dieses Ticket ist nicht mehr offen.', flags: EPHEMERAL });
    if (!isSupport(interaction)) return interaction.reply({ content: 'Nur das Support-Team kann Tickets übernehmen.', flags: EPHEMERAL });
    ticket.claimedBy = interaction.user.id;
    ticket.claimedAt = new Date().toISOString();
    writeJson('tickets.json', allTickets);
    await interaction.channel.send(`🛠️ <@${interaction.user.id}> hat dieses Ticket übernommen.`);
    return interaction.reply({ content: 'Ticket erfolgreich übernommen.', flags: EPHEMERAL });
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ticketpanel') {
    const panel = new EmbedBuilder().setColor(0x2f81f7).setTitle('Planlos Create Support').setDescription('Wähle unten aus, wobei du Unterstützung benötigst. Danach wird automatisch ein privater Ticket-Kanal erstellt.').addFields(
      { name: 'Allgemeine Hilfe', value: 'Fragen zum Server oder zur Community.', inline: true },
      { name: 'Technik', value: 'Fehler, Verbindungs- oder Modprobleme.', inline: true },
      { name: 'Spieler melden', value: 'Meldungen werden vertraulich behandelt.', inline: true },
    ).setFooter({ text: `Ticket-System v${VERSION}` });
    const menu = new StringSelectMenuBuilder().setCustomId('ticket_panel_select').setPlaceholder('Ticket-Kategorie auswählen').addOptions(
      { label: 'Allgemeine Hilfe', value: 'Allgemeine Hilfe', emoji: '💬' },
      { label: 'Technisches Problem', value: 'Technisches Problem', emoji: '🛠️' },
      { label: 'Spieler melden', value: 'Spieler melden', emoji: '⚠️' },
      { label: 'Sonstiges', value: 'Sonstiges', emoji: '📌' },
    );
    await interaction.channel.send({ embeds: [panel], components: [new ActionRowBuilder().addComponents(menu)] });
    return interaction.reply({ content: 'Ticket-Panel wurde erstellt.', flags: EPHEMERAL });
  }

  if (!['ticket-umbenennen', 'ticket-hinzufuegen', 'ticket-entfernen'].includes(interaction.commandName)) return;
  const ticket = getOpenTicket(interaction.channelId);
  if (!ticket) return interaction.reply({ content: 'Dieser Befehl funktioniert nur in einem offenen Ticket.', flags: EPHEMERAL });
  if (!isSupport(interaction) && ticket.userId !== interaction.user.id) return interaction.reply({ content: 'Dafür fehlen dir die Rechte.', flags: EPHEMERAL });

  if (interaction.commandName === 'ticket-umbenennen') {
    const name = safeName(interaction.options.getString('name', true));
    await interaction.channel.setName(name);
    return interaction.reply({ content: `Ticket wurde in **${name}** umbenannt.`, flags: EPHEMERAL });
  }

  if (!isSupport(interaction)) return interaction.reply({ content: 'Nur das Support-Team kann Benutzer verwalten.', flags: EPHEMERAL });
  const user = interaction.options.getUser('user', true);
  const allTickets = tickets();
  const stored = allTickets.find(entry => entry.id === ticket.id);
  if (interaction.commandName === 'ticket-hinzufuegen') {
    await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
    stored.addedUsers = [...new Set([...(stored.addedUsers || []), user.id])];
    writeJson('tickets.json', allTickets);
    return interaction.reply({ content: `<@${user.id}> wurde zum Ticket hinzugefügt.`, flags: EPHEMERAL });
  }
  await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
  stored.addedUsers = (stored.addedUsers || []).filter(id => id !== user.id);
  writeJson('tickets.json', allTickets);
  return interaction.reply({ content: `<@${user.id}> wurde aus dem Ticket entfernt.`, flags: EPHEMERAL });
}

const originalEmit = Client.prototype.emit;
Client.prototype.emit = function patchedEmit(eventName, ...args) {
  if (eventName === Events.InteractionCreate) {
    handleInteraction(args[0]).catch(error => console.error('[V0.6] Interaktionsfehler:', error));
  }
  return originalEmit.call(this, eventName, ...args);
};

function startWebPanel() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  app.use(express.static(webDir));
  app.get('/panel-api/health', (_req, res) => res.json({ ok: true, version: VERSION }));
  app.use('/panel-api', (req, res, next) => {
    const expected = process.env.PANEL_KEY || process.env.API_KEY;
    const provided = req.get('x-panel-key') || req.query.key;
    if (!expected || expected === 'change-me-to-a-long-random-secret') return res.status(503).json({ error: 'PANEL_KEY oder API_KEY ist nicht sicher konfiguriert.' });
    return provided === expected ? next() : res.status(401).json({ error: 'Nicht autorisiert.' });
  });
  app.get('/panel-api/overview', (_req, res) => {
    const ticketData = tickets();
    const whitelist = readJson('whitelist.json', []);
    const projects = readJson('projects.json', []);
    res.json({
      version: VERSION,
      tickets: { total: ticketData.length, open: ticketData.filter(t => t.status === 'open').length, closed: ticketData.filter(t => t.status === 'closed').length, items: ticketData.slice().reverse().slice(0, 50) },
      whitelist: { total: whitelist.length, pending: whitelist.filter(w => w.status === 'pending').length },
      projects: { total: projects.length, active: projects.filter(p => p.status !== 'Abgeschlossen').length },
      updatedAt: new Date().toISOString(),
    });
  });
  const port = Number(process.env.WEB_PANEL_PORT || 27052);
  const host = process.env.WEB_PANEL_HOST || '0.0.0.0';
  app.listen(port, host, () => console.log(`[WEBPANEL] v${VERSION} läuft auf http://${host}:${port}`));
}

startWebPanel();
console.log(`[V0.6] Ticket-System Plus geladen.`);
