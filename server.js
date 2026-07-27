'use strict';

const path = require('node:path');
require('dotenv').config({
  path: path.join(__dirname, 'bot', '.env'),
});

require('./bot/src/app.js');
