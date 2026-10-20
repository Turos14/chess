/* Partie d'échecs locale (deux joueurs, un seul appareil, sans IA). */
(function () {
  'use strict';
  var form, viewSeg, faceBox, eloBox, eloStartW, eloStartB, c960Box, cfgSaved;

  function init() {
    cfgSaved = U.store.get('local-cfg', { w: '', b: '', view: 'white', face: false, elo: true });
    U.$('lc-w').value = cfgSaved.w; U.$('lc-b').value = cfgSaved.b;
    eloBox = U.checkbox('Comptabiliser cette partie pour le classement Elo (noms différents requis)', cfgSaved.elo !== false);
    U.$('lc-elo').appendChild(eloBox);
    eloStartW = EloView.startField(U.$('lc-w'), 'Elo Blancs (' + Elo.DEFAULT_RATING + ')');
    eloStartB = EloView.startField(U.$('lc-b'), 'Elo Noirs (' + Elo.DEFAULT_RATING + ')');
    U.$('lc-elo-start').appendChild(eloStartW.el);
    U.$('lc-elo-start').appendChild(eloStartB.el);
    form = new TimeForm(U.$('lc-tf'), { key: 'tc-local', allowNone: true, defaults: { on: false } });
    viewSeg = U.segmented(U.$('lc-view'), [
      { v: 'white', label: 'Blancs en bas' }, { v: 'black', label: 'Noirs en bas' }, { v: 'auto', label: 'Alternée' }
    ], cfgSaved.view);
    faceBox = U.checkbox('Face à face : pièces du joueur du haut inversées (appareil posé à plat entre les joueurs)', cfgSaved.face);
    U.$('lc-face').appendChild(faceBox);
    c960Box = U.checkbox(Chess.LABEL_960, !!cfgSaved.c960);
    U.$('lc-960').appendChild(c960Box);
    U.soundControl(U.$('lc-sound'));
    U.on(U.$('lc-start'), 'click', function () {
      var cfg = {
        names: { w: U.$('lc-w').value.replace(/^\s+|\s+$/g, '') || 'Blancs', b: U.$('lc-b').value.replace(/^\s+|\s+$/g, '') || 'Noirs' },
        tc: form.get(), view: viewSeg.get(), face: faceBox.input.checked, elo: eloBox.input.checked,
        startW: eloStartW.get(), startB: eloStartB.get(), c960: c960Box.input.checked
      };
      U.store.set('local-cfg', { w: U.$('lc-w').value, b: U.$('lc-b').value, view: cfg.view, face: cfg.face, elo: cfg.elo, c960: cfg.c960 });
      start(cfg);
    });
  }

  function start(cfg) {
    var game = new Chess.Game(cfg.c960 ? Chess.start960() : null);
    var clock = cfg.tc.enabled ? new ChessClock(cfg.tc) : null;
    var over = null, paused = false;

    function finish(result, reason, winner) {
      over = { over: true, result: result, reason: reason, winner: winner };
      if (clock) clock.pause();
      GameView.refresh();
    }
    function flag(color) { finish(color === 'w' ? '0-1' : '1-0', 'timeout', Chess.other(color)); }

    var ctrl = {
      mode: 'local', game: game, clock: clock, names: cfg.names,
      view: { mode: cfg.view, faceToFace: cfg.face },
      pausable: !!clock,
      canMove: function (color) { return !over && !paused && !game.status().over && game.turn() === color; },
      attemptMove: function (from, to, promo) {
        if (clock && clock.check()) { flag(clock.flagged); return; }
        var rec = game.move(from, to, promo);
        if (!rec) return;
        U.fx('move');
        if (clock) {
          if (game.history.length === 1) clock.start('b');   // la pendule démarre au premier coup des Blancs
          else clock.press();
        }
        if (game.status().over && clock) clock.pause();
      },
      getResult: function () {
        if (over) return over;
        var st = game.status();
        return st.over ? st : null;
      },
      onClockTick: function () {
        if (clock && !over) { var f = clock.check(); if (f) flag(f); }
      },
      trackElo: function () { return cfg.elo; },
      eloStart: function () { return { w: cfg.startW, b: cfg.startB }; },
      head: function () {
        return 'Partie locale' + (game.chess960 ? ' · Fischer 960' : '') + ' · ' + TimeForm.describe(cfg.tc) + (paused ? ' · PAUSE' : '');
      },
      status: function (color) {
        var res = ctrl.getResult();
        if (res) return res.winner === color ? 'Vainqueur' : (res.winner ? '' : 'Nulle');
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
          title: 'Pause', node: node, opaque: true,
          buttons: [
            { label: 'Reprendre', primary: true, fn: function () { paused = false; clock.resume(); U.fx('tap'); GameView.refresh(); } }
          ]
        });
      },
      menuItems: function () {
        var items = [];
        if (!ctrl.getResult()) {
          items.push({ label: 'Abandonner', fn: function () {
            U.dialog({
              title: 'Qui abandonne ?',
              buttons: [
                { label: 'Blancs', danger: true, fn: function () { finish('0-1', 'resign', 'b'); } },
                { label: 'Noirs', danger: true, fn: function () { finish('1-0', 'resign', 'w'); } },
                { label: 'Annuler' }
              ]
            });
          } });
          items.push({ label: 'Proposer nulle', fn: function () {
            U.confirm('Partie nulle ?', 'Les deux joueurs sont-ils d’accord pour la nulle ?', 'Oui, nulle', 'Non',
              function () { finish('1/2-1/2', 'agreement', null); });
          } });
        } else {
          items.push({ label: 'Nouvelle partie', fn: function () { start(cfg); } });
        }
        return items;
      },
      quit: function () { GameView.close(); App.show('home'); }
    };
    GameView.open(ctrl);
  }

  window.Local = { init: init, start: start };
})();
