/* Rendu SVG des échiquiers des échecs à plusieurs (hexagone de Yalta, croix 14×14). La géométrie des cases vient de
 * la variante (multichess.js : polygon(case) dans un carré [-1, 1]²) ; la rotation (camp vu en bas) est appliquée ici
 * aux coordonnées, pour que les pièces restent droites. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';
  var CODES = { yalta: ['w', 'b', 'r'], cross4: ['r', 'u', 'y', 'g'] };
  // Unités du dessin : la géométrie [-1, 1]² est agrandie ×100. Avec des coordonnées minuscules (pièce de 0,12 unité),
  // Chrome / Edge dessinent les <image> SVG à une taille quasi nulle (pièces invisibles sous Windows), Safari non.
  var K = 100;

  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag), k;
    for (k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    return e;
  }

  function MultiBoard(container, variant) {
    var self = this;
    this.v = variant;
    this.codes = CODES[variant.id];
    this.el = container;
    U.clear(container);
    this.svg = svgEl('svg', { viewBox: (-1.04 * K) + ' ' + (-1.04 * K) + ' ' + (2.08 * K) + ' ' + (2.08 * K), width: '100%', height: '100%' });
    this.gCells = svgEl('g', {});
    this.gMarks = svgEl('g', {});
    this.gPieces = svgEl('g', {});
    this.gDots = svgEl('g', {});
    this.svg.appendChild(this.gCells); this.svg.appendChild(this.gMarks); this.svg.appendChild(this.gPieces); this.svg.appendChild(this.gDots);
    container.appendChild(this.svg);
    this.angle = null;
    this.cellEls = {};
    this.prevBoard = null; this.prevLast = ''; this.animTimer = null;
    this.onCell = null;
    U.on(this.svg, 'click', function (ev) {
      var n = ev.target;
      while (n && n !== self.svg) {
        var c = n.getAttribute && n.getAttribute('data-cell');
        if (c !== null && c !== undefined && c !== '') { if (self.onCell) self.onCell(parseInt(c, 10)); return; }
        n = n.parentNode;
      }
    });
  }

  MultiBoard.prototype.setSize = function (px) {
    px = Math.max(160, Math.floor(px));
    this.el.style.width = px + 'px';
    this.el.style.height = px + 'px';
    return px;
  };

  // Recalcule polygones, centres et tailles de pièces pour un angle de vue (degrés).
  MultiBoard.prototype._geometry = function (angle) {
    var v = this.v, a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), self = this;
    function rot(p) { return [K * (p[0] * ca - p[1] * sa), K * (p[0] * sa + p[1] * ca)]; }
    this.geo = {};
    U.clear(this.gCells);
    this.cellEls = {};
    v.cells.forEach(function (c) {
      var pts = v.polygon(c).map(rot), cx = 0, cy = 0, area = 0, i;
      for (i = 0; i < 4; i++) {
        cx += pts[i][0] / 4; cy += pts[i][1] / 4;
        var j = (i + 1) % 4;
        area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
      }
      var size = Math.sqrt(Math.abs(area) / 2);
      self.geo[c] = { cx: cx, cy: cy, size: size };
      var poly = svgEl('polygon', {
        points: pts.map(function (p) { return p[0].toFixed(2) + ',' + p[1].toFixed(2); }).join(' '),
        'class': 'mc ' + (v.dark(c) ? 'mc-d' : 'mc-l'), 'data-cell': c
      });
      self.gCells.appendChild(poly);
      self.cellEls[c] = poly;
    });
    this.angle = angle;
  };

  // st : {board, angle, sel, targets:[{to, cap}], last:{from, to}|null, checks:[cases des rois en échec]}
  MultiBoard.prototype.render = function (st) {
    var v = this.v, self = this, i;
    if (this.angle !== st.angle) this._geometry(st.angle);
    var tg = {};
    (st.targets || []).forEach(function (t) { tg[t.to] = t.cap ? 2 : 1; });
    var chk = {};
    (st.checks || []).forEach(function (c) { chk[c] = true; });
    v.cells.forEach(function (c) {
      var cls = 'mc ' + (v.dark(c) ? 'mc-d' : 'mc-l');
      if (st.last && (st.last.from === c || st.last.to === c)) cls += ' mc-last';
      if (st.sel === c) cls += ' mc-sel';
      if (chk[c]) cls += ' mc-chk';
      self.cellEls[c].setAttribute('class', cls);
    });
    U.clear(this.gPieces);
    U.clear(this.gDots);
    clearTimeout(this.animTimer);
    var key = st.last ? st.last.from + '-' + st.last.to : '', prev = this.prevBoard, slide = null;
    if (key && key !== this.prevLast && prev && prev[st.last.from] && !st.board[st.last.from] && st.board[st.last.to] &&
        prev[st.last.from].c === st.board[st.last.to].c && this.angle === st.angle) slide = st.last;
    for (i = 0; i < st.board.length; i++) {
      var p = st.board[i], g = this.geo[i];
      if (!p || !g) continue;
      var s = g.size * 0.92;
      var img = svgEl('image', { x: g.cx - s / 2, y: g.cy - s / 2, width: s, height: s, 'data-cell': i });
      var href = 'pieces/' + this.codes[p.c] + p.t + '.svg';
      img.setAttributeNS(XLINK, 'xlink:href', href);
      img.setAttribute('href', href);
      this.gPieces.appendChild(img);
      if (slide && slide.to === i) this._slide(img, this.geo[slide.from], g);
    }
    this.prevBoard = st.board.slice();
    this.prevLast = key;
    Object.keys(tg).forEach(function (k) {
      var g2 = self.geo[k];
      if (!g2) return;
      var dot = tg[k] === 2
        ? svgEl('circle', { cx: g2.cx, cy: g2.cy, r: g2.size * 0.44, 'class': 'md-cap', 'data-cell': k })
        : svgEl('circle', { cx: g2.cx, cy: g2.cy, r: g2.size * 0.16, 'class': 'md-dot', 'data-cell': k });
      self.gDots.appendChild(dot);
    });
  };

  // Glissement de la pièce qui vient d'être jouée, de sa case de départ à sa case d'arrivée (attribut transform animé
  // en JavaScript : plus sûr que les transitions CSS sur le SVG des anciens Safari).
  var SLIDE_MS = 200;
  MultiBoard.prototype._slide = function (img, a, b) {
    var self = this, dx = a.cx - b.cx, dy = a.cy - b.cy, t0 = new Date().getTime();
    function frame() {
      var k = Math.min(1, (new Date().getTime() - t0) / SLIDE_MS), e = 1 - (1 - k) * (1 - k);
      img.setAttribute('transform', 'translate(' + (dx * (1 - e)).toFixed(2) + ',' + (dy * (1 - e)).toFixed(2) + ')');
      if (k < 1) self.animTimer = setTimeout(frame, 16);
      else img.removeAttribute('transform');
    }
    frame();
  };

  MultiBoard.CODES = CODES;
  window.MultiBoard = MultiBoard;
})();
