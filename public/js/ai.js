/* Partie contre l'IA (Stockfish, calibré approximativement sur l'Elo visé — voir engineStrength.js).
 * L'IA ne compte jamais pour le classement Elo (trackElo renvoie toujours false) : la note du joueur sert
 * seulement à régler la force du moteur, dans un seul sens, elle n'est jamais modifiée par ces parties. */
(function () {
  'use strict';
  var form, colorSeg, eloInput, nameInput, c960Box, cfgSaved;

  function init() {
    cfgSaved = U.store.get('ai-cfg', { name: '', color: 'w' });
    nameInput = U.$('ai-name');
    nameInput.value = cfgSaved.name;
    eloInput = U.$('ai-elo');

    function prefill() {
      var n = nameInput.value.replace(/^\s+|\s+$/g, '');
      var p = n && Elo.player(U.store.get('elo', Elo.newDb()), n);
      eloInput.value = p ? p.rating : (eloInput.value || Elo.DEFAULT_RATING);
    }
    U.on(nameInput, 'blur', prefill);
    prefill();

    colorSeg = U.segmented(U.$('ai-color'), [
      { v: 'w', label: 'Blancs' }, { v: 'b', label: 'Noirs' }, { v: 'r', label: 'Au hasard' }
    ], cfgSaved.color || 'w');
    c960Box = U.checkbox(Chess.LABEL_960, !!cfgSaved.c960);
    U.$('ai-960').appendChild(c960Box);
    form = new TimeForm(U.$('ai-tf'), { key: 'tc-ai', allowNone: true, defaults: { on: false } });
    U.soundControl(U.$('ai-sound'));

    U.on(U.$('ai-start'), 'click', function () {
      if (!Engine.supported()) { U.toast('Ce navigateur ne permet pas de lancer l’IA (Web Worker indisponible).'); return; }
      var color = colorSeg.get();
      if (color === 'r') color = (Math.random() < 0.5) ? 'w' : 'b';
      var elo = Math.round(Number(eloInput.value));
      if (!isFinite(elo)) elo = Elo.DEFAULT_RATING;
      elo = Math.min(Elo.MAX_RATING, Math.max(Elo.MIN_RATING, elo));
      var cfg = { name: nameInput.value.replace(/^\s+|\s+$/g, '') || 'Vous', elo: elo, color: color, tc: form.get(), c960: c960Box.input.checked };
      U.store.set('ai-cfg', { name: cfg.name, color: colorSeg.get(), c960: cfg.c960 });
      start(cfg);
    });
  }

  function start(cfg) {
    var game = new Chess.Game(cfg.c960 ? Chess.start960() : null);
    var clock = cfg.tc.enabled ? new ChessClock(cfg.tc) : null;
    var over = null, paused = false, thinking = false, destroyed = false, engineHandle = null;
    var aiColor = Chess.other(cfg.color);
    var names = {};
    names[cfg.color] = cfg.name;
    names[aiColor] = 'IA (' + cfg.elo + ')';

    function finish(result, reason, winner) {
      if (over) return;
      over = { over: true, result: result, reason: reason, winner: winner };
      if (clock) clock.pause();
      GameView.refresh();
    }
    function flag(color) { finish(color === 'w' ? '0-1' : '1-0', 'timeout', Chess.other(color)); }
    function afterMove() {
      if (clock) { if (game.history.length === 1) clock.start('b'); else clock.press(); }
      if (game.status().over && clock) clock.pause();
    }

    var ctrl = {
      mode: 'ai', game: game, clock: clock, names: names,
      view: { mode: cfg.color === 'b' ? 'black' : 'white', faceToFace: false },
      pausable: !!clock,
      canMove: function (color) { return !over && !paused && !thinking && color === cfg.color && !game.status().over && game.turn() === color; },
      attemptMove: function (from, to, promo) {
        if (!ctrl.canMove(game.turn())) return;
        if (clock && clock.check()) { flag(clock.flagged); return; }
        var rec = game.move(from, to, promo);
        if (!rec) return;
        U.fx('move');
        afterMove();
        GameView.refresh();
        if (!game.status().over) askEngine();
      },
      getResult: function () {
        if (over) return over;
        var st = game.status();
        return st.over ? st : null;
      },
      onClockTick: function () {
        if (clock && !over) { var f = clock.check(); if (f) flag(f); }
      },
      trackElo: function () { return false; },
      head: function () {
        var s = 'Contre l’IA (' + cfg.elo + ')' + (cfg.c960 ? ' · Fischer 960' : '') + ' · ' + TimeForm.describe(cfg.tc) + (paused ? ' · PAUSE' : '');
        return thinking ? s + ' · l’IA réfléchit…' : s;
      },
      status: function (color) {
        var res = ctrl.getResult();
        if (res) return res.winner === color ? 'Vainqueur' : (res.winner ? '' : 'Nulle');
        if (color === aiColor && thinking) return 'Réflexion…';
        if (game.turn() !== color) return '';
        return game.inCheck() ? 'Échec !' : 'À jouer';
      },
      onPause: function () {
        if (!clock || !clock.running) { U.toast('La pendule démarre au premier coup des Blancs'); return; }
        clock.pause(); paused = true; GameView.refresh();
        var node = U.el('div'), sc = U.el('div');
        node.appendChild(U.el('h3', null, 'Alertes'));
        node.appendChild(sc);
        U.soundControl(sc);
        U.dialog({
          title: 'Pause', node: node,
          buttons: [{ label: 'Reprendre', primary: true, fn: function () { paused = false; clock.resume(); U.fx('tap'); GameView.refresh(); } }]
        });
      },
      menuItems: function () {
        var items = [];
        items.push({ label: 'Niveau de l’IA (' + cfg.elo + ')', fn: function () { changeElo(); } });
        if (!ctrl.getResult()) {
          items.push({ label: 'Abandonner', danger: true, fn: function () {
            U.confirm('Abandonner ?', 'Tu perdras la partie contre l’IA.', 'Abandonner', 'Annuler',
              function () { finish(cfg.color === 'w' ? '0-1' : '1-0', 'resign', aiColor); });
          } });
        } else {
          items.push({ label: 'Nouvelle partie', fn: function () { destroyEngine(); start(cfg); } });
        }
        return items;
      },
      quit: function () { destroyEngine(); GameView.close(); App.show('home'); }
    };

    // Change le niveau de l'IA en cours de partie : s'applique à partir du prochain coup qu'elle joue.
    function changeElo() {
      var node = U.el('div');
      var input = U.el('input', 'num');
      input.type = 'number'; input.min = Elo.MIN_RATING; input.max = Elo.MAX_RATING;
      input.value = cfg.elo; input.style.width = '100%'; input.setAttribute('inputmode', 'numeric');
      node.appendChild(input);
      node.appendChild(U.el('p', 'hint', 'S’applique au prochain coup de l’IA.'));
      U.dialog({
        title: 'Niveau de l’IA', node: node,
        buttons: [
          { label: 'Annuler' },
          { label: 'Valider', primary: true, fn: function () {
            var v = Math.round(Number(input.value));
            if (!isFinite(v)) return;
            cfg.elo = Math.min(Elo.MAX_RATING, Math.max(Elo.MIN_RATING, v));
            names[aiColor] = 'IA (' + cfg.elo + ')';
            if (engineHandle) engineHandle.setStrength(cfg.elo);
            GameView.refresh();
            U.toast('Niveau de l’IA : ' + cfg.elo);
          } }
        ]
      });
    }

    function destroyEngine() {
      destroyed = true;
      if (engineHandle) { engineHandle.destroy(); engineHandle = null; }
    }

    function askEngine() {
      if (destroyed || over || game.turn() !== aiColor) return;
      thinking = true;
      GameView.refresh();
      function go() {
        engineHandle.bestMove(game.fen(), function (mv) {
          if (destroyed || over) return;
          thinking = false;
          if (!mv) { U.toast('L’IA n’a pas pu trouver de coup.'); GameView.refresh(); return; }
          if (clock && clock.check()) { flag(clock.flagged); return; }
          var rec = game.move(mv.from, mv.to, mv.promo);
          if (!rec) { U.toast('Coup de l’IA refusé (incohérence du moteur).'); GameView.refresh(); return; }
          U.fx('move');
          afterMove();
          GameView.refresh();
        });
      }
      if (engineHandle) { go(); return; }
      Engine.create(function (err, h) {
        if (destroyed) { if (h) h.destroy(); return; }
        if (err) { thinking = false; U.toast(err.message); GameView.refresh(); return; }
        engineHandle = h;
        h.setStrength(cfg.elo);
        go();
      });
    }

    GameView.open(ctrl);
    if (game.turn() === aiColor) askEngine();   // l'IA a les Blancs : premier coup automatique
  }

  window.AI = { init: init, start: start };
})();
