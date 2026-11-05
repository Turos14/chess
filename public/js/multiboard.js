/* Rendu SVG des échiquiers des échecs à plusieurs (hexagone de Yalta, croix 14×14). La géométrie des cases vient de
 * la variante (multichess.js : polygon(case) dans un carré [-1, 1]²) ; la rotation (camp vu en bas) est appliquée ici
 * aux coordonnées, pour que les pièces restent droites. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';
  var CODES = { yalta: ['w', 'b', 'r'], cross4: ['r', 'u', 'y', 'g'] };

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
    this.svg = svgEl('svg', { viewBox: '-1.04 -1.04 2.08 2.08', width: '100%', height: '100%' });
    this.gCells = svgEl('g', {});
    this.gMarks = svgEl('g', {});
    this.gPieces = svgEl('g', {});
    this.gDots = svgEl('g', {});
    this.svg.appendChild(this.gCells); this.svg.appendChild(this.gMarks); this.svg.appendChild(this.gPieces); this.svg.appendChild(this.gDots);
    container.appendChild(this.svg);
    this.angle = null;
    this.cellEls = {};
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
    function rot(p) { return [p[0] * ca - p[1] * sa, p[0] * sa + p[1] * ca]; }
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
        points: pts.map(function (p) { return p[0].toFixed(4) + ',' + p[1].toFixed(4); }).join(' '),
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
    for (i = 0; i < st.board.length; i++) {
      var p = st.board[i], g = this.geo[i];
      if (!p || !g) continue;
      var s = g.size * 0.92;
      var img = svgEl('image', { x: g.cx - s / 2, y: g.cy - s / 2, width: s, height: s, 'data-cell': i });
      var href = 'pieces/' + this.codes[p.c] + p.t + '.svg';
      img.setAttributeNS(XLINK, 'xlink:href', href);
      img.setAttribute('href', href);
      this.gPieces.appendChild(img);
    }
    Object.keys(tg).forEach(function (k) {
      var g2 = self.geo[k];
      if (!g2) return;
      var dot = tg[k] === 2
        ? svgEl('circle', { cx: g2.cx, cy: g2.cy, r: g2.size * 0.44, 'class': 'md-cap', 'data-cell': k })
        : svgEl('circle', { cx: g2.cx, cy: g2.cy, r: g2.size * 0.16, 'class': 'md-dot', 'data-cell': k });
      self.gDots.appendChild(dot);
    });
  };

  MultiBoard.CODES = CODES;
  window.MultiBoard = MultiBoard;
})();
