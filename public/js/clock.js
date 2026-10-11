/* Modèle de pendule + formulaire de réglage du temps. */
(function () {
  'use strict';

  /* ---------- Modèle ---------- */
  // cfg : { w: {base, inc}, b: {base, inc} } en millisecondes
  function ChessClock(cfg) {
    this.cfg = cfg;
    this.rem = { w: cfg.w.base, b: cfg.b.base };
    this.active = null;
    this.running = false;
    this.since = 0;
    this.flagged = null;
    this.offset = 0;              // décalage horloge serveur (mode en ligne)
    this.moves = { w: 0, b: 0 };
  }
  ChessClock.prototype.now = function () { return new Date().getTime() + this.offset; };
  ChessClock.prototype.get = function (c) {
    if (this.running && this.active === c) return Math.max(0, this.rem[c] - (this.now() - this.since));
    return Math.max(0, this.rem[c]);
  };
  ChessClock.prototype.start = function (c) {
    this.active = c; this.since = this.now(); this.running = true;
  };
  // Le joueur actif a fini son tour : on lui ajoute l'incrément et l'autre joueur démarre.
  ChessClock.prototype.press = function () {
    if (!this.active) return;
    var mover = this.active;
    this.rem[mover] = this.get(mover) + this.cfg[mover].inc;
    this.moves[mover]++;
    this.active = mover === 'w' ? 'b' : 'w';
    this.since = this.now();
    this.running = true;
  };
  ChessClock.prototype.pause = function () {
    if (this.running) { this.rem[this.active] = this.get(this.active); this.running = false; }
  };
  ChessClock.prototype.resume = function () {
    if (!this.running && this.active && !this.flagged) { this.since = this.now(); this.running = true; }
  };
  // Retourne la couleur dont le temps vient de s'écouler (une seule fois), sinon null
  ChessClock.prototype.check = function () {
    if (this.running && !this.flagged && this.get(this.active) <= 0) {
      this.flagged = this.active;
      this.rem[this.active] = 0;
      this.running = false;
      return this.flagged;
    }
    return null;
  };
  // Synchronisation depuis le serveur : {w, b, turn, running, serverTime}
  ChessClock.prototype.sync = function (s) {
    this.offset = s.serverTime - new Date().getTime();
    this.rem.w = s.w; this.rem.b = s.b;
    this.active = s.turn;
    this.running = !!s.running;
    this.since = s.serverTime;
  };

  /* ---------- Formulaire ---------- */
  var PRESETS = [
    { label: '1 min', m: 1, i: 0 }, { label: '3 | 2', m: 3, i: 2 }, { label: '5 min', m: 5, i: 0 },
    { label: '10 min', m: 10, i: 0 }, { label: '15 | 10', m: 15, i: 10 }, { label: '30 min', m: 30, i: 0 },
    { label: '60 min', m: 60, i: 0 }
  ];

  function numInput(value, min, max, step) {
    var i = U.el('input', 'num');
    i.type = 'number';
    i.min = min; i.max = max; i.step = step || 1;
    i.value = value;
    i.setAttribute('inputmode', 'decimal');
    return i;
  }
  function num(input, def, min, max) {
    var v = parseFloat(String(input.value).replace(',', '.'));
    if (isNaN(v)) v = def;
    return Math.min(max, Math.max(min, v));
  }

  // opts : { key (stockage), allowNone, defaults }
  function TimeForm(container, opts) {
    var self = this;
    var st = U.store.get(opts.key, null) || { on: true, wMin: 10, wInc: 0, bMin: 10, bInc: 0, diff: false };
    if (opts.defaults && !U.store.get(opts.key, null)) { for (var k in opts.defaults) st[k] = opts.defaults[k]; }
    this.key = opts.key;
    U.clear(container);
    U.addClass(container, 'tf');

    var body = U.el('div', 'tfbody');
    var onBox = null;
    if (opts.allowNone) {
      onBox = U.checkbox('Utiliser une pendule', st.on, function (v) { st.on = v; paint(); save(); });
      container.appendChild(onBox);
    }
    container.appendChild(body);

    var chips = U.el('div', 'chips');
    PRESETS.forEach(function (p) {
      chips.appendChild(U.button(p.label, 'chip', function () {
        wMin.value = p.m; wInc.value = p.i; bMin.value = p.m; bInc.value = p.i;
        save();
      }));
    });
    body.appendChild(chips);

    var wMin = numInput(st.wMin, 0, 600, 'any'), wInc = numInput(st.wInc, 0, 300, 1);
    var bMin = numInput(st.bMin, 0, 600, 'any'), bInc = numInput(st.bInc, 0, 300, 1);
    var wLabel = U.el('span', 'tflabel', 'Chaque joueur');
    var bLabel = U.el('span', 'tflabel', 'Noirs');

    function row(label, m, i) {
      var r = U.el('div', 'tfrow');
      r.appendChild(label);
      r.appendChild(m);
      r.appendChild(U.el('span', 'unit', 'min +'));
      r.appendChild(i);
      r.appendChild(U.el('span', 'unit', 's'));
      return r;
    }
    var wRow = row(wLabel, wMin, wInc), bRow = row(bLabel, bMin, bInc);
    body.appendChild(wRow);
    var diffBox = U.checkbox('Temps différent pour chaque joueur', st.diff, function (v) { st.diff = v; paint(); save(); });
    body.appendChild(diffBox);
    body.appendChild(bRow);

    function paint() {
      body.style.display = st.on ? 'block' : 'none';
      bRow.style.display = st.diff ? 'block' : 'none';
      wLabel.textContent = st.diff ? 'Blancs' : 'Chaque joueur';
    }
    function read() {
      st.wMin = num(wMin, 10, 0, 600); st.wInc = num(wInc, 0, 0, 300);
      st.bMin = num(bMin, 10, 0, 600); st.bInc = num(bInc, 0, 0, 300);
      if (!st.diff) { st.bMin = st.wMin; st.bInc = st.wInc; }
      if (st.wMin * 60 + st.wInc <= 0) { st.wMin = 1; wMin.value = 1; }
      if (st.bMin * 60 + st.bInc <= 0) { st.bMin = 1; bMin.value = 1; }
    }
    function save() { read(); U.store.set(self.key, st); }
    U.on(wMin, 'change', save); U.on(wInc, 'change', save);
    U.on(bMin, 'change', save); U.on(bInc, 'change', save);
    paint();

    // Retourne { enabled, w: {base, inc}, b: {base, inc} } (ms)
    this.get = function () {
      save();
      return {
        enabled: st.on,
        w: { base: Math.round(st.wMin * 60000), inc: Math.round(st.wInc * 1000) },
        b: { base: Math.round(st.bMin * 60000), inc: Math.round(st.bInc * 1000) }
      };
    };
  }

  TimeForm.describe = function (tc) {
    function one(x) {
      var m = x.base / 60000;
      return (m % 1 ? m.toFixed(1) : m) + ' min' + (x.inc ? ' + ' + x.inc / 1000 + ' s' : '');
    }
    if (!tc || tc.enabled === false) return 'Sans pendule';
    if (tc.w.base === tc.b.base && tc.w.inc === tc.b.inc) return one(tc.w);
    return 'B ' + one(tc.w) + ' / N ' + one(tc.b);
  };

  window.ChessClock = ChessClock;
  window.TimeForm = TimeForm;
})();
