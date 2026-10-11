/* Pendule autonome (sans partie d'échecs) : deux zones tactiles face à face + bandeau central. */
(function () {
  'use strict';
  var clock = null, tc = null, state = 'ready', timer = null;   // state : ready | run | pause | over
  var lastWarn = { w: -1, b: -1 };
  var scr, zone = {}, ptime = {}, psub = {}, bPause, bFs, bQuit, form, soundBox, pauseIcon = '';

  function build() {
    scr = U.$('scr-pendule');
    zone.w = U.$('pz-w'); zone.b = U.$('pz-b');
    ptime.w = U.$('pt-w'); ptime.b = U.$('pt-b');
    psub.w = U.$('ps-w'); psub.b = U.$('ps-b');
    bPause = U.$('pb-pause'); bFs = U.$('pb-fs'); bQuit = U.$('pb-quit');
    bQuit.innerHTML = U.icon('close');
    paintFsIcon();
    U.on(zone.w, 'click', function () { tapZone('w'); });
    U.on(zone.b, 'click', function () { tapZone('b'); });
    U.on(bPause, 'click', function () { pause(); });
    U.on(bFs, 'click', function () { U.fs.toggle(); setTimeout(paintFsIcon, 150); });
    U.on(bQuit, 'click', function () { quitConfirm(); });
    U.fs.listen(paintFsIcon);
    form = new TimeForm(U.$('pd-tf'), { key: 'tc-pendule' });
    soundBox = U.soundControl(U.$('pd-sound'));
    U.on(U.$('pd-start'), 'click', function () { open(form.get()); });
  }

  function paintFsIcon() {
    if (bFs) bFs.innerHTML = U.icon(U.fs.active() ? 'compress' : 'expand');
  }

  function open(cfg) {
    tc = cfg;
    reset();
    App.show('pendule');
    App.setLive(true);
    U.fs.enter();
    U.wake.on();
    clearInterval(timer);
    timer = setInterval(tick, 100);
  }

  function reset() {
    clock = new ChessClock(tc);
    state = 'ready';
    lastWarn = { w: -1, b: -1 };
    render();
  }

  function leave() {
    clearInterval(timer);
    timer = null;
    U.closeDialog();
    U.fs.exit();
    U.wake.off();
    App.setLive(false);
    App.show('home');
  }

  function tapZone(c) {
    if (state === 'ready') {
      if (c !== 'w') return;               // les Blancs démarrent la pendule
      clock.start('w');
      state = 'run';
    } else if (state === 'run') {
      if (clock.active !== c) return;      // seul le joueur dont c'est le tour peut appuyer
      if (clock.check()) { onFlag(); return; }
      clock.press();
    } else return;
    U.fx('tap');
    render();
  }

  function onFlag() {
    state = 'over';
    U.fx('flag');
    render();
    var loser = clock.flagged;
    U.dialog({
      title: 'Temps écoulé',
      text: 'Le temps des ' + U.colorName(loser) + ' est écoulé.',
      buttons: [
        { label: 'Quitter', fn: function () { leave(); } },
        { label: 'Rejouer', primary: true, fn: function () { reset(); } }
      ]
    });
  }

  function pause() {
    if (state === 'pause' || state === 'over') return;
    var wasRun = state === 'run';
    if (wasRun) { clock.pause(); state = 'pause'; render(); }
    var node = U.el('div');
    node.appendChild(U.el('h3', null, 'Alertes'));
    var sc = U.el('div');
    node.appendChild(sc);
    U.soundControl(sc);
    U.dialog({
      title: wasRun ? 'Pause' : 'Réglages',
      node: node,
      buttons: [
        { label: 'Réinitialiser', fn: function () {
          U.confirm('Réinitialiser ?', 'Les temps repartent de zéro.', 'Réinitialiser', 'Annuler',
            function () { reset(); }, function () { resume(wasRun); }, true);
        } },
        { label: wasRun ? 'Reprendre' : 'Fermer', primary: true, fn: function () { resume(wasRun); } }
      ]
    });
  }

  function resume(wasRun) {
    if (wasRun && state === 'pause') { clock.resume(); state = 'run'; U.fx('tap'); }
    render();
  }

  function quitConfirm() {
    if (state === 'ready' || state === 'over') { leave(); return; }
    var wasRun = state === 'run';
    if (wasRun) { clock.pause(); state = 'pause'; render(); }
    U.dialog({
      title: 'Quitter la pendule ?',
      text: 'La partie en cours sera perdue.',
      buttons: [
        { label: 'Continuer', primary: true, fn: function () { resume(wasRun); } },
        { label: 'Quitter', danger: true, fn: function () { leave(); } }
      ]
    });
  }

  function tick() {
    if (state === 'run') {
      if (clock.check()) { onFlag(); return; }
      var c = clock.active, ms = clock.get(c);
      if (ms < 10000) {
        var sec = Math.ceil(ms / 1000);
        if (sec !== lastWarn[c]) { lastWarn[c] = sec; U.fx('warn'); }
      }
    }
    render();
  }

  function render() {
    var vp = U.viewport(), texts = { w: U.fmtClock(clock.get('w')), b: U.fmtClock(clock.get('b')) };
    var len = Math.max(texts.w.length, texts.b.length);
    var zoneH = (vp.h - 96) / 2;
    var fs = Math.floor(Math.min(zoneH * 0.4, vp.w * 0.92 / (len * 0.62)));
    ['w', 'b'].forEach(function (c) {
      ptime[c].textContent = texts[c];
      ptime[c].style.fontSize = fs + 'px';
      var active = (state === 'run' || state === 'pause') && clock.active === c;
      var flagged = clock.flagged === c;
      zone[c].className = 'pzone ' + (c === 'w' ? 'white' : 'black') + (active ? ' active' : '') + (flagged ? ' flagged' : '');
      var sub = 'Coups : ' + clock.moves[c];
      if (state === 'ready' && c === 'w') sub = 'Touchez pour démarrer';
      else if (state === 'ready') sub = '';
      else if (state === 'over' && flagged) sub = 'Temps écoulé';
      else if (state === 'pause' && active) sub = 'Pause';
      psub[c].textContent = sub;
    });
    var turn = state === 'ready' ? 'w' : (clock.active || 'w');
    U.removeClass(scr, 'turn-w');
    U.removeClass(scr, 'turn-b');
    U.addClass(scr, 'turn-' + turn);
    // On ne recrée l'icône que si elle change : remplacer le DOM sous le doigt annule le tap sur iOS
    var icon = state === 'pause' ? 'play' : 'pause';
    if (icon !== pauseIcon) { bPause.innerHTML = U.icon(icon); pauseIcon = icon; }
  }

  window.Pendule = { init: build, open: open, quitConfirm: quitConfirm, isLive: function () { return !!timer; } };
})();
