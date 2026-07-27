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
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const VERSION = '0.2.0';
const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`[CONFIG] ${name} fehlt in der .env-Datei.`);
    process.exit(1);
  }
}

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

function readJson(file, fallback) {
  const target = path.join(dataDir, file);
  try {
    if (!fs.existsSync(target)) return fallback;
    return JSON.parse(fs.readFileSync(target, 'utf8'));
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

function configured(name) {
  return state.config[name] || process.env[name] || null;
}

function saveConfig() {
  writeJson('config.json', state.config);
}

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
  .addRoleOption(option => option
    .setName('verifiziert_rolle')
    .setDescription('Rolle nach Regelbestätigung')
    .setRequired(true));

/*
 * Bei Discord müssen zuerst alle Pflichtfelder kommen.
 */
setup = addTextChannelOption(
  setup,
  'regel_log',
  'Kanal für Regelbestätigungen',
  true,
);

setup = addTextChannelOption(
  setup,
  'whitelist_team',
  'Teamkanal für Whitelist-Anträge',
  true,
);

setup = addTextChannelOption(
  setup,
  'projekt_kanal',
  'Kanal für Hier-baue-ich-Projekte',
  true,
);

setup = addTextChannelOption(
  setup,
  'bot_log',
  'Interner Bot-Logkanal',
  true,
);

/*
 * Optionale Felder müssen danach stehen.
 */
setup = setup.addRoleOption(option => option
  .setName('whitelist_rolle')
  .setDescription('Optionale Rolle nach Whitelist-Annahme')
  .setRequired(false));

setup = addTextChannelOption(
  setup,
  'content_kanal',
  'Kanal für Content-Creator-Beiträge',
  false,
);

const commands = [
  setup,
  new SlashCommandBuilder()
    .setName('regelnachricht')
    .setDescription('Erstellt die Nachricht zur Regelbestätigung.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('statusnachricht')
    .setDescription('Erstellt eine automatisch aktualisierte Minecraft-Statusnachricht.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Sendet deinen Minecraft-Namen für die Whitelist.')
    .addStringOption(option => option.setName('minecraft_name').setDescription('Dein Minecraft-Name').setRequired(true)),
  new SlashCommandBuilder()
    .setName('hier-baue-ich')
    .setDescription('Meldet oder aktualisiert dein aktuelles Bauprojekt.')
    .addStringOption(option => option.setName('projekt').setDescription('Name des Projekts').setRequired(true))
    .addStringOption(option => option.setName('bereich').setDescription('Bauort oder Bereich').setRequired(true))
    .addStringOption(option => option.setName('status').setDescription('Aktueller Stand')),
  new SlashCommandBuilder()
    .setName('content')
    .setDescription('Meldet einen Community-Beitrag.')
    .addStringOption(option => option.setName('typ').setDescription('Art des Beitrags').setRequired(true)
      .addChoices(
        { name: 'Video', value: 'Video' },
        { name: 'Stream', value: 'Stream' },
        { name: 'Clip', value: 'Clip' },
        { name: 'Screenshot', value: 'Screenshot' },
      ))
    .addStringOption(option => option.setName('link').setDescription('Link zum Beitrag').setRequired(true)),
  new SlashCommandBuilder()
    .setName('rollencheck')
    .setDescription('Prüft Rollen und wichtige Bot-Berechtigungen.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Zeigt Informationen über den Planlos Create Bot.'),
].map(command => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log(`[DISCORD] ${commands.length} Slash-Commands registriert.`);
}

function rulesMessage() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x883232)
      .setTitle('📜 Regelwerk bestätigen')
      .setDescription('Bitte lies das vollständige Regelwerk aufmerksam durch.\n\nMit dem Button bestätigst du, dass du die Regeln gelesen, verstanden und akzeptiert hast. Danach erhältst du automatisch die freigeschaltete Rolle.')
      .setFooter({ text: `Planlos Create Server • Bot v${VERSION}` })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rules_accept').setLabel('Regeln akzeptieren').setStyle(ButtonStyle.Success),
    )],
  };
}

function minecraftEmbed() {
  const mc = state.minecraft;
  const embed = new EmbedBuilder()
    .setColor(mc.online ? 0x35a854 : 0xc0392b)
    .setTitle('⚙️ Planlos Create Serverstatus')
    .setDescription(mc.online ? 'Der Minecraft-Server ist **online**.' : 'Der Minecraft-Server ist derzeit **offline**.')
    .addFields(
      { name: 'Status', value: mc.online ? '🟢 Online' : '🔴 Offline', inline: true },
      { name: 'Spieler', value: mc.online ? `${mc.players}/${mc.maxPlayers}` : '–', inline: true },
      { name: 'Ping', value: mc.latency == null ? '–' : `${Math.round(mc.latency)} ms`, inline: true },
      { name: 'Version', value: mc.version || 'Unbekannt', inline: true },
      { name: 'Adresse', value: process.env.MINECRAFT_DISPLAY_ADDRESS || process.env.MINECRAFT_HOST || 'Nicht eingerichtet', inline: true },
    )
    .setFooter({ text: `Automatische Aktualisierung • Bot v${VERSION}` })
    .setTimestamp(new Date(mc.updatedAt || Date.now()));
  if (mc.motd) embed.addFields({ name: 'MOTD', value: mc.motd.slice(0, 1024) });
  return embed;
}

async function sendLog(guild, title, description, color = 0x5865f2) {
  const channelId = configured('BOT_LOG_CHANNEL_ID');
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()] }).catch(() => {});
}

async function updateStatusMessage() {
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild || !state.config.STATUS_CHANNEL_ID || !state.config.STATUS_MESSAGE_ID) return;
  const channel = guild.channels.cache.get(state.config.STATUS_CHANNEL_ID);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(state.config.STATUS_MESSAGE_ID).catch(() => null);
  if (message) await message.edit({ embeds: [minecraftEmbed()] }).catch(() => {});
}

function validMinecraftName(name) {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

client.once('ready', async () => {
  console.log(`[DISCORD] Eingeloggt als ${client.user.tag}`);
  await client.user.setPresence({ activities: [{ name: 'Planlos Create Server' }], status: 'online' });
  await refreshMinecraftStatus();
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === 'rules_accept') {
        const roleId = configured('VERIFIED_ROLE_ID');
        if (!roleId) return interaction.reply({ content: 'Die Verifiziert-Rolle ist noch nicht eingerichtet.', ephemeral: true });
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return interaction.reply({ content: 'Die konfigurierte Rolle wurde nicht gefunden.', ephemeral: true });
        if (interaction.member.roles.cache.has(roleId)) return interaction.reply({ content: 'Du hast die Regeln bereits bestätigt.', ephemeral: true });
        await interaction.member.roles.add(role, 'Regelwerk akzeptiert');
        state.verifications[interaction.user.id] = { userId: interaction.user.id, username: interaction.user.username, acceptedAt: new Date().toISOString() };
        writeJson('verifications.json', state.verifications);
        const logId = configured('RULES_LOG_CHANNEL_ID');
        const logChannel = logId ? interaction.guild.channels.cache.get(logId) : null;
        if (logChannel?.isTextBased()) await logChannel.send(`✅ Regelwerk akzeptiert: <@${interaction.user.id}> (\`${interaction.user.id}\`)`);
        await sendLog(interaction.guild, 'Regelwerk bestätigt', `<@${interaction.user.id}> hat das Regelwerk akzeptiert.`, 0x35a854);
        return interaction.reply({ content: 'Du hast das Regelwerk erfolgreich akzeptiert.', ephemeral: true });
      }

      if (interaction.customId.startsWith('wl_accept:') || interaction.customId.startsWith('wl_reject:')) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Dafür fehlen dir die Rechte.', ephemeral: true });
        const [action, requestId] = interaction.customId.split(':');
        const request = state.whitelist.find(entry => entry.id === requestId);
        if (!request) return interaction.reply({ content: 'Der Antrag wurde nicht gefunden.', ephemeral: true });
        if (request.status !== 'pending') return interaction.reply({ content: 'Dieser Antrag wurde bereits bearbeitet.', ephemeral: true });
        request.status = action === 'wl_accept' ? 'accepted' : 'rejected';
        request.reviewedBy = interaction.user.id;
        request.reviewedAt = new Date().toISOString();
        writeJson('whitelist.json', state.whitelist);
        const member = await interaction.guild.members.fetch(request.discordId).catch(() => null);
        if (request.status === 'accepted' && member) {
          const roleId = configured('WHITELIST_ROLE_ID');
          const role = roleId ? interaction.guild.roles.cache.get(roleId) : null;
          if (role) await member.roles.add(role, 'Whitelist angenommen').catch(() => {});
        }
        if (member) await member.send(request.status === 'accepted' ? `Dein Whitelist-Antrag für **${request.minecraftName}** wurde angenommen.` : `Dein Whitelist-Antrag für **${request.minecraftName}** wurde abgelehnt.`).catch(() => {});
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor(request.status === 'accepted' ? 0x35a854 : 0xc0392b)
          .addFields({ name: 'Entscheidung', value: `${request.status === 'accepted' ? '✅ Angenommen' : '❌ Abgelehnt'} von <@${interaction.user.id}>` });
        await interaction.update({ embeds: [embed], components: [] });
        return sendLog(interaction.guild, 'Whitelist bearbeitet', `Antrag von <@${request.discordId}> für **${request.minecraftName}**: **${request.status}**`);
      }

      if (interaction.customId.startsWith('project_done:') || interaction.customId.startsWith('project_delete:')) {
        const [action, projectId] = interaction.customId.split(':');
        const project = state.projects.find(entry => entry.id === projectId);
        if (!project) return interaction.reply({ content: 'Projekt nicht gefunden.', ephemeral: true });
        const allowed = project.discordId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
        if (!allowed) return interaction.reply({ content: 'Du kannst nur dein eigenes Projekt bearbeiten.', ephemeral: true });
        if (action === 'project_delete') {
          state.projects = state.projects.filter(entry => entry.id !== projectId);
          writeJson('projects.json', state.projects);
          await interaction.message.delete().catch(() => {});
          return interaction.reply({ content: 'Projekt wurde gelöscht.', ephemeral: true });
        }
        project.status = 'Abgeschlossen';
        project.updatedAt = new Date().toISOString();
        writeJson('projects.json', state.projects);
        const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x35a854).spliceFields(1, 1, { name: 'Status', value: '✅ Abgeschlossen', inline: true });
        return interaction.update({ embeds: [embed], components: [] });
      }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup') {
      state.config = {
        ...state.config,
        VERIFIED_ROLE_ID: interaction.options.getRole('verifiziert_rolle', true).id,
        WHITELIST_ROLE_ID: interaction.options.getRole('whitelist_rolle')?.id || null,
        RULES_LOG_CHANNEL_ID: interaction.options.getChannel('regel_log', true).id,
        WHITELIST_CHANNEL_ID: interaction.options.getChannel('whitelist_team', true).id,
        PROJECT_CHANNEL_ID: interaction.options.getChannel('projekt_kanal', true).id,
        CONTENT_CHANNEL_ID: interaction.options.getChannel('content_kanal')?.id || null,
        BOT_LOG_CHANNEL_ID: interaction.options.getChannel('bot_log', true).id,
      };
      saveConfig();
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x35a854).setTitle('✅ Bot-Setup gespeichert').setDescription('Rollen und Kanäle wurden erfolgreich eingerichtet.')], ephemeral: true });
    }

    if (interaction.commandName === 'regelnachricht') {
      await interaction.channel.send(rulesMessage());
      return interaction.reply({ content: 'Regelnachricht wurde erstellt.', ephemeral: true });
    }

    if (interaction.commandName === 'statusnachricht') {
      const message = await interaction.channel.send({ embeds: [minecraftEmbed()] });
      state.config.STATUS_CHANNEL_ID = interaction.channel.id;
      state.config.STATUS_MESSAGE_ID = message.id;
      saveConfig();
      return interaction.reply({ content: 'Statusnachricht wurde erstellt und wird automatisch aktualisiert.', ephemeral: true });
    }

    if (interaction.commandName === 'whitelist') {
      const minecraftName = interaction.options.getString('minecraft_name', true).trim();
      if (!validMinecraftName(minecraftName)) return interaction.reply({ content: 'Der Minecraft-Name muss 3–16 Zeichen lang sein und darf nur Buchstaben, Zahlen und `_` enthalten.', ephemeral: true });
      if (state.whitelist.some(entry => entry.discordId === interaction.user.id && entry.status === 'pending')) return interaction.reply({ content: 'Du hast bereits einen offenen Whitelist-Antrag.', ephemeral: true });
      const request = { id: `${Date.now()}-${interaction.user.id}`, discordId: interaction.user.id, discordName: interaction.user.username, minecraftName, status: 'pending', createdAt: new Date().toISOString() };
      state.whitelist.push(request);
      writeJson('whitelist.json', state.whitelist);
      const channelId = configured('WHITELIST_CHANNEL_ID');
      const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
      if (!channel?.isTextBased()) return interaction.reply({ content: 'Der Whitelist-Teamkanal ist noch nicht eingerichtet.', ephemeral: true });
      const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('📝 Neuer Whitelist-Antrag').addFields(
        { name: 'Discord', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Minecraft-Name', value: minecraftName, inline: true },
        { name: 'Status', value: '⏳ Offen', inline: true },
      ).setTimestamp();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`wl_accept:${request.id}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`wl_reject:${request.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
      );
      await channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: `Dein Whitelist-Antrag für **${minecraftName}** wurde gesendet.`, ephemeral: true });
    }

    if (interaction.commandName === 'hier-baue-ich') {
      const existing = state.projects.find(entry => entry.discordId === interaction.user.id && entry.status !== 'Abgeschlossen');
      const project = existing || { id: `${Date.now()}-${interaction.user.id}`, discordId: interaction.user.id, discordName: interaction.user.username, createdAt: new Date().toISOString() };
      project.project = interaction.options.getString('projekt', true);
      project.area = interaction.options.getString('bereich', true);
      project.status = interaction.options.getString('status') || 'In Arbeit';
      project.updatedAt = new Date().toISOString();
      if (!existing) state.projects.push(project);
      writeJson('projects.json', state.projects);
      const channelId = configured('PROJECT_CHANNEL_ID');
      const channel = channelId ? interaction.guild.channels.cache.get(channelId) : interaction.channel;
      if (!channel?.isTextBased()) return interaction.reply({ content: 'Der Projektkanal ist noch nicht eingerichtet.', ephemeral: true });
      const embed = new EmbedBuilder().setColor(0xd07b35).setTitle(`🏗️ ${project.project}`).setDescription(`Projekt von <@${interaction.user.id}>`).addFields(
        { name: 'Bereich', value: project.area, inline: true },
        { name: 'Status', value: project.status, inline: true },
        { name: 'Aktualisiert', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`project_done:${project.id}`).setLabel('Abschließen').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`project_delete:${project.id}`).setLabel('Löschen').setStyle(ButtonStyle.Danger),
      );
      if (existing?.messageId && existing.channelId) {
        const oldChannel = interaction.guild.channels.cache.get(existing.channelId);
        const oldMessage = oldChannel?.isTextBased() ? await oldChannel.messages.fetch(existing.messageId).catch(() => null) : null;
        if (oldMessage) {
          await oldMessage.edit({ embeds: [embed], components: [row] });
          return interaction.reply({ content: 'Dein Projekt wurde aktualisiert.', ephemeral: true });
        }
      }
      const message = await channel.send({ embeds: [embed], components: [row] });
      project.channelId = channel.id;
      project.messageId = message.id;
      writeJson('projects.json', state.projects);
      return interaction.reply({ content: 'Dein Projekt wurde eingetragen.', ephemeral: true });
    }

    if (interaction.commandName === 'content') {
      const item = { id: `${Date.now()}-${interaction.user.id}`, discordId: interaction.user.id, discordName: interaction.user.username, type: interaction.options.getString('typ', true), url: interaction.options.getString('link', true), createdAt: new Date().toISOString() };
      try { new URL(item.url); } catch { return interaction.reply({ content: 'Bitte gib einen vollständigen gültigen Link an.', ephemeral: true }); }
      state.content.push(item);
      writeJson('content.json', state.content);
      const channelId = configured('CONTENT_CHANNEL_ID');
      const channel = channelId ? interaction.guild.channels.cache.get(channelId) : interaction.channel;
      if (channel?.isTextBased()) await channel.send({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(`🎥 Neuer ${item.type}-Beitrag`).setDescription(`Von <@${interaction.user.id}>\n\n${item.url}`).setTimestamp()] });
      return interaction.reply({ content: 'Dein Beitrag wurde veröffentlicht.', ephemeral: true });
    }

    if (interaction.commandName === 'rollencheck') {
      const me = interaction.guild.members.me;
      const verified = interaction.guild.roles.cache.get(configured('VERIFIED_ROLE_ID'));
      const whitelist = interaction.guild.roles.cache.get(configured('WHITELIST_ROLE_ID'));
      const problems = [];
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) problems.push('❌ `Rollen verwalten` fehlt.');
      if (!me.permissions.has(PermissionFlagsBits.SendMessages)) problems.push('❌ `Nachrichten senden` fehlt.');
      if (verified && me.roles.highest.comparePositionTo(verified) <= 0) problems.push('❌ Bot-Rolle liegt nicht über der Verifiziert-Rolle.');
      if (whitelist && me.roles.highest.comparePositionTo(whitelist) <= 0) problems.push('❌ Bot-Rolle liegt nicht über der Whitelist-Rolle.');
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(problems.length ? 0xc0392b : 0x35a854).setTitle(problems.length ? '⚠️ Rechteprüfung' : '✅ Rechteprüfung').setDescription(problems.length ? problems.join('\n') : 'Alle grundlegenden Berechtigungen sehen korrekt aus.')], ephemeral: true });
    }

    if (interaction.commandName === 'botinfo') {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x883232).setTitle(`Planlos Create Bot v${VERSION}`).addFields(
        { name: 'Discord', value: client.isReady() ? '🟢 Online' : '🔴 Offline', inline: true },
        { name: 'Minecraft', value: state.minecraft.online ? '🟢 Online' : '🔴 Offline', inline: true },
        { name: 'API-Port', value: String(process.env.API_PORT || 27051), inline: true },
        { name: 'Projekte', value: String(state.projects.length), inline: true },
        { name: 'Whitelist-Anträge', value: String(state.whitelist.length), inline: true },
      )], ephemeral: true });
    }
  } catch (error) {
    console.error('[DISCORD] Interaktionsfehler:', error);
    const message = 'Bei der Ausführung ist ein Fehler aufgetreten. Bitte prüfe die Bot-Logs.';
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

async function refreshMinecraftStatus() {
  const host = process.env.MINECRAFT_HOST;
  if (!host) {
    state.minecraft.updatedAt = new Date().toISOString();
    await updateStatusMessage();
    return;
  }
  try {
    const result = await status(host, Number(process.env.MINECRAFT_PORT || 25565), { timeout: 5000, enableSRV: true });
    state.minecraft = {
      online: true,
      players: result.players.online,
      maxPlayers: result.players.max,
      version: result.version.name,
      motd: result.motd.clean,
      latency: result.roundTripLatency,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    state.minecraft = { online: false, players: 0, maxPlayers: 0, version: null, motd: null, latency: null, updatedAt: new Date().toISOString() };
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
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'planlos-create-bot', version: VERSION, uptime: process.uptime() }));
  app.use('/api', (req, res, next) => {
    const expected = process.env.API_KEY;
    if (!expected || expected === 'change-me-to-a-long-random-secret') return res.status(503).json({ error: 'API_KEY ist nicht sicher konfiguriert.' });
    const provided = req.get('x-api-key') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (provided !== expected) return res.status(401).json({ error: 'Nicht autorisiert.' });
    next();
  });
  app.get('/api/minecraft/status', (_req, res) => res.json(state.minecraft));
  app.get('/api/discord/stats', (_req, res) => {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    res.json({ members: guild?.memberCount || 0, botOnline: client.isReady(), botUser: client.user?.tag || null });
  });
  app.get('/api/projects', (_req, res) => res.json(state.projects));
  app.get('/api/content', (_req, res) => res.json(state.content));
  const port = Number(process.env.API_PORT || 27051);
  const host = process.env.API_HOST || '0.0.0.0';
  app.listen(port, host, () => console.log(`[API] Läuft auf http://${host}:${port}`));
}

(async () => {
  await registerCommands();
  startApi();
  setInterval(refreshMinecraftStatus, Math.max(30, Number(process.env.STATUS_INTERVAL_SECONDS || 60)) * 1000).unref();
  await client.login(process.env.DISCORD_TOKEN);
})().catch(error => {
  console.error('[START] Der Bot konnte nicht gestartet werden:', error);
  process.exit(1);
});
