// Tiny JSON settings store kept in the app's user-data folder.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  wander: true, // float around on his own
  roam: 'bottom', // bottom | anywhere
  bubbles: true, // show speech bubbles
  startAtLogin: false,
  skin: 'classic', // classic | neon | retro | midnight
  glow: 'blue', // blue | cyan | pink | green | amber | purple
  antenna: 'tubes', // tubes | bulbs
  stickers: true,
  ambient: true, // soft light around Pip
  size: 'medium', // small | medium | large
};

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(prefs) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(prefs, null, 2));
  } catch (err) {
    console.error('Could not save Pip settings:', err);
  }
}

module.exports = { load, save, DEFAULTS };
