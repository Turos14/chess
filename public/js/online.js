/* Partie en ligne pair-à-pair : créer / rejoindre avec un code, jouer ou regarder (spectateur).
 * Réseau : net.js (WebRTC/PeerJS, l'hôte peut être remplacé), règles et pendule : room.js (côté hôte). */
(function () {
  'use strict';
  var form, colorSeg, eloStart, c960Box, active = null;

  function setError(msg) { U.$('on-error').textContent = msg || ''; }
  function myName() { return U.$('on-name').value.replace(/^\s+|\s+$/g, ''); }
  function myCid() {
    var c = U.store.get('cid', null);
    if (!c) { c = Net.newId(); U.store.set('cid', c); }
    return c;
  }

  function init() {
    U.$('on-name').value = U.store.get('online-name', '');
    colorSeg = U.segmented(U.$('on-color'), [
      { v: 'w', label: 'Blancs' }, { v: 'b', label: 'Noirs' }, { v: 'r', label: 'Au hasard' }
    ], U.store.get('online-color', 'r'));
    c960Box = U.checkbox(Chess.LABEL_960, !!U.store.get('online-960', false));
    U.$('on-960').appendChild(c960Box);
    form = new TimeForm(U.$('on-tf'), { key: 'tc-online', allowNone: true, defaults: { on: true, wMin: 10 } });
    var eloBox = U.checkbox('Enregistrer mes parties pour le classement Elo (noms différents requis)', U.store.get('online-elo', true), function (v) { U.store.set('online-elo', v); });
    U.$('on-elo').appendChild(eloBox);
    eloStart = EloView.startField(U.$('on-name'), 'Mon Elo (' + Elo.DEFAULT_RATING + ')');
    U.$('on-elo-start').appendChild(eloStart.el);
    U.on(U.$('on-code'), 'input', function () {
      var v = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v !== this.value) this.value = v;
    });
    U.on(U.$('on-create'), 'click', create);
    U.on(U.$('on-join'), 'click', function () { join('player'); });
    U.on(U.$('on-watch'), 'click', function () { join('spectator'); });
    refreshResume();
    checkSupport();
  }

  function checkSupport() {
    var box = U.$('on-status');
    if (Net.supported()) { box.className = 'hint center'; box.textContent = 'Parties en direct entre appareils (WebRTC). Si l’hôte quitte, un autre joueur prend le relais.'; }
    else { box.className = 'error'; box.textContent = 'Ce navigateur ne gère pas WebRTC : le mode en ligne est indisponible.'; }
  }

  function saveName() { U.store.set('online-name', myName()); }

  function busy(on) {
    ['on-create', 'on-join', 'on-watch'].forEach(function (id) { U.$(id).disabled = on; });
  }

  function begin(sess, mode) {
    if (!Net.supported()) { setError('Ce navigateur ne gère pas WebRTC.'); return; }
    setError(''); busy(true);
    U.fs.enter();                                   // dans le geste de l'utilisateur (nécessaire pour le plein écran)
    Net.loadLib(function (err) {
      if (err) { busy(false); U.fs.exit(); setError(err.message); return; }
      start(sess, mode);
    });
  }

  function create() {
    saveName();
    var tc = form.get();
    U.store.set('online-color', colorSeg.get());
    U.store.set('online-960', c960Box.input.checked);
    begin({ code: Net.newCode(), name: myName() || 'Joueur', role: 'player', color: colorSeg.get(), tc: tc.enabled ? { base: tc.w.base, inc: tc.w.inc } : null, startElo: eloStart.get(), startFen: c960Box.input.checked ? Chess.start960() : null }, 'create');
  }

  function join(role) {
    saveName();
    var code = U.$('on-code').value;
    if (code.length < 4) { setError('Entre le code de la partie.'); return; }
    begin({ code: code, name: myName() || (role === 'player' ? 'Joueur' : 'Spectateur'), role: role, color: null, startElo: eloStart.get() }, 'join');
  }

  function refreshResume() {
    var box = U.$('on-resume'), s = U.store.get('online-session', null);
    U.clear(box);
    if (!s) return;
    var wrap = U.el('div', 'resume');
    wrap.appendChild(U.el('div', null, 'Partie en cours : ' + s.code + (s.role === 'spectator' ? ' (spectateur)' : '')));
    var row = U.el('div', 'btnrow');
    row.appendChild(U.button('Oublier', 'btn', function () { U.store.remove('online-session'); refreshResume(); }));
    row.appendChild(U.button('Reprendre', 'btn primary', function () { begin(s, 'resume'); }));
    wrap.appendChild(row);
    box.appendChild(wrap);
  }

  function showCode(code) {
    var node = U.el('div');
    node.appendChild(U.el('div', 'bigcode', code));
    node.appendChild(U.el('p', 'hint center', 'Donne ce code à ton adversaire (ou à des spectateurs) : ils le saisissent dans « Rejoindre une partie ». Reste connecté tant que la partie n’a pas commencé.'));
    var buttons = [{ label: 'Fermer', primary: true }];
    buttons.unshift({ label: 'Copier', keep: true, fn: function () { U.copy(code, function (ok) { U.toast(ok ? 'Code copié' : 'Copie impossible'); }); } });
    if (navigator.share) buttons.splice(1, 0, { label: 'Partager', keep: true, fn: function () {
      try { navigator.share({ title: 'Partie d’échecs', text: 'Rejoins ma partie d’échecs avec le code ' + code }); } catch (e) { /* ignore */ }
    } });
    U.dialog({ title: 'Code de la partie', node: node, buttons: buttons });
  }

  /* ---------- Session de jeu ---------- */
  function start(sess, mode) {
    if (active) active.stop();
    var cid = myCid();
    var game = new Chess.Game(), st = null, clock = null, session = null;
    var opened = false, alive = true, connErr = null, myColor = null, curEpoch = -1, lastV = -1;
    var seenDeclined = null, offerPrompt = false, announced = false;

    var ctrl = {
      mode: 'online', myColor: null, game: game, clock: null,
      names: { w: 'Connexion…', b: 'Connexion…' },
      view: { mode: 'white', faceToFace: false },
      pausable: false,
      quitText: 'Tu pourras reprendre la partie depuis l’écran « Partie en ligne ».',
      canMove: function (color) {
        return alive && !!myColor && color === myColor && ctrl.game.turn() === myColor && !ctrl.getResult() &&
          !!st && !!st.players.w && !!st.players.b && !connErr;
      },
      attemptMove: function (from, to, promo) {
        var g = ctrl.game;
        if (!ctrl.canMove(g.turn())) return;
        var rec = g.move(from, to, promo);
        if (!rec) return;
        U.fx('move');
        if (!session.send({ t: 'move', from: rec.from, to: rec.to, promo: rec.promo })) { U.toast('Connexion perdue'); rebuild(); }
      },
      getResult: function () { return st && st.status.over ? st.status : null; },
      trackElo: function () { return !!myColor && U.store.get('online-elo', true); },
      // Vient de l'état synchronisé de la salle (pas seulement de "sess") pour qu'hôte et invité calculent
      // le même Elo de départ pour chacun — sinon chaque appareil devinerait la note de l'autre à sa place.
      eloStart: function () { return st ? st.eloStart : null; },
      head: function () {
        var s = 'Code ' + (session ? session.code : sess.code);
        if (ctrl.mode === 'spectator') s = 'Spectateur · ' + s;
        if (connErr) return s + ' · reconnexion…';
        if (st) {
          if (!st.players.w || !st.players.b) s += ' · en attente d’un adversaire';
          else if (st.tc) s += ' · ' + TimeForm.describe({ w: st.tc, b: st.tc });
          if (ctrl.game.chess960) s += ' · Fischer 960';
          if (st.spectators) s += ' · ' + st.spectators + ' spectateur' + (st.spectators > 1 ? 's' : '');
          if (st.drawOffer && st.drawOffer === myColor) s += ' · nulle proposée';
        }
        if (session && session.isHost()) s += ' · hôte';
        return s;
      },
      status: function (color) {
        if (!st) return '';
        var res = ctrl.getResult();
        if (res) return res.winner === color ? 'Vainqueur' : (res.winner ? '' : 'Nulle');
        if (st.players[color] && !st.connected[color]) return 'Déconnecté';
        if (!st.players[color]) return '';
        if (ctrl.game.turn() !== color) return '';
        return ctrl.game.inCheck() ? 'Échec !' : 'À jouer';
      },
      menuItems: function () {
        var items = [{ label: 'Code de la partie', fn: function () { showCode(session.code); } }];
        if (myColor && !ctrl.getResult() && st && st.players.w && st.players.b) {
          items.push({ label: 'Abandonner', fn: function () {
            U.confirm('Abandonner ?', 'Tu perdras la partie.', 'Abandonner', 'Annuler', function () { send({ t: 'resign' }); }, null, true);
          } });
          items.push({ label: st.drawOffer === myColor ? 'Nulle déjà proposée' : 'Proposer nulle', fn: function () {
            if (st.drawOffer === myColor) return;
            if (send({ t: 'draw', action: 'offer' })) U.toast('Nulle proposée');
          } });
        }
        return items;
      },
      quit: function () {
        var over = !!ctrl.getResult(), spectator = ctrl.mode === 'spectator';
        stop();
        if (spectator || over) U.store.remove('online-session');
        GameView.close();
        App.show('online');
        refreshResume();
      }
    };

    function send(msg) {
      if (session && session.send(msg)) return true;
      U.toast('Connexion perdue');
      return false;
    }

    function rebuild() {
      if (!st) return;
      var g = Chess.replay(st.startFen || Chess.START, st.moves);
      if (g) ctrl.game = g;
      GameView.refresh();
    }

    function sameMoves(list) {
      var h = ctrl.game.history, i;
      if (list.length < h.length) return false;
      for (i = 0; i < h.length; i++) if (h[i].from !== list[i].from || h[i].to !== list[i].to) return false;
      return true;
    }

    function ensureOpen() {
      if (opened) return;
      opened = true;
      busyOff();
      GameView.open(ctrl);
      if (mode === 'create') showCode(session.code);
    }
    function busyOff() { busy(false); }

    function apply(s) {
      if (!alive) return;
      if (s.epoch < curEpoch || (s.epoch === curEpoch && s.v < lastV)) return;
      curEpoch = s.epoch; lastV = s.v;
      myColor = s.you;
      var first = !st;
      ctrl.myColor = myColor;
      ctrl.mode = myColor ? 'online' : 'spectator';
      if (first) ctrl.view.mode = myColor === 'b' ? 'black' : 'white';
      connErr = null;
      ensureOpen();
      var oldN = ctrl.game.history.length, i;
      // La position de départ (Fischer 960) n'est connue qu'avec le 1er état reçu de l'hôte.
      if (!sameMoves(s.moves) || ctrl.game.startFen !== new Chess.Game(s.startFen || null).startFen) {
        var g = Chess.replay(s.startFen || Chess.START, s.moves);
        if (g) ctrl.game = g;
      } else {
        for (i = ctrl.game.history.length; i < s.moves.length; i++) ctrl.game.move(s.moves[i].from, s.moves[i].to, s.moves[i].promo);
      }
      if (st && ctrl.game.history.length > oldN) {
        var lm = ctrl.game.lastMove();
        if (lm && lm.piece.charAt(0) !== myColor) U.fx('move');
      }
      st = s;
      ctrl.names.w = s.players.w || 'En attente…';
      ctrl.names.b = s.players.b || 'En attente…';
      if (s.clock && s.tc) {
        if (!clock) {
          clock = new ChessClock({ w: { base: s.tc.base, inc: s.tc.inc }, b: { base: s.tc.base, inc: s.tc.inc } });
          ctrl.clock = clock;
        }
        clock.sync(s.clock);
      }
      if (seenDeclined === null) seenDeclined = s.declined;
      else if (s.declined > seenDeclined) { seenDeclined = s.declined; if (myColor) U.toast('Nulle refusée'); }
      offer(s);
      U.store.set('online-session', { code: session.code, cid: cid, name: sess.name, role: myColor ? 'player' : 'spectator', color: myColor, tc: s.tc, lastState: s, startElo: sess.startElo });
      GameView.refresh();
    }

    function offer(s) {
      var incoming = s.drawOffer && myColor && s.drawOffer !== myColor && !s.status.over;
      if (incoming && !offerPrompt) {
        offerPrompt = true;
        U.dialog({
          title: 'Nulle ?', text: 'Ton adversaire propose la partie nulle.',
          buttons: [
            { label: 'Refuser', fn: function () { offerPrompt = false; send({ t: 'draw', action: 'decline' }); } },
            { label: 'Accepter', primary: true, fn: function () { offerPrompt = false; send({ t: 'draw', action: 'accept' }); } }
          ],
          onclose: function () { offerPrompt = false; }
        });
      } else if (!incoming && offerPrompt) {
        offerPrompt = false;
        U.closeDialog();
      }
    }

    function failed(reason) {
      if (!opened) {                                  // échec avant l'ouverture de la partie
        stop();
        busy(false);
        U.fs.exit();
        setError(reason);
        return;
      }
      U.dialog({
        title: 'Connexion perdue', text: reason,
        buttons: [
          { label: 'Quitter', fn: function () { ctrl.quit(); } },
          { label: 'Réessayer', primary: true, fn: function () { connErr = 'retry'; session.retries = 0; session.lost = false; session.open('resume'); } }
        ]
      });
    }

    function stop() {
      alive = false;
      if (session) session.leave();
      active = null;
    }

    session = new Net.Session({
      code: sess.code, cid: cid, name: sess.name, role: sess.role, color: sess.color, tc: sess.tc || null,
      startElo: sess.startElo, mode: mode, lastState: sess.lastState || null,
      frozen: function () { return clock ? { w: clock.get('w'), b: clock.get('b') } : null; },
      on: {
        state: apply,
        error: function (msg) { U.toast(msg); },
        reject: function (msg) { if (!opened) { failed(msg); } else U.toast(msg); },
        status: function (e) {
          if (!alive) return;
          if (e.kind === 'reconnecting') { connErr = e.reason || 'reconnexion'; if (opened) GameView.refresh(); }
          else if (e.kind === 'failed') failed(e.reason);
          else if (e.kind === 'online' && opened) { connErr = null; GameView.refresh(); }
        }
      }
    });
    active = { stop: stop };
    session.open(mode);
  }

  window.Online = { init: init, refresh: function () { refreshResume(); checkSupport(); } };
})();
