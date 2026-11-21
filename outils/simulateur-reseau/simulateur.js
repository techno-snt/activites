/* Simulateur réseau : moteur identique à celui de l'activité « Réseau : IP, passerelle et DNS ».
   Le moteur de routage est le même que celui de l'activité « Réseau : IP, passerelle et DNS ».
   Simplification pédagogique : tous les réseaux sont des /24 (masque 255.255.255.0). */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var SITE = 'www.monsite-snt.fr';

  /* ===================== Moteur ===================== */
  var NODES = [], LINKS = [], portSeq = 1000, pidSeq = 0, seq = 0;
  var N = function (id) { return NODES.find(function (n) { return n.id === id; }); };
  var ipOK = function (s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(function (x) { return +x <= 255; }); };
  var sameNet = function (a, b) { return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.'); };
  var epKey = function (e) { return e.n + ':' + e.i; };
  function linkAt(n, i) { return LINKS.find(function (l) { return (l.a.n === n && l.a.i === i) || (l.b.n === n && l.b.i === i); }); }

  // Machines du même réseau local (on traverse les switchs, pas les routeurs)
  function segment(n, i) {
    var parent = {};
    var find = function (k) { if (parent[k] === undefined) parent[k] = k; while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    var uni = function (a, b) { parent[find(a)] = find(b); };
    LINKS.forEach(function (l) { uni(epKey(l.a), epKey(l.b)); });
    var bySw = {};
    LINKS.forEach(function (l) {
      [l.a, l.b].forEach(function (e) { if (N(e.n).type === 'switch') (bySw[e.n] = bySw[e.n] || []).push(epKey(e)); });
    });
    Object.keys(bySw).forEach(function (s) { bySw[s].forEach(function (k) { uni(k, bySw[s][0]); }); });
    var root = find(epKey({ n: n, i: i }));
    var seen = {}, out = [];
    LINKS.forEach(function (l) {
      [l.a, l.b].forEach(function (e) {
        var k = epKey(e);
        if (N(e.n).type !== 'switch' && find(k) === root && !seen[k]) { seen[k] = true; out.push(e); }
      });
    });
    return out;
  }
  function portFor(nodeRef) {
    var n = N(nodeRef.n);
    if (n.type === 'switch') return { n: n.id, i: portSeq++ };
    var count = n.type === 'router' ? n.ifaces.length : 1;
    for (var i = 0; i < count; i++) if (!linkAt(n.id, i)) return { n: n.id, i: i };
    return null;
  }
  function addLink(a, b) {
    var pa = portFor(a), pb = portFor(b);
    if (!pa || !pb) return { ok: false, msg: 'Pas de prise libre sur un des appareils.' };
    if (a.n === b.n) return { ok: false, msg: 'Impossible de relier un appareil à lui-même.' };
    LINKS.push({ a: { n: a.n, i: pa.i }, b: { n: b.n, i: pb.i } });
    return { ok: true };
  }

  // Livraison d'un paquet. Retourne {ok,msg,hops,src,dstNode}.
  function route(startId, srcIP, dstIP, pid) {
    var cur = startId, src = srcIP, dst = dstIP;
    var hops = [startId];
    for (var step = 0; step < 14; step++) {
      var node = N(cur);
      if (node.ifaces.some(function (f) { return f.ip === dst; })) {
        if (node.type === 'router' && node.nat && node.nat[pid]) { dst = node.nat[pid]; }
        else return { ok: true, hops: hops, src: src, dstNode: cur };
      }
      var local = false;
      for (var i = 0; i < node.ifaces.length; i++) {
        var f = node.ifaces[i];
        if (!f.ip || !linkAt(cur, i) || !sameNet(f.ip, dst)) continue;
        local = true;
        var seg = segment(cur, i);
        var m = null;
        for (var k = 0; k < seg.length; k++) {
          var e = seg[k];
          if (e.n !== cur && N(e.n).ifaces && N(e.n).ifaces[e.i] && N(e.n).ifaces[e.i].ip === dst) { m = e; break; }
        }
        if (!m) return { ok: false, msg: 'Délai d\'attente dépassé : aucune machine ne répond à ' + dst + ' sur son réseau.', hops: hops };
        if (node.type === 'router' && f.wan && !node.ifaces.some(function (g) { return g.ip === dst; })) {
          var inside = node.ifaces.some(function (g, j) { return j !== i && g.ip && sameNet(g.ip, src); });
          if (inside) { node.nat = node.nat || {}; node.nat[pid] = src; src = f.ip; }
        }
        hops.push(m.n); cur = m.n; break;
      }
      if (local) continue;
      if (node.type !== 'router') {
        if (!node.gw) return { ok: false, msg: dst + ' est hors de mon réseau et aucune passerelle n\'est configurée : le paquet ne peut pas sortir.', hops: hops };
        if (!linkAt(cur, 0)) return { ok: false, msg: 'Câble non branché.', hops: hops };
        var gseg = segment(cur, 0), g = null;
        for (var q = 0; q < gseg.length; q++) {
          var ge = gseg[q];
          if (N(ge.n).ifaces && N(ge.n).ifaces[ge.i] && N(ge.n).ifaces[ge.i].ip === node.gw) { g = ge; break; }
        }
        if (!g) return { ok: false, msg: 'La passerelle ' + node.gw + ' ne répond pas : aucun routeur de mon réseau porte cette adresse.', hops: hops };
        hops.push(g.n); cur = g.n; continue;
      }
      if (!node.defGw) return { ok: false, msg: node.label + ' ne sait pas où envoyer ce paquet (pas de route par défaut).', hops: hops };
      var out = -1, nh = null;
      for (var o = 0; o < node.ifaces.length && !nh; o++) {
        if (!linkAt(cur, o)) continue;
        var ss = segment(cur, o);
        for (var s2 = 0; s2 < ss.length; s2++) {
          var se = ss[s2];
          if (N(se.n).ifaces && N(se.n).ifaces[se.i] && N(se.n).ifaces[se.i].ip === node.defGw) { out = o; nh = se; break; }
        }
      }
      if (!nh) return { ok: false, msg: 'La passerelle ' + node.defGw + ' du routeur ' + node.label + ' est injoignable.', hops: hops };
      if (node.ifaces[out].wan) {
        var inside2 = node.ifaces.some(function (f2, j) { return j !== out && f2.ip && sameNet(f2.ip, src); });
        if (inside2) { node.nat = node.nat || {}; node.nat[pid] = src; src = node.ifaces[out].ip; }
      }
      hops.push(nh.n); cur = nh.n;
    }
    return { ok: false, msg: 'Trop de sauts : boucle de routage.', hops: hops };
  }

  function pingCore(srcId, dstIP) {
    var src = N(srcId);
    var srcIP = src.ifaces[0].ip;
    var pid = ++pidSeq;
    if (!srcIP) return { ok: false, msg: src.label + ' : pas d\'adresse IP configurée.', legs: [] };
    var r1 = route(srcId, srcIP, dstIP, pid);
    var legs = [r1.hops];
    if (!r1.ok) return { ok: false, msg: r1.msg, legs: legs };
    var r2 = route(r1.dstNode, dstIP, r1.src, pid);
    legs.push(r2.hops);
    if (!r2.ok) return { ok: false, msg: 'La requête arrive, mais la réponse ne revient pas : ' + r2.msg, legs: legs };
    return { ok: true, msg: 'Réponse de ' + dstIP, legs: legs, dstNode: r1.dstNode };
  }

  function resolveCore(hostId, name) {
    var h = N(hostId);
    if (ipOK(name)) return { ok: true, ip: name };
    if (!h.dns) return { ok: false, msg: 'Nom « ' + name + ' » inconnu : aucun serveur DNS configuré sur ' + h.label + '.' };
    var dnsNode = NODES.find(function (n) { return n.ifaces && n.ifaces[0] && n.ifaces[0].ip === h.dns && n.dnsSvc; });
    if (!dnsNode) return { ok: false, msg: 'Serveur DNS ' + h.dns + ' introuvable.' };
    var q = pingCore(hostId, h.dns);
    if (!q.ok) return { ok: false, msg: 'Serveur DNS injoignable. ' + q.msg };
    if (!dnsNode.records || !(name in dnsNode.records)) return { ok: false, msg: 'Le serveur DNS ne connaît pas « ' + name + ' ».' };
    return { ok: true, ip: dnsNode.records[name] };
  }

  /* ===================== Chemin physique (pour l'animation) ===================== */
  // Passe par les switchs, pas par les routeurs ni les machines.
  function physPath(a, b) {
    var prev = {}; prev[a] = null;
    var q = [a];
    while (q.length) {
      var cur = q.shift();
      if (cur === b) break;
      if (cur !== a && N(cur).type !== 'switch') continue;
      LINKS.forEach(function (l) {
        var nxt = null;
        if (l.a.n === cur) nxt = l.b.n; else if (l.b.n === cur) nxt = l.a.n;
        if (!nxt || (nxt in prev)) return;
        prev[nxt] = cur; q.push(nxt);
      });
    }
    if (!(b in prev)) return [a, b];
    var path = [];
    for (var k = b; k !== null; k = prev[k]) path.unshift(k);
    return path;
  }
  function expand(hops) {
    var out = [hops[0]];
    for (var i = 0; i < hops.length - 1; i++) {
      var p = physPath(hops[i], hops[i + 1]);
      for (var j = 1; j < p.length; j++) out.push(p[j]);
    }
    return out;
  }

  /* ===================== Interface ===================== */
  var $ = function (id) { return document.getElementById(id); };
  var svg = $('canvas'), layerLinks = $('layerLinks'), layerNodes = $('layerNodes'), layerPk = $('layerPk');
  var statusEl = $('status'), propsEl = $('props'), termHost = $('termHost'), termOut = $('termOut'), termForm = $('termForm'), cmdInput = $('cmd');
  var mode = 'select', selected = null, pending = null, drag = null, busy = false, OUT = {};
  var fid = 0;
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var KINDS = {
    pc: { label: 'Ordinateur', type: 'pc' },
    notebook: { label: 'Portable', type: 'notebook' },
    switch: { label: 'Switch', type: 'switch' },
    router: { label: 'Routeur', type: 'router' },
    web: { label: 'Serveur web', type: 'server', web: true },
    dns: { label: 'Serveur DNS', type: 'server', dnsSvc: true }
  };

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function setStatus(msg) { statusEl.textContent = msg; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function makeNode(kind, x, y) {
    var k = KINDS[kind];
    var n = { id: 'N' + (++seq), kind: kind, type: k.type, label: k.label, x: x, y: y };
    if (k.type === 'router') { n.ifaces = [{ ip: '' }, { ip: '', wan: true }]; n.defGw = ''; }
    else if (k.type !== 'switch') {
      n.ifaces = [{ ip: '' }]; n.gw = ''; n.dns = '';
      if (k.web) n.web = true;
      if (k.dnsSvc) { n.dnsSvc = true; n.records = {}; }
    }
    return n;
  }
  function freeSpot() {
    for (var row = 0; row < 4; row++) for (var col = 0; col < 5; col++) {
      var x = 110 + col * 170, y = 90 + row * 115;
      if (!NODES.some(function (n) { return Math.abs(n.x - x) < 60 && Math.abs(n.y - y) < 60; })) return { x: x, y: y };
    }
    return { x: 450, y: 260 };
  }
  function addNode(kind) {
    var p = freeSpot();
    var n = makeNode(kind, p.x, p.y);
    NODES.push(n);
    selected = n.id;
    setStatus(n.label + ' ajouté. Configurez-le à droite.');
    refresh();
  }
  function removeNode(id) {
    NODES = NODES.filter(function (n) { return n.id !== id; });
    LINKS = LINKS.filter(function (l) { return l.a.n !== id && l.b.n !== id; });
    if (selected === id) selected = null;
    if (pending === id) pending = null;
    delete OUT[id];
    setStatus('Appareil supprimé.');
    refresh();
  }
  function removeLink(l) {
    LINKS = LINKS.filter(function (x) { return x !== l; });
    setStatus('Câble débranché.');
    refresh();
  }

  function ipText(n) {
    if (n.type === 'switch') return '';
    if (n.type === 'router') return n.ifaces[0].ip || 'pas d\'IP';
    return n.ifaces[0].ip || 'pas d\'IP';
  }

  function drawIcon(g, n) {
    var k = n.kind;
    if (k === 'pc') {
      el('rect', { x: -26, y: -24, width: 52, height: 34, rx: 4, class: 'body' }, g);
      el('rect', { x: -6, y: 10, width: 12, height: 6, class: 'body' }, g);
      el('rect', { x: -14, y: 16, width: 28, height: 4, rx: 2, class: 'body' }, g);
    } else if (k === 'notebook') {
      el('rect', { x: -22, y: -20, width: 44, height: 30, rx: 3, class: 'body' }, g);
      el('path', { d: 'M-30 14 L30 14 L26 22 L-26 22 Z', class: 'body' }, g);
    } else if (k === 'switch') {
      el('rect', { x: -40, y: -14, width: 80, height: 28, rx: 6, class: 'body' }, g);
      for (var i = -28; i <= 28; i += 8) el('circle', { cx: i, cy: 0, r: 2.5, class: 'dot' }, g);
    } else if (k === 'router') {
      el('circle', { cx: 0, cy: 0, r: 26, class: 'body' }, g);
      el('path', { d: 'M-14 -5 H12 M6 -11 L12 -5 L6 1 M14 5 H-12 M-6 -1 L-12 5 L-6 11', class: 'arrows' }, g);
    } else {
      el('rect', { x: -22, y: -28, width: 44, height: 56, rx: 4, class: 'body' }, g);
      [-14, -2, 10].forEach(function (y) { el('line', { x1: -14, y1: y, x2: 14, y2: y, class: 'lines' }, g); });
    }
  }

  function drawLinks() {
    layerLinks.textContent = '';
    LINKS.forEach(function (l) {
      var a = N(l.a.n), b = N(l.b.n);
      if (!a || !b) return;
      var line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'cable' }, layerLinks);
      line.addEventListener('pointerdown', function (e) {
        if (mode === 'delete') { e.stopPropagation(); removeLink(l); }
      });
    });
  }

  function drawNodes() {
    layerNodes.textContent = '';
    NODES.forEach(function (n) {
      var cls = 'dev' + (selected === n.id ? ' sel' : '') + (pending === n.id ? ' pend' : '');
      var g = el('g', { class: cls, transform: 'translate(' + n.x + ',' + n.y + ')', tabindex: '0', role: 'button', 'data-id': n.id, 'aria-label': n.label + ', ' + ipText(n) }, layerNodes);
      el('rect', { x: -80, y: -56, width: 160, height: 150, class: 'hit' }, g);
      var art = el('g', { filter: 'url(#shadow)', transform: 'scale(1.6)' }, g);
      drawIcon(art, n);
      var connected = LINKS.some(function (l) { return l.a.n === n.id || l.b.n === n.id; });
      el('circle', { cx: 44, cy: -44, r: 6, class: connected ? 'led on' : 'led' }, g);
      var t1 = el('text', { x: 0, y: 66, class: 'nlab' }, g); t1.textContent = n.label;
      var t2 = el('text', { x: 0, y: 86, class: 'nip' }, g); t2.textContent = ipText(n);
      g.addEventListener('pointerdown', function (e) { onDown(e, n, g); });
      g.addEventListener('pointermove', function (e) { onMove(e, g); });
      g.addEventListener('pointerup', function (e) { onUp(e, n); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickNode(n); }
      });
    });
    if (!NODES.length) {
      var hint = el('text', { x: 450, y: 260, class: 'empty', 'text-anchor': 'middle' }, layerNodes);
      hint.textContent = 'Ajoutez des appareils à gauche, ou chargez le scénario de la séance.';
    }
  }

  function draw() { drawLinks(); drawNodes(); }

  function refresh() {
    draw();
    renderProps();
    refreshHosts();
    syncModeButtons();
  }

  function toSvg(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function onDown(e, n, g) {
    if (mode !== 'select') return;
    e.preventDefault();
    var p = toSvg(e);
    drag = { n: n, g: g, dx: p.x - n.x, dy: p.y - n.y, moved: false, sx: e.clientX, sy: e.clientY };
    g.setPointerCapture(e.pointerId);
  }
  function onMove(e, g) {
    if (!drag || drag.g !== g) return;
    var p = toSvg(e);
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    drag.n.x = clamp(p.x - drag.dx, 60, 940);
    drag.n.y = clamp(p.y - drag.dy, 50, 470);
    g.setAttribute('transform', 'translate(' + drag.n.x + ',' + drag.n.y + ')');
    drawLinks();
  }
  function onUp(e, n) {
    if (!drag || drag.n !== n) return;
    var d = drag;
    drag = null;
    if (!d.moved) clickNode(n);
    else { selected = n.id; refresh(); }
  }

  function clickNode(n) {
    if (mode === 'select') {
      selected = n.id;
      setStatus('Configurez ' + n.label + ' à droite. Glissez l\'appareil pour le déplacer.');
      refresh();
    } else if (mode === 'cable') {
      if (!pending) {
        pending = n.id;
        setStatus('Sélectionnez l\'appareil à relier à ' + n.label + '.');
      } else if (pending === n.id) {
        pending = null;
        setStatus('Câblage annulé.');
      } else {
        var r = addLink({ n: pending, i: 0 }, { n: n.id, i: 0 });
        setStatus(r.ok ? 'Câble branché.' : r.msg);
        pending = null;
      }
      refresh();
    } else if (mode === 'delete') {
      removeNode(n.id);
    }
  }

  function syncModeButtons() {
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-mode') === mode ? 'true' : 'false');
    });
    svg.setAttribute('data-mode', mode);
  }
  function setMode(m) {
    mode = m; pending = null;
    setStatus(m === 'cable' ? 'Cliquez un appareil, puis un second pour les relier.' : m === 'delete' ? 'Cliquez un appareil ou un câble pour le supprimer.' : 'Cliquez un appareil pour le configurer.');
    refresh();
  }

  /* ----- Panneau de configuration ----- */
  function field(parent, text, value, onChange, help) {
    var wrap = document.createElement('div'); wrap.className = 'field';
    var id = 'f' + (++fid);
    var lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = text;
    var inp = document.createElement('input');
    inp.id = id; inp.type = 'text'; inp.value = value || ''; inp.defaultValue = value || '';
    inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.addEventListener('change', function () { onChange(inp); });
    wrap.appendChild(lab); wrap.appendChild(inp);
    if (help) { var h = document.createElement('p'); h.className = 'help'; h.textContent = help; wrap.appendChild(h); }
    parent.appendChild(wrap);
    return inp;
  }
  function ipChange(setter) {
    return function (inp) {
      var v = inp.value.trim();
      if (v && !ipOK(v)) { setStatus('Adresse invalide : « ' + v + ' ». Exemple : 192.168.0.11'); inp.value = inp.defaultValue; return; }
      setter(v);
      inp.defaultValue = v;
      setStatus('Enregistré.');
      draw();
      refreshHosts();
    };
  }

  function renderProps() {
    propsEl.textContent = '';
    var n = N(selected);
    if (!n) {
      var p = document.createElement('p'); p.className = 'help';
      p.textContent = 'Cliquez sur un appareil du plan pour le configurer.';
      propsEl.appendChild(p);
      return;
    }
    var title = document.createElement('p'); title.className = 'props-title';
    title.textContent = n.label;
    propsEl.appendChild(title);

    field(propsEl, 'Nom', n.label, function (inp) { n.label = inp.value.trim() || n.label; inp.value = n.label; draw(); refreshHosts(); });

    if (n.type === 'switch') {
      var s = document.createElement('p'); s.className = 'help';
      s.textContent = 'Un switch relie les machines d\'un même réseau. Il n\'a pas d\'adresse à configurer.';
      propsEl.appendChild(s);
    } else if (n.type === 'router') {
      n.ifaces.forEach(function (f, i) {
        field(propsEl, 'Interface ' + (i + 1) + ' : adresse IP', f.ip, ipChange(function (v) { f.ip = v; }));
        var wrap = document.createElement('div'); wrap.className = 'field check';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'f' + (++fid); cb.checked = !!f.wan;
        cb.addEventListener('change', function () { f.wan = cb.checked; draw(); });
        var cl = document.createElement('label'); cl.htmlFor = cb.id; cl.textContent = 'Interface vers l\'opérateur (WAN)';
        wrap.appendChild(cb); wrap.appendChild(cl); propsEl.appendChild(wrap);
      });
      var bar = document.createElement('div'); bar.className = 'iface-bar';
      var add = document.createElement('button'); add.type = 'button'; add.textContent = 'Ajouter une interface';
      add.addEventListener('click', function () { n.ifaces.push({ ip: '' }); setStatus('Interface ajoutée.'); refresh(); });
      var rem = document.createElement('button'); rem.type = 'button'; rem.textContent = 'Retirer la dernière';
      rem.disabled = n.ifaces.length <= 1 || linkAt(n.id, n.ifaces.length - 1);
      rem.addEventListener('click', function () { n.ifaces.pop(); setStatus('Interface retirée.'); refresh(); });
      bar.appendChild(add); bar.appendChild(rem); propsEl.appendChild(bar);
      field(propsEl, 'Route par défaut : passerelle', n.defGw, ipChange(function (v) { n.defGw = v; }), 'Adresse du routeur vers lequel envoyer ce qui ne reste pas dans les réseaux connus.');
    } else {
      field(propsEl, 'Adresse IP', n.ifaces[0].ip, ipChange(function (v) { n.ifaces[0].ip = v; }), 'Masque 255.255.255.0 (réseau /24), comme dans l\'activité.');
      field(propsEl, 'Passerelle', n.gw, ipChange(function (v) { n.gw = v; }), 'Le routeur de mon réseau, pour sortir de mon réseau.');
      if (n.web) field(propsEl, 'Nom du site', n.siteName || SITE, function (inp) { n.siteName = inp.value.trim() || SITE; inp.value = n.siteName; setStatus('Nom du site enregistré.'); }, 'Le nom affiché sur la page d\'accueil du serveur.');
      field(propsEl, 'Serveur DNS', n.dns, ipChange(function (v) { n.dns = v; }), 'Le serveur qui traduit un nom en adresse IP.');
    }

    if (n.dnsSvc) {
      var lab = document.createElement('label'); lab.className = 'area-label'; lab.textContent = 'Noms connus (un par ligne : nom adresse IP)';
      var ta = document.createElement('textarea');
      ta.rows = 3; ta.value = Object.keys(n.records).map(function (k) { return k + ' ' + n.records[k]; }).join('\n');
      ta.addEventListener('change', function () {
        var rec = {}, bad = null;
        ta.value.split('\n').forEach(function (line) {
          var parts = line.trim().split(/\s+/);
          if (parts.length < 2 || !parts[0]) return;
          if (!ipOK(parts[1])) { bad = parts[1]; return; }
          rec[parts[0]] = parts[1];
        });
        if (bad) { setStatus('Adresse invalide dans les noms : ' + bad); ta.value = Object.keys(n.records).map(function (k) { return k + ' ' + n.records[k]; }).join('\n'); return; }
        n.records = rec; setStatus('Noms enregistrés.');
      });
      propsEl.appendChild(lab); propsEl.appendChild(ta);
    }

    var del = document.createElement('button');
    del.type = 'button'; del.className = 'danger'; del.textContent = 'Supprimer cet appareil';
    del.addEventListener('click', function () { removeNode(n.id); });
    propsEl.appendChild(del);
  }

  /* ----- Terminal ----- */
  function hosts() { return NODES.filter(function (n) { return n.type !== 'switch' && n.type !== 'router'; }); }
  function refreshHosts() {
    var keep = termHost.value;
    termHost.textContent = '';
    hosts().forEach(function (h) {
      var o = document.createElement('option'); o.value = h.id; o.textContent = h.label + ' (' + (h.ifaces[0].ip || 'pas d\'IP') + ')';
      termHost.appendChild(o);
    });
    if (hosts().some(function (h) { return h.id === keep; })) termHost.value = keep;
    if (!termHost.value && termHost.options.length) termHost.value = termHost.options[0].value;
    renderTermOut();
  }
  function printTo(hostId, text) {
    (OUT[hostId] = OUT[hostId] || []).push(text);
    if (termHost.value === hostId) renderTermOut();
  }
  function renderTermOut() {
    var lines = OUT[termHost.value] || [];
    termOut.textContent = lines.join('\n');
    termOut.scrollTop = termOut.scrollHeight;
  }
  function banner(h) {
    return 'Terminal de ' + h.label + '. Tapez « aide » pour la liste des commandes.';
  }

  function fly(ids, cls) {
    return new Promise(function (resolve) {
      if (ids.length < 2) { resolve(); return; }
      var dot = el('circle', { r: 7, class: 'packet ' + cls }, layerPk);
      var steps = reduceMotion ? 1 : 16;
      var i = 0;
      (function nextSeg() {
        if (i >= ids.length - 1) { dot.remove(); resolve(); return; }
        var a = N(ids[i]), b = N(ids[i + 1]), s = 0;
        (function tick() {
          s++;
          var t = s / steps;
          dot.setAttribute('cx', a.x + (b.x - a.x) * t);
          dot.setAttribute('cy', a.y + (b.y - a.y) * t);
          if (s < steps) setTimeout(tick, 10);
          else { i++; nextSeg(); }
        })();
      })();
    });
  }
  async function flyLegs(legs) {
    for (var k = 0; k < legs.length; k++) {
      await fly(expand(legs[k]), k === 0 ? 'req' : 'rep');
    }
  }

  async function cmdPing(h, target) {
    var r = resolveCore(h.id, target);
    if (!r.ok) { printTo(h.id, r.msg); return; }
    printTo(h.id, 'Ping ' + target + (target === r.ip ? '' : ' [' + r.ip + ']') + ' : 4 paquets.');
    var ok = 0;
    for (var k = 0; k < 4; k++) {
      var p = pingCore(h.id, r.ip);
      await flyLegs(p.legs);
      if (p.ok) { ok++; printTo(h.id, p.msg + ' (paquet ' + (k + 1) + ')'); }
      else printTo(h.id, 'Échec (paquet ' + (k + 1) + ') : ' + p.msg);
    }
    printTo(h.id, 'Statistiques : 4 envoyés, ' + ok + ' reçus, ' + (4 - ok) + ' perdus.');
  }

  async function cmdWeb(h, target) {
    var r = resolveCore(h.id, target);
    if (!r.ok) { printTo(h.id, r.msg); return; }
    var p = pingCore(h.id, r.ip);
    await flyLegs(p.legs);
    if (!p.ok) { printTo(h.id, 'Pas de réponse du serveur : ' + p.msg); return; }
    var srv = N(p.dstNode);
    if (srv && srv.web && srv.ifaces.some(function (f) { return f.ip === r.ip; })) {
      printTo(h.id, 'HTTP 200 OK : la page de « ' + (srv.siteName || SITE) + ' » s\'affiche.');
    } else {
      printTo(h.id, 'Connexion établie, mais ' + r.ip + ' ne répond pas comme un serveur web.');
    }
  }

  function ipconfig(h) {
    printTo(h.id, 'Adresse IP : ' + (h.ifaces[0].ip || '(non configurée)'));
    printTo(h.id, 'Passerelle : ' + (h.gw || '(aucune)'));
    printTo(h.id, 'Serveur DNS : ' + (h.dns || '(aucun)'));
  }

  async function runCommand(line) {
    var h = N(termHost.value);
    if (!h) { setStatus('Ajoutez une machine pour utiliser le terminal.'); return; }
    printTo(h.id, '> ' + line);
    var parts = line.trim().split(/\s+/);
    var cmd = (parts[0] || '').toLowerCase();
    var arg = parts[1] || '';
    if (!cmd) return;
    if (cmd === 'aide') {
      printTo(h.id, 'ping <adresse ou nom> : teste la connexion (4 paquets)');
      printTo(h.id, 'web <adresse ou nom> : demande la page du site');
      printTo(h.id, 'ipconfig : affiche la configuration');
      printTo(h.id, 'clear : efface le terminal');
    } else if (cmd === 'clear') {
      OUT[h.id] = []; renderTermOut();
    } else if (cmd === 'ipconfig') {
      ipconfig(h);
    } else if (cmd === 'ping' || cmd === 'web') {
      if (!arg) { printTo(h.id, 'Usage : ' + cmd + ' <adresse ou nom>'); return; }
      if (!h.ifaces[0].ip) { printTo(h.id, h.label + ' : pas d\'adresse IP configurée.'); return; }
      busy = true; cmdInput.disabled = true;
      try { if (cmd === 'ping') await cmdPing(h, arg); else await cmdWeb(h, arg); }
      finally { busy = false; cmdInput.disabled = false; cmdInput.focus(); }
    } else {
      printTo(h.id, 'Commande inconnue : ' + cmd + '. Tapez « aide ».');
    }
  }

  termForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var line = cmdInput.value;
    cmdInput.value = '';
    runCommand(line);
  });
  termHost.addEventListener('change', renderTermOut);

  /* ----- Scénario, vider, export, import ----- */
  function loadScenario() {
    NODES = [
      { id: 'PC', kind: 'pc', type: 'pc', label: 'Ordinateur', ifaces: [{ ip: '' }], gw: '', dns: '', x: 100, y: 110 },
      { id: 'NB', kind: 'notebook', type: 'notebook', label: 'Portable', ifaces: [{ ip: '' }], gw: '192.168.0.254', dns: '', x: 100, y: 300 },
      { id: 'SW1', kind: 'switch', type: 'switch', label: 'Switch', x: 250, y: 205 },
      { id: 'BOX', kind: 'router', type: 'router', label: 'Box', ifaces: [{ ip: '192.168.0.254' }, { ip: '192.168.140.100', wan: true }], defGw: '192.168.140.254', x: 400, y: 205 },
      { id: 'SW2', kind: 'switch', type: 'switch', label: 'Switch opérateur', x: 570, y: 205 },
      { id: 'OP', kind: 'router', type: 'router', label: 'Routeur opérateur', ifaces: [{ ip: '192.168.140.254' }, { ip: '192.168.21.254' }], defGw: '', x: 750, y: 205 },
      { id: 'DNS', kind: 'dns', type: 'server', label: 'Serveur DNS', ifaces: [{ ip: '192.168.140.1' }], gw: '192.168.140.254', dns: '', dnsSvc: true, records: { 'www.monsite-snt.fr': '192.168.21.1' }, x: 570, y: 80 },
      { id: 'WEB', kind: 'web', type: 'server', label: 'Serveur Web', ifaces: [{ ip: '192.168.21.1' }], gw: '192.168.21.254', dns: '', web: true, x: 910, y: 205 }
    ];
    LINKS = []; portSeq = 1000; OUT = {}; selected = null; pending = null;
    var L = function (a, b) { addLink({ n: a, i: 0 }, { n: b, i: 0 }); };
    L('PC', 'SW1'); L('NB', 'SW1'); L('SW1', 'BOX'); L('BOX', 'SW2'); L('OP', 'SW2'); L('DNS', 'SW2'); L('OP', 'WEB');
    setStatus('Scénario de la séance chargé. Configurez le PC et le portable, puis testez.');
    refresh();
  }
  function clearAll() {
    NODES = []; LINKS = []; portSeq = 1000; OUT = {}; selected = null; pending = null;
    setStatus('Plan vidé.');
    refresh();
  }
  function exportPlan() {
    var data = JSON.stringify({ version: 1, nodes: NODES, links: LINKS, portSeq: portSeq }, null, 2);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'simulateur-reseau.json';
    document.body.appendChild(a); a.click(); a.remove();
    setStatus('Plan exporté.');
  }
  function importPlan(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('format');
        NODES = data.nodes; LINKS = data.links; portSeq = data.portSeq || 1000; OUT = {}; selected = null; pending = null;
        setStatus('Plan importé.');
        refresh();
      } catch (err) {
        setStatus('Fichier non reconnu : ce n\'est pas un plan exporté depuis cet outil.');
      }
    };
    reader.readAsText(file);
  }

  /* ----- Zoom, déplacement du plan, clavier, terminal, icônes de la palette ----- */
  var VB = { x: 0, y: 0, w: 1000, h: 520 };
  function applyVB() { svg.setAttribute('viewBox', VB.x + ' ' + VB.y + ' ' + VB.w + ' ' + VB.h); }
  function zoom(f) {
    var cx = VB.x + VB.w / 2, cy = VB.y + VB.h / 2;
    var nw = clamp(VB.w * f, 500, 1600), k = nw / VB.w;
    VB.w = nw; VB.h = VB.h * k;
    VB.x = cx - VB.w / 2; VB.y = cy - VB.h / 2;
    applyVB();
  }
  $('btnZoomIn').addEventListener('click', function () { zoom(0.8); });
  $('btnZoomOut').addEventListener('click', function () { zoom(1.25); });

  // Glisser le fond du plan pour le déplacer ; un simple clic sur le fond désélectionne
  var pan = null;
  svg.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || (e.target.closest && e.target.closest('.dev, .cable'))) return;
    pan = { sx: e.clientX, sy: e.clientY, x: VB.x, y: VB.y, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', function (e) {
    if (!pan) return;
    var s = svg.getScreenCTM().a;
    var ddx = e.clientX - pan.sx, ddy = e.clientY - pan.sy;
    if (Math.abs(ddx) + Math.abs(ddy) > 3) pan.moved = true;
    VB.x = pan.x - ddx / s; VB.y = pan.y - ddy / s;
    applyVB();
  });
  function endPan() {
    if (!pan) return;
    var moved = pan.moved; pan = null;
    if (!moved && mode === 'select' && selected) {
      selected = null; setStatus('Cliquez un appareil pour le configurer.'); refresh();
    }
  }
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', function () { pan = null; });

  // Clavier : Suppr / Retour arrière supprime l'appareil ciblé, Échap annule un câblage en cours
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'Escape' && pending) { pending = null; setStatus('Câblage annulé.'); refresh(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      var id = (t && t.getAttribute && t.getAttribute('data-id')) || selected;
      if (id && N(id)) { e.preventDefault(); removeNode(id); }
    }
  });

  // Tiroir du terminal
  $('btnTerm').addEventListener('click', function () {
    var btn = $('btnTerm');
    var open = document.body.classList.toggle('term-open');
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (open) cmdInput.focus();
  });

  // Icônes de la palette, dessinées avec les mêmes formes que le plan
  document.querySelectorAll('.palette [data-add]').forEach(function (b) {
    drawIcon(b.querySelector('svg.ic'), { kind: b.getAttribute('data-add') });
  });

  /* ----- Glisser-déposer depuis la palette ----- */
  var wrap = svg.parentNode;
  document.querySelectorAll('[data-add]').forEach(function (b) {
    b.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', b.getAttribute('data-add'));
      e.dataTransfer.effectAllowed = 'copy';
    });
    b.addEventListener('click', function () { addNode(b.getAttribute('data-add')); });
  });
  svg.addEventListener('dragover', function (e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    wrap.classList.add('drop');
  });
  svg.addEventListener('dragleave', function () { wrap.classList.remove('drop'); });
  svg.addEventListener('drop', function (e) {
    e.preventDefault(); wrap.classList.remove('drop');
    var kind = e.dataTransfer.getData('text/plain');
    if (!KINDS[kind]) return;
    var p = toSvg(e);
    var n = makeNode(kind, clamp(p.x, 60, 940), clamp(p.y, 50, 470));
    NODES.push(n);
    selected = n.id;
    setStatus(n.label + ' posé sur le plan. Configurez-le à droite.');
    refresh();
  });
  document.querySelectorAll('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });
  $('btnScenario').addEventListener('click', loadScenario);
  $('btnNew').addEventListener('click', clearAll);
  $('btnExport').addEventListener('click', exportPlan);
  $('fileImport').addEventListener('change', function (e) { if (e.target.files[0]) importPlan(e.target.files[0]); e.target.value = ''; });

  // Au chargement : plan vide, prêt à l'emploi
  setMode('select');
  refresh();
  setStatus('Ajoutez des appareils, ou chargez le scénario de la séance.');
})();
