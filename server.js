'use strict';

const path = require('node:path');
require('dotenv').config({
  path: path.join(__dirname, 'bot', '.env'),
});

process.on('unhandledRejection', error => {
  console.error('[PROCESS] Unbehandelte Promise-Ablehnung:', error);
});

require('./bot/src/v0.6-addon.js');
require('./bot/src/app-v0.5.js');
