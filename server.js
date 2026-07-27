'use strict';

const path = require('node:path');
const {
  Client,
  Events,
  MessageFlags,
} = require('discord.js');

require('dotenv').config({
  path: path.join(__dirname, 'bot', '.env'),
});

/*
 * Ticket-Kanäle können länger als drei Sekunden zum Erstellen benötigen.
 * Discord verlangt aber innerhalb von drei Sekunden eine Bestätigung.
 * Deshalb bestätigen wir /ticket sofort und leiten die spätere reply()-Antwort
 * automatisch an editReply() weiter.
 */
const originalEmit = Client.prototype.emit;
Client.prototype.emit = function patchedEmit(eventName, ...args) {
  const interaction = args[0];

  if (
    eventName === Events.InteractionCreate
    && interaction?.isChatInputCommand?.()
    && interaction.commandName === 'ticket'
    && !interaction.deferred
    && !interaction.replied
  ) {
    const originalReply = interaction.reply.bind(interaction);

    return interaction.deferReply({ flags: MessageFlags.Ephemeral })
      .then(() => {
        interaction.reply = options => {
          if (typeof options === 'string') return interaction.editReply(options);

          const editedOptions = { ...options };
          delete editedOptions.flags;
          delete editedOptions.ephemeral;
          delete editedOptions.withResponse;
          return interaction.editReply(editedOptions);
        };

        return originalEmit.call(this, eventName, ...args);
      })
      .catch(error => {
        console.error('[DISCORD] Ticket-Interaktion konnte nicht bestätigt werden:', error);
        interaction.reply = originalReply;
        return false;
      });
  }

  return originalEmit.call(this, eventName, ...args);
};

/* Zusätzlicher Schutz: Ein einzelner Discord-Fehler darf den Bot nicht beenden. */
process.on('unhandledRejection', error => {
  console.error('[PROCESS] Unbehandelte Promise-Ablehnung:', error);
});

require('./bot/src/app.js');
