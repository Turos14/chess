/* Enveloppe navigateur autour du moteur Stockfish (public/vendor/stockfish.js, voir stockfish-README.txt) :
 * lancement en Web Worker, protocole UCI via postMessage. Calibration Elo -> réglages : engineStrength.js. */
(function () {
  'use strict';
  var Engine = {};
  var MOVE_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
  var UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/, PV_MAX = 10;

  Engine.supported = function () { return typeof window.Worker !== 'undefined'; };

  function Handle(worker) {
    this.worker = worker;
    this.params = EngineStrength.paramsFor(1200);
    this._onLine = null;
    this.destroyed = false;
  }

  // Ouvre le moteur et attend qu'il soit prêt (poignée de main UCI) avant d'appeler cb(err, handle).
  Engine.create = function (cb) {
    if (!Engine.supported()) { cb(new Error('Les Web Workers ne sont pas disponibles sur ce navigateur.')); return; }
    var worker;
    try { worker = new Worker('vendor/stockfish.js?v=6'); }
    catch (e) { cb(new Error('Impossible de charger le moteur d’échecs.')); return; }
    var h = new Handle(worker), done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      try { worker.terminate(); } catch (e) { /* ignore */ }
      cb(new Error('Le moteur d’échecs met trop de temps à démarrer.'));
    }, 15000);
    worker.onmessage = function (e) {
      var line = typeof e.data === 'string' ? e.data : '';
      if (!done && /\buciok\b/.test(line)) {
        done = true;
        clearTimeout(timer);
        cb(null, h);
        return;
      }
      if (h._onLine) h._onLine(line);
    };
    worker.onerror = function (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(new Error('Moteur d’échecs indisponible' + (e && e.message ? ' (' + e.message + ')' : '') + '.'));
    };
    worker.postMessage('uci');
  };

  // Calcule les réglages du moteur pour une note Elo visée (appelé une fois par partie).
  Handle.prototype.setStrength = function (elo) {
    this.params = EngineStrength.paramsFor(elo);
    this.worker.postMessage('setoption name Skill Level value ' + this.params.skill);
    this.worker.postMessage('setoption name MultiPV value ' + Math.max(1, this.params.randomTop));
    this.worker.postMessage('ucinewgame');
  };

  // fen : position actuelle à jouer. cb(move) : move = {from, to, promo} (promo en minuscule ou null), ou
  // cb(null) si le moteur n'a renvoyé aucun coup exploitable (ne devrait arriver qu'en cas d'erreur du moteur).
  Handle.prototype.bestMove = function (fen, cb) {
    if (this.destroyed) { cb(null); return; }
    var self = this, p = this.params, candidates = [], done = false;
    this._onLine = function (line) {
      if (done) return;
      var m;
      if (p.randomTop > 1 && (m = /^info .*\bmultipv (\d+)\b.*\bpv ([a-h][1-8][a-h][1-8][qrbn]?)\b/.exec(line))) {
        candidates[parseInt(m[1], 10) - 1] = m[2];
        return;
      }
      if ((m = /^bestmove ([a-h][1-8][a-h][1-8][qrbn]?)\b/.exec(line))) {
        done = true;
        self._onLine = null;
        var uci = m[1];
        if (p.randomTop > 1) {
          var pool = candidates.filter(function (c) { return c; });
          if (pool.length) uci = pool[Math.floor(Math.random() * Math.min(pool.length, p.randomTop))];
        }
        var mm = MOVE_RE.exec(uci);
        cb(mm ? { from: mm[1], to: mm[2], promo: mm[3] || null } : null);
      }
    };
    // Roques 960 : le moteur doit lire les droits de roque par colonne et annoncer « roi sur tour » (e1h1),
    // ce que Chess.Game.move accepte. Réglé à chaque coup d'après la FEN (une même poignée peut servir aux deux).
    this.worker.postMessage('setoption name UCI_Chess960 value ' + (Chess.is960(fen) ? 'true' : 'false'));
    this.worker.postMessage('position fen ' + fen);
    this.worker.postMessage('go movetime ' + EngineStrength.moveTime());
  };

  // Analyse à pleine force (Skill Level 20, une seule variante) : cb({cp | mate, best, pv}) du point de vue du camp au
  // trait, best = meilleur coup UCI, pv = variante principale (coups UCI, PV_MAX au plus) ; cb(null) si le moteur ne
  // renvoie rien d'exploitable. Sert à l'analyse de partie
  // (coach.js) ; setStrength doit être rappelé avant de rejouer contre la poignée.
  Handle.prototype.analyse = function (fen, ms, cb) {
    if (this.destroyed) { cb(null); return; }
    var self = this, score = null, done = false;
    this._onLine = function (line) {
      if (done) return;
      var m = /^info .*\bscore (cp|mate) (-?\d+)/.exec(line);
      if (m && !/\bmultipv [2-9]/.test(line) && !/\b(lower|upper)bound\b/.test(line)) {
        score = m[1] === 'cp' ? { cp: parseInt(m[2], 10) } : { mate: parseInt(m[2], 10) };
        var pv = /\bpv (.+)$/.exec(line);
        score.pv = pv ? pv[1].split(/\s+/).filter(function (u) { return UCI_RE.test(u); }).slice(0, PV_MAX) : [];
        return;
      }
      if ((m = /^bestmove (\S+)/.exec(line))) {
        done = true;
        self._onLine = null;
        if (!score) { cb(null); return; }
        score.best = UCI_RE.test(m[1]) ? m[1] : null;
        if (score.best && score.pv[0] !== score.best) score.pv = [score.best];
        cb(score);
      }
    };
    this.worker.postMessage('setoption name Skill Level value 20');
    this.worker.postMessage('setoption name MultiPV value 1');
    this.worker.postMessage('setoption name UCI_Chess960 value ' + (Chess.is960(fen) ? 'true' : 'false'));
    this.worker.postMessage('position fen ' + fen);
    this.worker.postMessage('go movetime ' + ms);
  };

  Handle.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    this._onLine = null;
    try { this.worker.postMessage('quit'); } catch (e) { /* ignore */ }
    try { this.worker.terminate(); } catch (e2) { /* ignore */ }
  };

  window.Engine = Engine;
})();
