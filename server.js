/* Serveur de fichiers statiques pour le développement local : `npm start` -> http://localhost:3000
 * (l'app est 100 % statique : en production, n'importe quel hébergeur de fichiers suffit). */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var PUBLIC = path.join(__dirname, 'public');
var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  var file = path.normalize(path.join(PUBLIC, pathname === '/' ? '/index.html' : pathname));
  if (file.indexOf(PUBLIC) !== 0) { res.writeHead(403); return res.end(); }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

if (require.main === module) {
  var port = parseInt(process.env.PORT, 10) || 3000;
  server.listen(port, function () { console.log('Échecs : http://localhost:' + port); });
}
module.exports = server;
