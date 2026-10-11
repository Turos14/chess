/* Utilitaires communs : DOM, stockage, sons/vibrations, plein écran, dialogues. ES5 (anciens iOS / Android). */
(function () {
  'use strict';
  var U = window.U = {};

  /* ---------- DOM ---------- */
  U.$ = function (id) { return document.getElementById(id); };
  U.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  U.on = function (e, ev, fn) { e.addEventListener(ev, fn, false); };
  U.clear = function (e) { while (e.firstChild) e.removeChild(e.firstChild); };
  U.hasClass = function (e, c) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; };
  U.addClass = function (e, c) { if (!U.hasClass(e, c)) e.className = (e.className ? e.className + ' ' : '') + c; };
  U.removeClass = function (e, c) {
    e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  };
  U.toggleClass = function (e, c, on) { if (on) U.addClass(e, c); else U.removeClass(e, c); };
  U.button = function (label, cls, fn) {
    var b = U.el('button', cls || 'btn', label);
    b.type = 'button';
    if (fn) U.on(b, 'click', fn);
    return b;
  };
  U.viewport = function () {
    var de = document.documentElement;
    return { w: window.innerWidth || de.clientWidth, h: window.innerHeight || de.clientHeight };
  };

  /* Icônes SVG (symboles noirs) */
  var ICONS = {
    pause: '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    expand: '<path d="M4 9V4h5v2H6v3zM15 4h5v5h-2V6h-3zM20 15v5h-5v-2h3v-3zM9 20H4v-5h2v3h3z"/>',
    compress: '<path d="M9 4v5H4V7h3V4zM15 4h2v3h3v2h-5zM20 15v2h-3v3h-2v-5zM4 15h5v5H7v-3H4z"/>',
    close: '<path d="M5 7l2-2 5 5 5-5 2 2-5 5 5 5-2 2-5-5-5 5-2-2 5-5z"/>'
  };
  U.icon = function (name) {
    return '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#000" aria-hidden="true">' + ICONS[name] + '</svg>';
  };

  /* ---------- Stockage (localStorage, avec repli mémoire pour le mode privé iOS) ---------- */
  var mem = {};
  U.store = {
    get: function (k, def) {
      try {
        var v = window.localStorage.getItem('chess.' + k);
        if (v != null) return JSON.parse(v);
      } catch (e) { /* ignore */ }
      return mem.hasOwnProperty(k) ? mem[k] : def;
    },
    set: function (k, v) {
      mem[k] = v;
      try { window.localStorage.setItem('chess.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ }
    },
    remove: function (k) {
      delete mem[k];
      try { window.localStorage.removeItem('chess.' + k); } catch (e) { /* ignore */ }
    }
  };

  var DEFAULTS = { sound: 'sound', hints: true, coords: true };
  U.getSetting = function (k) {
    var s = U.store.get('settings', {});
    return s.hasOwnProperty(k) ? s[k] : DEFAULTS[k];
  };
  U.setSetting = function (k, v) {
    var s = U.store.get('settings', {});
    s[k] = v;
    U.store.set('settings', s);
  };

  /* ---------- Formats ---------- */
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  U.fmtClock = function (ms) {
    if (ms <= 0) return '0:00.0';
    if (ms < 10000) {
      var t = Math.floor(ms / 100);
      return '0:0' + Math.floor(t / 10) + '.' + (t % 10);
    }
    var total = Math.ceil(ms / 1000), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return h ? h + ':' + p2(m) + ':' + p2(s) : m + ':' + p2(s);
  };
  U.fmtDate = function (ts) {
    var d = new Date(ts);
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  };
  U.colorName = function (c) { return c === 'w' ? 'Blancs' : 'Noirs'; };

  /* ---------- Sons et vibrations ---------- */
  var actx = null;
  function audio() {
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (C) { try { actx = new C(); } catch (e) { actx = null; } }
    }
    return actx;
  }
  function beep(freq, dur, delay, vol, type) {
    var c = audio();
    if (!c) return;
    try {
      var t0 = c.currentTime + (delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  function unlock() {
    var c = audio();
    if (!c) return;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination);
      if (s.start) s.start(0); else s.noteOn(0);
    } catch (e) { /* ignore */ }
  }
  U.on(document, 'touchstart', unlock);
  U.on(document, 'click', unlock);

  U.canVibrate = !!(navigator.vibrate || navigator.webkitVibrate);
  function vibrate(p) {
    try { (navigator.vibrate || navigator.webkitVibrate).call(navigator, p); } catch (e) { /* ignore */ }
  }
  // kind : tap | move | warn | flag | end
  U.fx = function (kind) {
    var mode = U.getSetting('sound');
    if (mode === 'silent') return;
    if (mode === 'vibrate') {
      if (!U.canVibrate) return;
      vibrate({ tap: 40, move: 25, warn: 70, flag: [300, 120, 300, 120, 300], end: [200, 100, 200] }[kind]);
      return;
    }
    if (kind === 'tap') beep(880, 0.06, 0, 0.3, 'square');
    else if (kind === 'move') beep(330, 0.07, 0, 0.35, 'triangle');
    else if (kind === 'warn') beep(1000, 0.09, 0, 0.3, 'square');
    else if (kind === 'end') { beep(660, 0.15, 0, 0.3); beep(880, 0.25, 0.16, 0.3); }
    else if (kind === 'flag') { beep(440, 0.35, 0, 0.35, 'sawtooth'); beep(440, 0.35, 0.45, 0.35, 'sawtooth'); beep(330, 0.6, 0.9, 0.35, 'sawtooth'); }
  };

  /* ---------- Plein écran ---------- */
  var fsProps = ['fullscreenElement', 'webkitFullscreenElement', 'mozFullScreenElement', 'msFullscreenElement'];
  U.fs = {
    supported: function () {
      var e = document.documentElement;
      return !!(e.requestFullscreen || e.webkitRequestFullscreen || e.mozRequestFullScreen || e.msRequestFullscreen);
    },
    active: function () {
      for (var i = 0; i < fsProps.length; i++) if (document[fsProps[i]]) return true;
      return false;
    },
    enter: function () {
      var e = document.documentElement;
      var f = e.requestFullscreen || e.webkitRequestFullscreen || e.mozRequestFullScreen || e.msRequestFullscreen;
      if (!f) return;
      try {
        var p = f.call(e);
        if (p && p.catch) p.catch(function () { /* refusé */ });
      } catch (x) { /* ignore */ }
    },
    exit: function () {
      var f = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      if (!f || !U.fs.active()) return;
      try {
        var p = f.call(document);
        if (p && p.catch) p.catch(function () { /* ignore */ });
      } catch (x) { /* ignore */ }
    },
    toggle: function () {
      if (!U.fs.supported()) {
        U.dialog({
          title: 'Plein écran',
          text: 'Ce navigateur ne permet pas le plein écran. Sur iPhone / iPad : bouton Partager, puis « Sur l’écran d’accueil ». L’app s’ouvrira alors en plein écran.',
          buttons: [{ label: 'OK', primary: true }]
        });
        return;
      }
      if (U.fs.active()) U.fs.exit(); else U.fs.enter();
    },
    listen: function (fn) {
      var evs = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
      for (var i = 0; i < evs.length; i++) U.on(document, evs[i], fn);
    }
  };

  /* Empêche l'écran de s'éteindre pendant une partie (si supporté) */
  var wakeLock = null, wakeWanted = false;
  function requestWake() {
    if (!wakeWanted || !navigator.wakeLock || wakeLock) return;
    try {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { wakeLock = null; });
      }, function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }
  U.wake = {
    on: function () { wakeWanted = true; requestWake(); },
    off: function () {
      wakeWanted = false;
      if (wakeLock) { try { wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
    }
  };
  U.on(document, 'visibilitychange', function () { if (!document.hidden) requestWake(); });

  /* ---------- Réseau (XHR : compatible anciens navigateurs) ---------- */
  U.ajax = function (method, url, data, cb, timeoutMs) {
    var x = new XMLHttpRequest(), done = false, timer;
    function finish(err, res) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(err, res);
    }
    x.open(method, url, true);
    if (data) x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var json = null;
      try { json = JSON.parse(x.responseText); } catch (e) { /* ignore */ }
      if (x.status >= 200 && x.status < 300 && json) finish(null, json);
      else if (json && json.error) finish({ message: json.error, status: x.status }, json);
      else if (x.status === 0) finish({ message: 'Connexion impossible', status: 0, network: true });
      else finish({ message: 'Le serveur de jeu ne répond pas correctement (HTTP ' + x.status + '). L’application doit être lancée avec Node.js (npm start), pas seulement en fichiers statiques.', status: x.status, network: true, badServer: true });
    };
    x.onerror = function () { finish({ message: 'Connexion impossible', network: true }); };
    timer = setTimeout(function () {
      finish({ message: 'Délai dépassé', network: true });
      try { x.abort(); } catch (e) { /* ignore */ }
    }, timeoutMs || 15000);
    x.send(data ? JSON.stringify(data) : null);
    return { abort: function () { done = true; clearTimeout(timer); try { x.abort(); } catch (e) { /* ignore */ } } };
  };

  /* ---------- Dialogues ---------- */
  var current = null;
  // opts : {title, text, node, buttons:[{label, primary, danger, keep, fn}], opaque, vertical, onclose}
  U.dialog = function (opts) {
    if (current) current.close(true);
    var root = U.$('modal'), box = U.$('modal-box');
    U.clear(box);
    if (opts.title) box.appendChild(U.el('h2', 'mtitle', opts.title));
    if (opts.text) box.appendChild(U.el('p', 'mtext', opts.text));
    if (opts.node) box.appendChild(opts.node);
    var row = U.el('div', 'btnrow' + (opts.vertical ? ' vertical' : ''));
    var h = {
      close: function (silent) {
        if (current !== h) return;
        current = null;
        root.style.display = 'none';
        U.removeClass(root, 'show');
        U.clear(box);
        if (!silent && opts.onclose) opts.onclose();
      }
    };
    (opts.buttons || []).forEach(function (b) {
      var btn = U.button(b.label, 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), function () {
        if (!b.keep) h.close(true);
        if (b.fn) b.fn(h);
      });
      row.appendChild(btn);
    });
    if (row.firstChild) box.appendChild(row);
    root.className = opts.opaque ? 'opaque' : '';
    root.style.display = 'block';
    root.offsetHeight;        // force un reflow pour que la transition parte bien d'opacity 0
    U.addClass(root, 'show');
    current = h;
    return h;
  };
  U.closeDialog = function () { if (current) current.close(true); };
  U.dialogOpen = function () { return !!current; };
  U.confirm = function (title, text, yes, no, onYes, onNo, danger) {
    return U.dialog({
      title: title, text: text,
      buttons: [
        { label: no || 'Non', fn: onNo },
        { label: yes || 'Oui', primary: !danger, danger: !!danger, fn: onYes }
      ]
    });
  };

  var toastTimer = null, toastHideTimer = null;
  U.toast = function (text) {
    var t = U.$('toast');
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    t.textContent = text;
    U.removeClass(t, 'show');
    t.style.display = 'block';
    t.offsetHeight;          // force un reflow pour que la transition parte bien d'opacity 0
    U.addClass(t, 'show');
    toastTimer = setTimeout(function () {
      U.removeClass(t, 'show');
      toastHideTimer = setTimeout(function () { t.style.display = 'none'; }, 220);
    }, 2600);
  };

  /* ---------- Contrôles de formulaire ---------- */
  // Boutons segmentés : options [{v, label}]
  U.segmented = function (container, options, value, onchange) {
    U.clear(container);
    U.addClass(container, 'seg');
    var btns = [], cur = value;
    function paint() {
      for (var i = 0; i < btns.length; i++) U.toggleClass(btns[i].el, 'on', btns[i].v === cur);
    }
    options.forEach(function (o) {
      var b = U.button(o.label, 'segbtn', function () {
        cur = o.v; paint();
        if (onchange) onchange(cur);
      });
      btns.push({ el: b, v: o.v });
      container.appendChild(b);
    });
    paint();
    return { get: function () { return cur; }, set: function (v) { cur = v; paint(); } };
  };

  U.soundControl = function (container) {
    var seg = U.segmented(container, [
      { v: 'silent', label: 'Silencieux' },
      { v: 'vibrate', label: 'Vibreur' },
      { v: 'sound', label: 'Son' }
    ], U.getSetting('sound'), function (v) {
      U.setSetting('sound', v);
      U.fx('tap');
    });
    if (!U.canVibrate) {
      var note = U.el('div', 'hint', 'Le vibreur n’est pas disponible sur cet appareil (iPhone / iPad).');
      container.parentNode.insertBefore(note, container.nextSibling);
    }
    return seg;
  };

  U.checkbox = function (label, checked, onchange) {
    var lab = U.el('label', 'check');
    var cb = U.el('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    U.on(cb, 'change', function () { if (onchange) onchange(cb.checked); });
    lab.appendChild(cb);
    lab.appendChild(U.el('span', null, label));
    lab.input = cb;
    return lab;
  };

  U.copy = function (text, done) {
    function fallback() {
      var ta = U.el('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.left = '-1000px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  };
})();
