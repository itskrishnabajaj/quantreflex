/**
 * server.js — QuantReflex PWA static file server (development only).
 *
 * All API logic has been moved to /backend/server.js.
 * This file only serves the frontend static files for local development/testing.
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(function (req, res, next) {
  var p = req.path.toLowerCase();
  /* Security: block access to server files, configs, and sensitive paths. */
  if (p === '/server.js' || p === '/services' || p.startsWith('/services/') ||
      p === '/backend' || p.startsWith('/backend/') ||
      p === '/package.json' || p === '/package-lock.json' ||
      p.endsWith('.md') ||
      p.startsWith('/.local/') || p.startsWith('/node_modules/') ||
      p === '/.env' || p.startsWith('/.env.') ||
      p === '/.gitignore' || p.startsWith('/.git/') || p === '/.git' ||
      p === '/firebase.json' || p === '/firestore.rules' || p === '/firestore.indexes.json' ||
      p === '/.firebaserc') {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html',
  dotfiles: 'allow'
}));

app.get('/{*splat}', function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', function () {
  console.log('QuantReflex frontend dev server running on port ' + PORT);
});
