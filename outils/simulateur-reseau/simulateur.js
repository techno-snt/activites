/* Simulateur réseau : moteur identique à celui de l'activité « Réseau : IP, passerelle et DNS ».
   Chaque interface a un masque (par défaut 255.255.255.0, soit un réseau /24). */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var SITE = 'www.monsite-snt.fr';
  var SWITCH_PORTS = 8;

  /* ===================== Moteur ===================== */
  var NODES = [], LINKS = [], pidSeq = 0, seq = 0;
  var N = function (id) { return NODES.find(function (n) { return n.id === id; }); };
  var ipOK = function (s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every(function (x) { return +x <= 255; }); };
  var DEF_MASK = '255.255.255.0';
  var ip2 = function (s) { return s.split('.').reduce(function (acc, x) { return ((acc << 8) | +x) >>> 0; }, 0); };
  var maskOf = function (f) { return (f && f.mask) || DEF_MASK; };
  // Deux adresses sont sur le même réseau si, après application du masque, elles sont égales
  var sameNet = function (a, am, b) { var m = ip2(am); return ((ip2(a) & m) >>> 0) === ((ip2(b) & m) >>> 0); };
  // Masque valide : une adresse dont les bits à 1 sont tous à gauche (255.255.255.0, 255.255.0.0, 255.255.255.128…)
  var maskOK = function (s) { if (!ipOK(s)) return false; var w = (~ip2(s)) >>> 0; return (w & (w + 1)) === 0; };
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

  // Ports d'un appareil visible, dans l'ordre affiché sur le plan
  function targetsOf(id) {
    var n = N(id);
    if (!n) return [];
    var out = [], p;
    if (n.type === 'switch') { for (p = 0; p < SWITCH_PORTS; p++) out.push({ n: id, i: p }); return out; }
    if (isWifiRouter(n)) return [{ n: n.lan, i: 0 }, { n: n.lan, i: 1 }, { n: n.lan, i: 2 }, { n: n.lan, i: 3 }, { n: id, i: 1 }];
    if (n.type === 'router') return n.ifaces.map(function (f, k) { return { n: id, i: k }; });
    return [{ n: id, i: 0 }];
  }
  // Liens Wi-Fi : une machine en « sans fil » se connecte au routeur Wi-Fi dont le nom (SSID) est le sien.
  // Ces liens sont recalculés à chaque rafraîchissement, donc ils ne sont ni sauvegardés ni modifiables.
  function syncWifi() {
    LINKS = LINKS.filter(function (l) { return !l.wireless; });
    NODES.forEach(function (w) {
      if (!isWifiRouter(w) || !w.lan) return;
      NODES.forEach(function (h) {
        if (h.hidden || h.type === 'switch' || h.type === 'router') return;
        var f = h.ifaces && h.ifaces[0];
        if (!f || !f.wifi || !f.ssid || f.ssid !== w.ssid || f.pwd !== w.wifiPwd) return;
        if (linkAt(h.id, 0)) return;                     // déjà branchée par câble
        if (LINKS.some(function (l) { return l.wireless && l.a.n === h.id; })) return;
        // Ports 7 (interne) et 0 à 3 (câbles) exclus : les appareils sans fil prennent les ports libres à partir du 7e
        for (var i = SWITCH_PORTS - 2; i >= 0; i--) {
          if (!linkAt(w.lan, i)) { LINKS.push({ a: { n: h.id, i: 0 }, b: { n: w.lan, i: i }, wireless: true }); break; }
        }
      });
    });
  }
  // Routeur Wi-Fi auquel une machine est connectée (ou null)
  function wifiOf(h) {
    var l = LINKS.find(function (x) { return x.wireless && x.a.n === h.id; });
    if (!l) return null;
    return NODES.find(function (r) { return r.lan === l.b.n; }) || null;
  }
  // État Wi-Fi d'un appareil sans fil : routeur trouvé, réseau absent ou mot de passe incorrect
  function wifiState(h) {
    var f = h.ifaces && h.ifaces[0];
    if (!f || !f.wifi) return null;
    if (!f.ssid) return { ok: false, msg: 'Saisissez le nom du réseau (SSID).' };
    var r = NODES.find(function (w) { return isWifiRouter(w) && w.ssid === f.ssid; });
    if (!r) return { ok: false, msg: 'Réseau non trouvé : aucun routeur Wi-Fi ne diffuse « ' + f.ssid + ' ».' };
    if (r.wifiPwd !== f.pwd) return { ok: false, msg: 'Mot de passe incorrect pour le réseau « ' + f.ssid + ' ».' };
    return { ok: true, router: r };
  }
  // Adresses IP utilisées par plusieurs appareils : { adresse: [libellés] }
  function ipConflicts() {
    var seen = {}, out = {};
    NODES.forEach(function (n) {
      if (n.hidden || !n.ifaces) return;
      n.ifaces.forEach(function (f) { if (f.ip) (seen[f.ip] = seen[f.ip] || []).push(n.label); });
    });
    Object.keys(seen).forEach(function (ip) { if (seen[ip].length > 1) out[ip] = seen[ip]; });
    return out;
  }
  function freeTarget(id) {
    var ts = targetsOf(id);
    for (var k = 0; k < ts.length; k++) if (!linkAt(ts[k].n, ts[k].i)) return ts[k];
    return null;
  }
  function addLink(a, b) {
    if (!a || !b) return { ok: false, msg: 'Pas de port libre sur cet appareil.' };
    if (a.n === b.n) return { ok: false, msg: 'Impossible de relier un appareil à lui-même.' };
    // Un opérateur se branche toujours sur le port W (vers l'opérateur) de la box
    // Une box a des ports LAN portés par son commutateur caché : on remonte à la box
    function boxOf(id) { return NODES.find(function (x) { return x.kind === 'box' && (x.id === id || x.lan === id); }); }
    var opA = N(a.n) && N(a.n).kind === 'operator', opB = N(b.n) && N(b.n).kind === 'operator';
    var boxA = boxOf(a.n), boxB = boxOf(b.n);
    if ((opA && boxB) || (opB && boxA)) {
      if (opA) b = { n: boxB.id, i: 1 }; else a = { n: boxA.id, i: 1 };
    }
    if (linkAt(a.n, a.i) || linkAt(b.n, b.i)) return { ok: false, msg: 'Ce port est déjà branché.' };
    if (wirelessNode(N(a.n)) || wirelessNode(N(b.n))) return { ok: false, msg: (wirelessNode(N(a.n)) ? N(a.n) : N(b.n)).label + ' se connecte en Wi-Fi : il ne se relie pas par câble.' };
    LINKS.push({ a: { n: a.n, i: a.i }, b: { n: b.n, i: b.i } });
    // Port W de la box branché sur l'opérateur : la box reprend le DNS de l'opérateur
    var ends = [{ n: N(a.n), i: a.i }, { n: N(b.n), i: b.i }];
    var op = ends.find(function (x) { return x.n && x.n.kind === 'operator'; });
    var bx = ends.find(function (x) { return x.n && x.n.kind === 'box' && x.i === 1; });
    if (op && bx && op.n.ifaces[0].ip) bx.n.wanDns = op.n.ifaces[0].ip;
    return { ok: true };
  }

  // Livraison d'un paquet. Retourne {ok,msg,hops,src,dstNode}.
  function route(startId, srcIP, dstIP, pid) {
    var cur = startId, src = srcIP, dst = dstIP;
    var hops = [startId];
    for (var step = 0; step < 14; step++) {
      var node = N(cur);
      if (step === 0) {
        var cf = ipConflicts();
        var bad = cf[srcIP] || cf[dstIP];
        if (bad) return { ok: false, msg: 'Conflit d\'adresse IP : ' + (cf[srcIP] ? srcIP : dstIP) + ' est utilisée par ' + bad.join(' et ') + '.', hops: hops };
        if (node.type !== 'router' && node.ifaces[0] && node.ifaces[0].wifi && !linkAt(cur, 0)) {
          var ws = wifiState(node);
          return { ok: false, msg: ws && !ws.ok ? ws.msg : 'Connexion Wi-Fi impossible : aucun port libre sur le routeur.', hops: hops };
        }
      }
      if (node.ifaces.some(function (f) { return f.ip === dst; })) {
        if (node.type === 'router' && node.nat && node.nat[pid]) { dst = node.nat[pid]; }
        else return { ok: true, hops: hops, src: src, dstNode: cur };
      }
      var local = false;
      for (var i = 0; i < node.ifaces.length; i++) {
        var f = node.ifaces[i];
        if (!f.ip || !linkAt(cur, i) || !sameNet(f.ip, maskOf(f), dst)) continue;
        local = true;
        var seg = segment(cur, i);
        var m = null;
        for (var k = 0; k < seg.length; k++) {
          var e = seg[k];
          if (e.n !== cur && N(e.n).ifaces && N(e.n).ifaces[e.i] && N(e.n).ifaces[e.i].ip === dst) { m = e; break; }
        }
        if (!m) return { ok: false, msg: 'Délai d\'attente dépassé : aucune machine ne répond à ' + dst + ' sur son réseau.', hops: hops };
        if (node.type === 'router' && f.wan && !node.ifaces.some(function (g) { return g.ip === dst; })) {
          var inside = node.ifaces.some(function (g, j) { return j !== i && g.ip && sameNet(g.ip, maskOf(g), src); });
          if (inside) { node.nat = node.nat || {}; node.nat[pid] = src; src = f.ip; }
        }
        hops.push(m.n); cur = m.n; break;
      }
      if (local) continue;
      if (node.type !== 'router') {
        if (!node.gw) return { ok: false, msg: 'Impossible de joindre le réseau de destination.', hops: hops };
        if (!sameNet(node.gw, maskOf(node.ifaces[0]), node.ifaces[0].ip)) return { ok: false, msg: 'La passerelle ' + node.gw + ' n\'est pas dans mon réseau : vérifiez l\'adresse et le masque.', hops: hops };
        if (!linkAt(cur, 0)) return { ok: false, msg: 'Câble non branché.', hops: hops };
        var gseg = segment(cur, 0), g = null;
        for (var q = 0; q < gseg.length; q++) {
          var ge = gseg[q];
          if (N(ge.n).ifaces && N(ge.n).ifaces[ge.i] && N(ge.n).ifaces[ge.i].ip === node.gw) { g = ge; break; }
        }
        if (!g) return { ok: false, msg: 'La passerelle ' + node.gw + ' ne répond pas : aucun routeur de mon réseau porte cette adresse.', hops: hops };
        hops.push(g.n); cur = g.n; continue;
      }
      if (node.forward === false) return { ok: false, msg: 'Routage désactivé sur ' + node.label + '.', hops: hops };
      var gwIP = nextHopOf(node, dst);
      if (!gwIP) {
        var back = node.ifaces.filter(function (f3) { return f3.ip && sameNet(f3.ip, maskOf(f3), src); })[0] || node.ifaces[0];
        return { ok: false, msg: 'Destination inaccessible.', hops: hops, unreach: back.ip };
      }
      var out = -1, nh = null;
      for (var o = 0; o < node.ifaces.length && !nh; o++) {
        if (!linkAt(cur, o)) continue;
        var ss = segment(cur, o);
        for (var s2 = 0; s2 < ss.length; s2++) {
          var se = ss[s2];
          if (N(se.n).ifaces && N(se.n).ifaces[se.i] && N(se.n).ifaces[se.i].ip === gwIP) { out = o; nh = se; break; }
        }
      }
      if (!nh) return { ok: false, msg: 'La passerelle ' + gwIP + ' du routeur ' + node.label + ' est injoignable.', hops: hops };
      if (node.ifaces[out].wan) {
        var inside2 = node.ifaces.some(function (f2, j) { return j !== out && f2.ip && sameNet(f2.ip, maskOf(f2), src); });
        if (inside2) { node.nat = node.nat || {}; node.nat[pid] = src; src = node.ifaces[out].ip; }
      }
      hops.push(nh.n); cur = nh.n;
    }
    return { ok: false, msg: 'Trop de sauts : boucle de routage.', hops: hops };
  }

  // Journal des trames par machine : couche, source, destination, information (affiché dans « Échanges de données »)
  var TRAMES = {}, tseq = 0;
  function addTrame(hostId, layer, src, dst, info) {
    var list = TRAMES[hostId] = TRAMES[hostId] || [];
    list.push({ n: ++tseq, layer: layer, src: src, dst: dst, info: info });
    if (list.length > 200) list.shift();
    updateTrameApps(hostId);
  }
  // Une trame traverse les machines de son chemin : émission, transferts par les routeurs, réception
  var TTL_INIT = 128; // TTL initial d'un ordinateur Windows (capture de ping réelle)
  function ttlOf(hops) {
    return TTL_INIT - hops.filter(function (id, k) { var x = N(id); return k > 0 && x && x.type === 'router'; }).length;
  }
  function recordPath(hops, src, dst, info, sens) {
    hops.forEach(function (id, k) {
      var role = k === 0 ? 'Émission' : (k === hops.length - 1 ? 'Réception' : 'Transfert');
      addTrame(id, 'Internet', src, dst, sens + ' · ' + role + ' · TTL ' + ttlOf(hops.slice(0, k + 1)));
      if (k === 0 || k === hops.length - 1) addTrame(id, 'Application', src, dst, sens === 'Requête' ? info : 'Réponse : ' + info);
    });
  }
  function pingCore(srcId, dstIP, info) {
    var src = N(srcId);
    var srcIP = src.ifaces[0].ip;
    var pid = ++pidSeq;
    if (!srcIP) return { ok: false, msg: src.label + ' : pas d\'adresse IP configurée.', legs: [] };
    var r1 = route(srcId, srcIP, dstIP, pid);
    var what = info || 'ICMP écho (ping)';
    recordPath(r1.hops, srcIP, dstIP, what, 'Requête');
    var legs = [r1.hops];
    if (!r1.ok) return { ok: false, msg: r1.msg, legs: legs, unreach: r1.unreach };
    var r2 = route(r1.dstNode, dstIP, r1.src, pid);
    legs.push(r2.hops);
    recordPath(r2.hops, dstIP, srcIP, what, 'Réponse');
    if (!r2.ok) return { ok: false, msg: 'La requête arrive, mais la réponse ne revient pas : ' + r2.msg, legs: legs };
    return { ok: true, msg: 'Réponse de ' + dstIP, legs: legs, dstNode: r1.dstNode, ip: dstIP };
  }

  // Serveur DNS joignable à cette adresse (n'importe laquelle des interfaces du nœud)
  function dnsServerAt(ip) {
    return NODES.find(function (n) { return n.dnsSvc && (n.ifaces || []).some(function (f) { return f.ip === ip; }); });
  }
  // Enregistrements DNS éditables sous forme « nom=adresse, nom=adresse »
  var DNS_BOX_HELP = 'DNS fourni par l\'opérateur, repris automatiquement quand la box est branchée sur l\'opérateur. La box le transmet à ses appareils par DHCP. Modifiable.';
  function dnsText(n) { return Object.keys(n.records || {}).map(function (k) { return k + '=' + n.records[k]; }).join(', '); }
  function setRecords(n, text) {
    var r = {};
    text.split(',').forEach(function (p) { var kv = p.split('='); if (kv.length === 2 && kv[0].trim() && ipOK(kv[1].trim())) r[kv[0].trim()] = kv[1].trim(); });
    n.records = r;
  }

  function resolveCore(hostId, name) {
    var h = N(hostId);
    if (ipOK(name)) return { ok: true, ip: name };
    if (!h.dns) return { ok: false, msg: 'Nom « ' + name + ' » inconnu : aucun serveur DNS configuré sur ' + h.label + '.' };
    var dnsNode = dnsServerAt(h.dns);
    if (!dnsNode) return { ok: false, msg: 'Serveur DNS ' + h.dns + ' introuvable.' };
    // La requête DNS part sur le schéma : l'appelant doit faire voyager les paquets (r.legs) avant d'afficher le résultat
    var q = pingCore(hostId, h.dns, 'Requête DNS : ' + name);
    if (!q.ok) return { ok: false, msg: 'Serveur DNS injoignable. ' + q.msg, legs: q.legs };
    if (!svcRunning(dnsNode, 'dns')) return { ok: false, msg: 'Le service DNS est arrêté sur ' + dnsNode.label + '.', legs: q.legs };
    if (!dnsNode.records || !(name in dnsNode.records)) return { ok: false, msg: 'Le serveur DNS ne connaît pas « ' + name + ' ».', legs: q.legs };
    return { ok: true, ip: dnsNode.records[name], legs: q.legs };
  }

  /* ===================== DHCP ===================== */
  // Une machine demande une adresse au serveur DHCP branché sur son réseau local.
  // Le serveur lui réserve une adresse de sa plage, et lui transmet la passerelle et le DNS.
  function isHostType(n) { return n.type === 'pc' || n.type === 'notebook'; }
  function dhcpRequest(h) {
    if (!isHostType(h)) return { ok: false, msg: 'Seules les machines demandent une adresse.' };
    if (!linkAt(h.id, 0)) return { ok: false, msg: 'Câble non branché.' };
    var srv = null;
    segment(h.id, 0).forEach(function (e) { var x = N(e.n); if (!srv && x && x.dhcpSvc && e.i === 0) srv = x; });
    if (!srv) return { ok: false, msg: 'Aucun serveur DHCP sur ce réseau local. Branchez-le sur le même réseau (sans routeur entre les deux).' };
    if (!svcRunning(srv, 'dhcp')) return { ok: false, msg: 'Le service DHCP est arrêté sur ' + srv.label + '.' };
    if (!srv.ifaces[0].ip) return { ok: false, msg: srv.label + ' n\'a pas d\'adresse IP : il ne peut pas distribuer d\'adresses.' };
    if (!srv.pool || !srv.pool.start || !srv.pool.end) return { ok: false, msg: srv.label + ' : la plage d\'adresses n\'est pas configurée.' };
    if (ip2(srv.pool.start) > ip2(srv.pool.end)) return { ok: false, msg: 'Plage incohérente : la première adresse est après la dernière.' };
    var m = maskOf(srv.ifaces[0]);
    var addr = srv.leases[h.id];
    if (!addr) {
      var used = {};
      NODES.forEach(function (n) { (n.ifaces || []).forEach(function (f) { if (f.ip) used[f.ip] = true; }); });
      Object.keys(srv.leases).forEach(function (k) { used[srv.leases[k]] = true; });
      for (var v = ip2(srv.pool.start); v <= ip2(srv.pool.end) && !addr; v++) {
        var c = int2ip(v);
        if (!used[c]) addr = c;
      }
      if (!addr) return { ok: false, msg: 'Plage épuisée : ' + srv.label + ' n\'a plus d\'adresse libre.' };
      srv.leases[h.id] = addr;
    }
    h.ifaces[0].ip = addr;
    h.ifaces[0].mask = m;
    h.gw = srv.dhcpGw || '';
    // La box transmet le DNS fourni par l'opérateur quand aucun DNS n'est saisi à part
    h.dns = srv.dhcpDns || (srv.kind === 'box' ? srv.wanDns : '') || '';
    h.dhcp = true;
    return { ok: true, msg: 'Adresse ' + addr + ' attribuée par ' + srv.label + '.' };
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
  var WINS = [], wseq = 0, zseq = 10, deskZone = $('deskZone');
  // Fenêtre flottante : position mémorisée, déplacement par l'en-tête, passage au premier plan au clic
  function decorateWin(win, w, box) {
    // Entrée animée une seule fois, à l'ouverture (pas à chaque redessin)
    if (w.fresh) { win.classList.add('dwin-enter'); w.fresh = false; }
    if (w.x === undefined) {
      // Position par défaut : bureau dans le plan ; applications dans l'écran, à droite (terminal) ou au centre (installation)
      var k = w.type === 'desk' ? 0 : WINS.filter(function (x) { return x.host === w.host && x.type !== 'desk'; }).indexOf(w) % 5;
      var W = box.clientWidth || 470; // largeur d'un écran de bureau, quand il n'est pas encore dans la page
      if (w.type === 'desk') { w.x = 12; w.y = 12; }
      else if (w.type === 'term') { w.x = 14 + k * 16; w.y = 110 + k * 12; }
      else { w.x = Math.max(8, Math.min(W - 460 - 8, Math.round((W - 460) / 2) + k * 24)); w.y = 120 + k * 20; }
    }
    if ((w.type.indexOf('svc-') === 0 || w.type === 'fich' || w.type === 'img') && w.w === undefined) {
      // Fenêtre de service : elle reste entièrement dans l'écran du bureau de sa machine
      var dks = WINS.filter(function (x) { return x.type === 'desk' && x.host === w.host && x.w; })[0];
      var sw = dks ? dks.w - 2 : W; // l'écran du bureau n'est pas encore dans la page à sa construction
      w.w = Math.max(200, Math.min(440, sw - 16));
      w.x = Math.max(8, Math.min(w.x, sw - w.w - 8));
      var sh = dks ? dks.h - 34 : 420;
      w.h = Math.max(260, Math.min(460, sh - 40));
      w.y = Math.max(8, Math.min(w.y, sh - w.h - 8));
    }
    if (w.type === 'desk' && w.w === undefined) {
      // Le bureau occupe toute la zone de simulation par défaut
      w.w = Math.max(320, (box.clientWidth || 780) - 24); w.h = Math.max(220, (box.clientHeight || 520) - 24);
    }
    if (w.type === 'term' && w.w === undefined) {
      // Le terminal prend la place disponible dans l'écran du bureau
      // Taille de l'écran : celle du bureau de cette machine (l'écran n'est pas encore dans la page à sa construction)
      var dk = WINS.filter(function (x) { return x.type === 'desk' && x.host === w.host && x.w; })[0];
      var bw = dk ? dk.w - 2 : (box.clientWidth || 780), bh = dk ? dk.h - 34 : (box.clientHeight || 520);
      w.w = Math.max(420, bw - 28 - (w.x - 14)); w.h = Math.max(260, bh - 110 - 64);
    }
    win.style.left = w.x + 'px'; win.style.top = w.y + 'px';
    if (w.w) { win.style.width = w.w + 'px'; if (w.h) win.style.height = w.h + 'px'; }
    // Poignée en bas à droite : redimensionner la fenêtre pour suivre les paquets sur le plan
    var grip = document.createElement('div'); grip.className = 'dwin-grip'; grip.title = 'Redimensionner';
    win.appendChild(grip);
    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var sx = e.clientX, sy = e.clientY, ow = win.offsetWidth, oh = win.offsetHeight;
      grip.setPointerCapture(e.pointerId);
      var mv = function (ev) {
        var maxW = box.clientWidth - w.x - 4, maxH = box.clientHeight - w.y - 4;
        w.w = Math.max(320, Math.min(maxW, ow + ev.clientX - sx));
        w.h = Math.max(220, Math.min(maxH, oh + ev.clientY - sy));
        win.style.width = w.w + 'px'; win.style.height = w.h + 'px';
      };
      var up = function () { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
    });
    if (!w.z) w.z = ++zseq;
    win.style.zIndex = w.z;
    var raise = function () { if (w.z !== zseq) { w.z = ++zseq; win.style.zIndex = w.z; } };
    win.addEventListener('pointerdown', raise);
    var head = win.querySelector('.dwin-head');
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      var sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
      head.setPointerCapture(e.pointerId);
      var mv = function (ev) {
        w.x = Math.max(0, ox + ev.clientX - sx); w.y = Math.max(0, oy + ev.clientY - sy);
        win.style.left = w.x + 'px'; win.style.top = w.y + 'px';
      };
      var up = function () { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
    });
  }
  var mode = 'select', selected = null, pending = null, drag = null, busy = false, OUT = {};
  var BLOCKS = [], selBlock = null, bdrag = null, rdrag = null, layerBlocks = $('layerBlocks'), layerHandles = $('layerHandles');
  var fid = 0;
  var animSpeedEl = document.getElementById('animSpeed');
  if (animSpeedEl) animSpeedEl.addEventListener('input', function () { setAnimSpeed(animSpeedEl.value); });
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var KINDS = {
    pc: { label: 'Ordinateur', type: 'pc' },
    notebook: { label: 'Portable', type: 'notebook' },
    switch: { label: 'Switch', type: 'switch' },
    router: { label: 'Routeur', type: 'router' },
    wifi: { label: 'Routeur Wi-Fi', type: 'router', wifi: true },
    box: { label: 'Box internet', type: 'router', wifi: true, box: true },
    server: { label: 'Serveur', type: 'pc' },
    smartphone: { label: 'Smartphone', type: 'pc', sansFil: true },
    tablet: { label: 'Tablette', type: 'pc', sansFil: true },
    printer: { label: 'Imprimante', type: 'pc' },
    tv: { label: 'Smart TV', type: 'pc', sansFil: true },
    iot: { label: 'Enceinte connectée', type: 'pc', sansFil: true },
    // Nœuds virtuels : Internet n'est pas simulé en détail, ils représentent l'opérateur et les serveurs distants
    operator: { label: 'Opérateur internet', type: 'router', virtual: true, operator: true },
    datacenter: { label: 'Datacenter', type: 'pc', virtual: true },
  };
  // Routeur Wi-Fi ou Box : ils diffusent un réseau sans fil (SSID et mot de passe)
  function isWifiRouter(n) { return n.kind === 'wifi' || n.kind === 'box'; }

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  // warn : message d'alerte (réseau introuvable, erreur) affiché en couleur pour se voir
  function setStatus(msg, warn) { statusEl.textContent = msg; statusEl.classList.toggle('warn', !!warn); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  // Espace de travail du plan : assez grand pour que rien ne soit bloqué par une limite invisible
  var WORLD = { x0: -2500, x1: 2500, y0: -1800, y1: 1800 };
  function setPos(n, x, y) {
    n.x = x; n.y = y;
    if (n.lan) { var s = N(n.lan); if (s) { s.x = x; s.y = y; } }
  }

  function makeNode(kind, x, y) {
    var k = KINDS[kind];
    var n = { id: 'N' + (++seq), kind: kind, type: k.type, label: k.label, x: x, y: y };
    if (k.type === 'router') {
      n.ifaces = [{ ip: '' }, { ip: '', wan: true }]; n.defGw = '';
      if (k.wifi) {
        n.ssid = 'wifi'; n.wifiPwd = '1234';
        // Le réseau local du routeur Wi-Fi est un petit switch intégré (caché) relié à son interface 1
        var s = { id: 'N' + (++seq), kind: 'switch', type: 'switch', label: 'Commutateur Wi-Fi', x: x, y: y, hidden: true };
        NODES.push(s);
        n.lan = s.id;
        LINKS.push({ a: { n: n.id, i: 0 }, b: { n: s.id, i: SWITCH_PORTS - 1 } });
      }
      if (k.box) {
        // Box de l'opérateur : elle est la passerelle du réseau local et distribue les adresses (DHCP)
        n.ifaces[0].ip = '192.168.1.1'; n.ifaces[0].mask = '255.255.255.0';
        n.dhcpSvc = true; n.pool = { start: '192.168.1.10', end: '192.168.1.100' };
        n.dhcpGw = '192.168.1.1'; n.dhcpDns = ''; n.leases = {}; n.software = ['dhcp'];
      }
      if (k.operator) {
        // Opérateur : routeur de l'accès Internet, avec un service DNS qui connaît les sites publics
        n.ifaces[0].ip = '203.0.113.1'; n.ifaces[0].mask = '255.255.255.0';
        n.dnsSvc = true; n.records = {}; n.software = ['dns'];
      }
    } else if (k.type !== 'switch') {
      n.ifaces = [{ ip: '' }]; n.gw = ''; n.dns = '';
      if (k.sansFil) n.ifaces[0].wifi = true;
      if (k.web) n.web = true;
      if (k.dnsSvc) { n.dnsSvc = true; n.records = {}; }
      if (k.dhcpSvc) { n.dhcpSvc = true; n.pool = { start: '', end: '' }; n.dhcpGw = ''; n.dhcpDns = ''; n.leases = {}; }
    }
    return n;
  }
  // Emplacement libre : un appareil occupe environ 160 x 260 px (icône, nom et adresse)
  function freeSpot() {
    for (var row = 0; row < 4; row++) for (var col = 0; col < 6; col++) {
      var x = 100 + col * 170, y = 80 + row * 120;
      if (!NODES.some(function (n) { return !n.hidden && Math.abs(n.x - x) < 150 && Math.abs(n.y - y) < 130; })) return { x: x, y: y };
    }
    return { x: 450, y: 260 };
  }
  function addNode(kind) {
    if (isSim()) { setStatus('Plan verrouillé en mode simulation. Repassez en mode conception pour ajouter un appareil.'); return; }
    if (kind === 'block') { addBlock(); return; }
    var p = freeSpot();
    var n = makeNode(kind, p.x, p.y);
    NODES.push(n);
    selected = n.id;
    setStatus(n.label + ' ajouté. Configurez-le à droite.');
    refresh();
  }
  function removeNode(id) {
    var node = N(id);
    var gone = [id];
    if (node && node.lan) gone.push(node.lan);
    NODES = NODES.filter(function (n) { return gone.indexOf(n.id) < 0; });
    LINKS = LINKS.filter(function (l) { return gone.indexOf(l.a.n) < 0 && gone.indexOf(l.b.n) < 0; });
    if (gone.indexOf(selected) >= 0) selected = null;
    if (pending && gone.indexOf(pending.vis) >= 0) pending = null;
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
    } else if (k === 'wifi') {
      el('rect', { x: -40, y: -12, width: 80, height: 28, rx: 6, class: 'body' }, g);
      el('path', { d: 'M-12 -24 Q0 -34 12 -24 M-22 -32 Q0 -44 22 -32', class: 'lines' }, g);
      el('circle', { cx: 0, cy: -16, r: 3, class: 'dot' }, g);
      for (var j = -24; j <= 24; j += 24) el('circle', { cx: j, cy: 0, r: 3, class: 'dot' }, g);
    } else if (k === 'web') {
      el('circle', { cx: 0, cy: 0, r: 26, class: 'body' }, g);
      el('ellipse', { cx: 0, cy: 0, rx: 11, ry: 26, class: 'lines' }, g);
      el('line', { x1: -26, y1: 0, x2: 26, y2: 0, class: 'lines' }, g);
    } else if (k === 'dhcp') {
      el('rect', { x: -28, y: -22, width: 56, height: 44, rx: 6, class: 'body' }, g);
      el('path', { d: 'M-16 -10 H16 M-16 0 H16 M-16 10 H4', class: 'lines' }, g);
    } else if (k === 'server') {
      el('rect', { x: -22, y: -30, width: 44, height: 60, rx: 4, class: 'body' }, g);
      [-20, -6, 8].forEach(function (y) {
        el('rect', { x: -16, y: y, width: 32, height: 9, rx: 2, class: 'lines' }, g);
        el('circle', { cx: 11, cy: y + 4.5, r: 1.8, class: 'dot' }, g);
      });
    } else if (k === 'smartphone') {
      el('rect', { x: -15, y: -28, width: 30, height: 56, rx: 6, class: 'body' }, g);
      el('rect', { x: -10, y: -22, width: 20, height: 40, rx: 1, class: 'lines' }, g);
    } else if (k === 'tablet') {
      el('rect', { x: -22, y: -28, width: 44, height: 56, rx: 6, class: 'body' }, g);
      el('rect', { x: -17, y: -22, width: 34, height: 40, rx: 1, class: 'lines' }, g);
    } else if (k === 'printer') {
      el('rect', { x: -28, y: -6, width: 56, height: 26, rx: 4, class: 'body' }, g);
      el('rect', { x: -18, y: -26, width: 36, height: 20, class: 'body' }, g);
      el('circle', { cx: 20, cy: 6, r: 2.5, class: 'dot' }, g);
    } else if (k === 'tv') {
      el('rect', { x: -32, y: -22, width: 64, height: 38, rx: 4, class: 'body' }, g);
      el('path', { d: 'M-10 22 L10 22 M0 16 V22', class: 'lines' }, g);
    } else if (k === 'iot') {
      el('circle', { cx: 0, cy: 0, r: 16, class: 'body' }, g);
      el('path', { d: 'M-7 0 Q0 -7 7 0 M-12 -5 Q0 -17 12 -5', class: 'lines' }, g);
      el('circle', { cx: 0, cy: 6, r: 2, class: 'dot' }, g);
    } else if (k === 'operator') {
      el('path', { d: 'M-24 8 Q-38 8 -34 -4 Q-32 -18 -16 -14 Q-6 -30 10 -22 Q28 -24 28 -6 Q38 -2 34 8 Z', class: 'body' }, g);
      el('circle', { cx: 0, cy: -2, r: 5, class: 'lines' }, g);
    } else if (k === 'datacenter') {
      el('rect', { x: -28, y: -24, width: 56, height: 46, rx: 3, class: 'body' }, g);
      [-14, 0, 14].forEach(function (y) { el('line', { x1: -20, y1: y - 6, x2: 20, y2: y - 6, class: 'lines' }, g); el('circle', { cx: 16, cy: y - 8, r: 2, class: 'dot' }, g); });
    } else if (k === 'box') {
      el('rect', { x: -34, y: -8, width: 68, height: 26, rx: 5, class: 'body' }, g);
      el('path', { d: 'M-20 -8 L-26 -26 M20 -8 L26 -26', class: 'lines' }, g);
      el('circle', { cx: 0, cy: 5, r: 6, class: 'lines' }, g);
      el('circle', { cx: -20, cy: 5, r: 2.5, class: 'dot' }, g);
    } else {
      [-18, -3, 12].forEach(function (y) {
        el('rect', { x: -24, y: y, width: 48, height: 15, rx: 4, class: 'body' }, g);
        el('circle', { cx: 16, cy: y + 7.5, r: 2.2, class: 'dot' }, g);
      });
    }
  }

  // Emplacements des ports sur le plan (coordonnées locales de l'appareil)
  function portSpots(n) {
    var out = [];
    if (n.type === 'switch') {
      for (var p = 0; p < SWITCH_PORTS; p++) out.push({ x: -56 + p * 16, y: 38, t: String(p + 1) });
    } else if (isWifiRouter(n)) {
      [-48, -24, 0, 24].forEach(function (x, p) { out.push({ x: x, y: 40, t: String(p + 1) }); });
      out.push({ x: 48, y: 40, t: 'W' });
    } else if (n.type === 'router') {
      n.ifaces.forEach(function (f, j) { out.push({ x: (j - (n.ifaces.length - 1) / 2) * 26, y: -54, t: String(j + 1) }); });
    } else {
      out.push({ x: -56, y: 0, t: '' });
    }
    return out;
  }

  // Interface en cours de saisie : son câble est mis en vert pour repérer l'appareil relié
  var hiPort = null;
  function drawLinks() {
    layerLinks.textContent = '';
    LINKS.forEach(function (l) {
      var a = N(l.a.n), b = N(l.b.n);
      if (!a || !b) return;
      if (a.lan === b.id || b.lan === a.id) return; // liaison interne d'un routeur Wi-Fi, invisible
      if (l.wireless) { el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'cable wifi' }, layerLinks); return; }
      var hot = hiPort && ((l.a.n === hiPort.n && l.a.i === hiPort.i) || (l.b.n === hiPort.n && l.b.i === hiPort.i));
      var line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: hot ? 'cable hi' : 'cable' }, layerLinks);
      line.addEventListener('click', function (e) {
        if (mode === 'delete' && !isSim()) { e.stopPropagation(); removeLink(l); }
      });
      line.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (!isSim()) removeLink(l);
      });
    });
  }

  /* ----- Couleurs : un réseau = une couleur ; un port prend la couleur de son réseau ----- */
  var NET_COLS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#dc2626'];
  var NETC = {};
  function netKey(f) {
    if (!f || !f.ip) return null;
    var m = maskOf(f);
    return int2ip((ip2(f.ip) & ip2(m)) >>> 0) + '/' + prefixLen(m);
  }
  function buildNetColours() {
    NETC = {};
    var k = 0;
    NODES.forEach(function (n) {
      (n.ifaces || []).forEach(function (f) {
        var key = netKey(f);
        if (key && !NETC[key]) { NETC[key] = NET_COLS[k % NET_COLS.length]; k++; }
      });
    });
  }
  // Interface logique d'un port : routeur -> son interface, machine -> sa carte, switch -> aucune
  function ifaceOf(t) {
    var nd = N(t.n);
    if (!nd) return null;
    if (nd.hidden) { var p = NODES.find(function (x) { return x.lan === nd.id; }); return p ? p.ifaces[0] : null; }
    if (nd.type === 'switch') return null;
    if (nd.type === 'router') return nd.ifaces[t.i] || null;
    return nd.ifaces[0] || null;
  }
  function otherEnd(t) {
    var l = linkAt(t.n, t.i);
    if (!l) return null;
    return (l.a.n === t.n && l.a.i === t.i) ? l.b : l.a;
  }
  // Ce qu'il faut afficher pour un port : cls (classe CSS), key (réseau), label (info-bulle)
  function portState(t) {
    var nd = N(t.n);
    var isSw = !!nd && nd.type === 'switch' && !nd.hidden;
    var mine = ifaceOf(t);
    if (!linkAt(t.n, t.i)) {
      if (!isSw && mine && mine.ip) return { cls: 'nocable', key: null, label: 'libre : adresse configurée, pas de câble' };
      return { cls: 'free', key: null, label: 'libre' };
    }
    var ifc = mine;
    if (isSw) {
      var o = otherEnd(t);
      var on = o ? N(o.n) : null;
      if (on && (on.type === 'switch' || on.hidden)) return { cls: 'link', key: null, label: 'branché à un autre switch' };
      ifc = o ? ifaceOf(o) : null;
    }
    if (ifc && ifc.ip) { var key = netKey(ifc); return { cls: 'net', key: key, label: 'branché, réseau ' + key }; }
    return { cls: 'todo', key: null, label: 'branché, adresse à configurer' };
  }
  // Rôles d'un serveur, affichés sous son nom sur le plan
  function rolesOf(n) {
    var r = [];
    if (isWifiRouter(n)) { r.push('SSID : ' + (n.ssid || '—')); r.push('Mot de passe : ' + (n.wifiPwd || '—')); }
    if (n.web) r.push(svcRunning(n, 'web') ? 'WEB' : 'WEB arrêté');
    if (n.dnsSvc) r.push(svcRunning(n, 'dns') ? 'DNS' : 'DNS arrêté');
    if (n.dhcpSvc) r.push(svcRunning(n, 'dhcp') ? 'DHCP' : 'DHCP arrêté');
    return r;
  }
  function updateLegend() {
    var lg = $('legend');
    lg.textContent = '';
    var t = document.createElement('p'); t.className = 'legend-title'; t.textContent = 'Couleurs des ports';
    lg.appendChild(t);
    [['free', 'Port libre'], ['nocable', 'Adresse configurée, pas de câble'], ['todo', 'Branché, adresse à configurer']].forEach(function (r) {
      var row = document.createElement('p'); row.className = 'legend-row';
      var sw = document.createElement('span'); sw.className = 'sw sw-' + r[0];
      row.appendChild(sw); row.appendChild(document.createTextNode(r[1])); lg.appendChild(row);
    });
    var keys = Object.keys(NETC);
    if (keys.length) {
      var rt = document.createElement('p'); rt.className = 'legend-title'; rt.textContent = 'Réseaux';
      lg.appendChild(rt);
      keys.forEach(function (k) {
        var row = document.createElement('p'); row.className = 'legend-row';
        var sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = NETC[k]; sw.style.borderColor = NETC[k];
        row.appendChild(sw); row.appendChild(document.createTextNode(k)); lg.appendChild(row);
      });
    }
  }

  function drawNodes() {
    layerNodes.textContent = '';
    var cf = ipConflicts();
    NODES.forEach(function (n) {
      if (n.hidden) return;
      var clash = !!(n.ifaces && n.ifaces.some(function (f) { return f.ip && cf[f.ip]; }));
      var cls = 'dev k-' + n.kind + (selected === n.id ? ' sel' : '') + (pending && pending.vis === n.id ? ' pend' : '') + (clash ? ' conflict' : '');
      var g = el('g', { class: cls, transform: 'translate(' + n.x + ',' + n.y + ')', tabindex: '0', role: 'button', 'data-id': n.id, 'aria-label': n.label + ', ' + ipText(n) }, layerNodes);
      el('rect', { x: -80, y: -56, width: 160, height: 170, class: 'hit' }, g);
      var art = el('g', { filter: 'url(#shadow)', transform: 'scale(1.6)' }, g);
      drawIcon(art, n);
      // Étiquette placée sous le bas de l'icône (l'échelle 1.6 de l'icône est prise en compte)
      var ib = art.getBBox(), ly = Math.max(70, Math.ceil((ib.y + ib.height) * 1.6 + 24));
      var connected = LINKS.some(function (l) { return l.a.n === n.id || l.b.n === n.id; });
      el('circle', { cx: 44, cy: -44, r: 6, class: connected ? 'led on' : 'led' }, g);
      var lab = el('g', {}, g);
      var t1 = el('text', { x: 0, y: ly, class: 'nlab' }, lab); t1.textContent = n.label;
      var t2 = el('text', { x: 0, y: ly + 20, class: 'nip' }, lab); t2.textContent = ipText(n);
      var roles = rolesOf(n);
      if (roles.length) { var t3 = el('text', { x: 0, y: ly + 40, class: 'nroles' }, lab); t3.textContent = roles.join(' · '); }
      var bb = lab.getBBox();
      var pill = el('rect', { x: bb.x - 8, y: bb.y - 3, width: bb.width + 16, height: bb.height + 6, rx: 9, class: 'lab-bg' });
      lab.insertBefore(pill, t1);

      // Les ports sont toujours visibles (couleurs), mais ne réagissent qu'en mode Câble (voir CSS)
      var ts = targetsOf(n.id);
      portSpots(n).forEach(function (s, idx) {
        var t = ts[idx];
        if (!t) return;
        var st = portState(t);
        var isPend = pending && pending.vis === n.id && pending.idx === idx;
        var pg = el('g', { class: 'port ' + st.cls + (isPend ? ' pend' : ''), transform: 'translate(' + s.x + ',' + s.y + ')', 'data-vis': n.id, 'data-idx': idx }, g);
        if (st.cls === 'net' && st.key) pg.style.setProperty('--c', NETC[st.key] || '#64748b');
        el('circle', { r: 7 }, pg);
        if (s.t) { var tx = el('text', {}, pg); tx.textContent = s.t; }
        var tip = el('title', {}, pg);
        tip.textContent = s.t ? n.label + ' : port ' + s.t + ' (' + st.label + ')' : n.label + ' (' + st.label + ')';
        pg.addEventListener('click', function (e) { if (mode !== 'cable' || isSim()) return; e.stopPropagation(); if (!skipClick) handlePort(n.id, idx); });
        pg.addEventListener('pointerdown', function (e) {
          if (e.button !== 0 || mode !== 'cable' || isSim()) return;
          e.stopPropagation(); e.preventDefault();
          startCableDrag(n.id, idx);
        });
      });

      g.addEventListener('pointerdown', function (e) { onDown(e, n, g); });
      g.addEventListener('pointermove', function (e) { onMove(e, g); });
      g.addEventListener('pointerup', function (e) { onUp(e, n); });
      // Mode conception : double clic = outil « Déplacer et configurer » sur cet appareil
      g.addEventListener('dblclick', function () {
        if (isSim()) return;
        setMode('select'); selected = n.id; selBlock = null;
        setStatus('Configurez ' + n.label + ' à droite. Glissez l\'appareil pour le déplacer.');
        refresh();
      });
      // En simulation, un clic sur un ordinateur ouvre son bureau dans la zone dédiée
      g.addEventListener('click', function () {
        if (isSim()) { openWin('desk', n.id); return; }
        if (!skipClick && mode !== 'select') clickNode(n);
      });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickNode(n); }
      });
    });
    markTargets(currentSrc());
    if (!NODES.some(function (n) { return !n.hidden; })) {
      var hint = el('text', { x: 450, y: 260, class: 'empty', 'text-anchor': 'middle' }, layerNodes);
      hint.textContent = 'Ajoutez des appareils à gauche, ou chargez le scénario de la séance.';
    }
  }

  /* ----- Blocs nommés : une salle ou un réseau ----- */
  function drawBlocks() {
    layerBlocks.textContent = '';
    layerHandles.textContent = '';
    BLOCKS.forEach(function (b) {
      var g = el('g', { class: 'block' + (selBlock === b.id ? ' sel' : ''), 'data-block': b.id, transform: 'translate(' + b.x + ',' + b.y + ')' }, layerBlocks);
      el('rect', { x: 0, y: 0, width: b.w, height: b.h, rx: 14, class: 'block-box' }, g);
      var tagW = Math.max(70, b.label.length * 8.4 + 24);
      el('rect', { x: 14, y: -13, width: tagW, height: 26, rx: 13, class: 'block-tag' }, g);
      var t = el('text', { x: 14 + tagW / 2, y: 5, 'text-anchor': 'middle', class: 'block-label' }, g);
      t.textContent = b.label;
      // La poignée est dans sa propre couche, au-dessus des appareils
      var h = el('rect', { x: b.x + b.w - 18, y: b.y + b.h - 18, width: 14, height: 14, rx: 3, class: 'block-handle' }, layerHandles);
      g.__handle = h;
      g.addEventListener('pointerdown', function (e) { blockDown(e, b, g); });
      g.addEventListener('pointermove', function (e) { blockMove(e); });
      g.addEventListener('pointerup', function () { blockUp(); });
      g.addEventListener('click', function () { if (mode === 'delete' && !isSim()) removeBlock(b.id); });
      h.addEventListener('pointerdown', function (e) { resizeDown(e, b, g, h); });
      h.addEventListener('pointermove', function (e) { resizeMove(e, b, g, h); });
      h.addEventListener('pointerup', function () { resizeUp(); });
    });
  }
  function blockDown(e, b, g) {
    if (mode !== 'select' || isSim()) return;
    e.preventDefault(); e.stopPropagation();
    var p = toSvg(e);
    var members = NODES.filter(function (n) { return !n.hidden && n.x > b.x && n.x < b.x + b.w && n.y > b.y && n.y < b.y + b.h; })
      .map(function (n) { return { n: n, ox: n.x - b.x, oy: n.y - b.y }; });
    bdrag = { b: b, g: g, dx: p.x - b.x, dy: p.y - b.y, members: members, sx: e.clientX, sy: e.clientY, moved: false, count: members.length };
    selBlock = b.id; selected = null;
    g.setPointerCapture(e.pointerId);
  }
  function blockMove(e) {
    if (!bdrag) return;
    var d = bdrag, p = toSvg(e);
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    d.b.x = clamp(p.x - d.dx, WORLD.x0, WORLD.x1 - d.b.w);
    d.b.y = clamp(p.y - d.dy, WORLD.y0, WORLD.y1 - d.b.h);
    d.g.setAttribute('transform', 'translate(' + d.b.x + ',' + d.b.y + ')');
    d.g.__handle.setAttribute('x', d.b.x + d.b.w - 18); d.g.__handle.setAttribute('y', d.b.y + d.b.h - 18);
    d.members.forEach(function (m) { setPos(m.n, d.b.x + m.ox, d.b.y + m.oy); });
    drawLinks(); drawNodes();
  }
  function blockUp() {
    if (!bdrag) return;
    var d = bdrag; bdrag = null;
    if (d.moved) setStatus('Bloc déplacé' + (d.count ? ' avec ses ' + d.count + ' appareil(s).' : '.'));
    else setStatus('Bloc sélectionné : renommez-le à droite.');
    refresh();
  }
  function resizeDown(e, b, g, h) {
    if (mode !== 'select' || isSim()) return;
    e.preventDefault(); e.stopPropagation();
    rdrag = { b: b, g: g, h: h };
    h.setPointerCapture(e.pointerId);
  }
  function resizeMove(e, b, g, h) {
    if (!rdrag) return;
    var p = toSvg(e);
    b.w = clamp(p.x - b.x, 140, WORLD.x1 - b.x);
    b.h = clamp(p.y - b.y, 100, WORLD.y1 - b.y);
    g.querySelector('.block-box').setAttribute('width', b.w);
    g.querySelector('.block-box').setAttribute('height', b.h);
    h.setAttribute('x', b.x + b.w - 18); h.setAttribute('y', b.y + b.h - 18);
  }
  function resizeUp() { if (!rdrag) return; rdrag = null; refresh(); }
  function addBlock() {
    var p = freeSpot(), w = 240, h = 170;
    var b = { id: 'K' + (++seq), label: 'Nouveau bloc', x: clamp(p.x - w / 2, WORLD.x0, WORLD.x1 - w), y: clamp(p.y - h / 2, WORLD.y0, WORLD.y1 - h), w: w, h: h };
    BLOCKS.push(b);
    selBlock = b.id; selected = null;
    setStatus('Bloc ajouté. Renommez-le à droite, puis glissez-le pour y ranger des appareils.');
    refresh();
  }
  function removeBlock(id) {
    BLOCKS = BLOCKS.filter(function (b) { return b.id !== id; });
    if (selBlock === id) selBlock = null;
    setStatus('Bloc supprimé. Les appareils restent en place.');
    refresh();
  }
  function renderBlockProps(bl) {
    var help = document.createElement('p'); help.className = 'help';
    help.textContent = 'Un bloc regroupe des appareils, par exemple une salle ou un réseau.';
    propsEl.appendChild(help);
    field(propsEl, 'Nom du bloc', bl.label, function (inp) { bl.label = inp.value.trim() || bl.label; inp.value = bl.label; inp.defaultValue = bl.label; setStatus('Nom enregistré.'); draw(); }, 'Glissez le bloc pour déplacer aussi les appareils qu\'il contient. Poignée en bas à droite : redimensionner.');
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'danger'; del.textContent = 'Supprimer ce bloc';
    del.addEventListener('click', function () { removeBlock(bl.id); });
    propsEl.appendChild(del);
  }

  /* ----- Table de routage d'un routeur ----- */
  function int2ip(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.'); }
  function prefixLen(m) { var v = ip2(m), c = 0; while (v) { c += v & 1; v = v >>> 1; } return c; }
  // Passerelle à utiliser pour une destination hors des réseaux connectés : la route statique la plus précise, sinon la passerelle par défaut
  function nextHopOf(n, dst) {
    var best = null;
    (n.routes || []).forEach(function (r) {
      if (sameNet(dst, r.mask, r.dst) && (!best || prefixLen(r.mask) > prefixLen(best.mask))) best = r;
    });
    return best ? best.gw : (n.defGw || null);
  }
  function routingRows(n) {
    var rows = [{ dst: '127.0.0.0/8', via: 'directement connecté', iface: 'Boucle locale' }];
    n.ifaces.forEach(function (f, i) {
      if (!f.ip) return;
      var m = maskOf(f);
      rows.push({ dst: int2ip((ip2(f.ip) & ip2(m)) >>> 0) + '/' + prefixLen(m), via: 'directement connecté', iface: 'Interface ' + (i + 1) + (f.wan ? ' (WAN)' : '') });
      rows.push({ dst: f.ip + '/32', via: 'directement connecté', iface: 'Interface ' + (i + 1) });
    });
    (n.routes || []).forEach(function (r) {
      var o = -1;
      n.ifaces.forEach(function (f, i) { if (o < 0 && f.ip && sameNet(r.gw, maskOf(f), f.ip)) o = i; });
      rows.push({ dst: int2ip((ip2(r.dst) & ip2(r.mask)) >>> 0) + '/' + prefixLen(r.mask), via: r.gw, iface: o >= 0 ? 'Interface ' + (o + 1) : 'injoignable', route: r });
    });
    if (n.defGw) {
      var out = -1;
      n.ifaces.forEach(function (f, i) { if (out < 0 && f.ip && sameNet(n.defGw, maskOf(f), f.ip)) out = i; });
      rows.push({ dst: '0.0.0.0/0', via: n.defGw, iface: out >= 0 ? 'Interface ' + (out + 1) : 'injoignable' });
    }
    return rows;
  }
  // État des connexions des interfaces d'un routeur (vert : câblée et adressée ; orange : câblée sans adresse ; rouge : non câblée)
  function renderConnections(n, host) {
    var title = document.createElement('p'); title.className = 'area-label'; title.textContent = 'Gérer les connexions';
    host.appendChild(title);
    var t = document.createElement('table'); t.className = 'rtable conn-table';
    var head = t.createTHead().insertRow();
    ['Adresse IP', 'Réseau', 'État'].forEach(function (txt) { var th = document.createElement('th'); th.textContent = txt; head.appendChild(th); });
    var body = t.createTBody();
    n.ifaces.forEach(function (f, i) {
      var cabled = !!linkAt(n.id, i);
      var tr = body.insertRow();
      tr.insertCell().textContent = f.ip || '—';
      tr.insertCell().textContent = f.ip ? int2ip((ip2(f.ip) & ip2(maskOf(f))) >>> 0) + '/' + prefixLen(maskOf(f)) : '—';
      var st = tr.insertCell();
      var dot = document.createElement('span'); dot.className = 'conn-dot ' + (cabled && f.ip ? 'conn-ok' : cabled ? 'conn-warn' : 'conn-off');
      dot.setAttribute('aria-hidden', 'true');
      st.appendChild(dot);
      st.appendChild(document.createTextNode(cabled && f.ip ? 'Connectée' : cabled ? 'Sans adresse IP' : 'Non câblée'));
    });
    host.appendChild(t);
  }
  // Table de routage : les lignes connectées et la passerelle par défaut sont calculées ; les routes ajoutées ici sont modifiables
  function renderRoutingTable(n, host) {
    var title = document.createElement('p'); title.className = 'area-label'; title.textContent = 'Table de routage';
    host.appendChild(title);
    var sel = null;
    var wrap = document.createElement('div'); wrap.className = 'rt-wrap';
    var t = document.createElement('table'); t.className = 'rtable';
    var head = t.createTHead().insertRow();
    ['Destination', 'Passerelle', 'Sortie'].forEach(function (txt) { var th = document.createElement('th'); th.textContent = txt; head.appendChild(th); });
    var body = t.createTBody();
    wrap.appendChild(t); host.appendChild(wrap);
    function fill() {
      body.textContent = '';
      routingRows(n).forEach(function (r) {
        var tr = body.insertRow();
        if (r.route) {
          var on = r.route === sel;
          tr.tabIndex = 0; tr.className = (on ? 'sel' : '') + ' user';
          tr.setAttribute('aria-selected', on ? 'true' : 'false');
          var pick = function () { sel = r.route; fill(); };
          tr.addEventListener('click', pick);
          tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        }
        [r.dst, r.via, r.iface].forEach(function (txt) { var td = tr.insertCell(); td.textContent = txt; });
      });
    }
    var form = document.createElement('div'); form.className = 'route-form';
    var fh = document.createElement('p'); fh.className = 'area-label'; fh.textContent = 'Nouvelle ligne';
    form.appendChild(fh);
    var inputs = {};
    [['dst', 'Destination (adresse du réseau)', ''], ['mask', 'Masque', '255.255.255.0'], ['gw', 'Passerelle suivante', '']].forEach(function (f) {
      var wrapF = document.createElement('div'); wrapF.className = 'field';
      var lab = document.createElement('label'); lab.htmlFor = 'rt' + f[0] + (++fid); lab.textContent = f[1] + ' :';
      var inp = document.createElement('input'); inp.type = 'text'; inp.id = lab.htmlFor; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.placeholder = f[2];
      wrapF.appendChild(lab); wrapF.appendChild(inp); form.appendChild(wrapF);
      inputs[f[0]] = inp;
    });
    var btns = document.createElement('div'); btns.className = 'dns-btns';
    var add = document.createElement('button'); add.type = 'button'; add.textContent = 'Ajouter la ligne';
    var del = document.createElement('button'); del.type = 'button'; del.textContent = 'Supprimer la ligne sélectionnée';
    btns.appendChild(add); btns.appendChild(del); form.appendChild(btns);
    host.appendChild(form);
    add.addEventListener('click', function () {
      var dst = inputs.dst.value.trim(), mask = inputs.mask.value.trim() || '255.255.255.0', gw = inputs.gw.value.trim();
      if (!ipOK(dst)) { showFieldError(inputs.dst, 'Adresse de réseau invalide : exemple 192.168.5.0'); return; }
      clearFieldError(inputs.dst);
      if (!ipOK(mask)) { showFieldError(inputs.mask, 'Masque invalide : exemple 255.255.255.0'); return; }
      clearFieldError(inputs.mask);
      if (!ipOK(gw)) { showFieldError(inputs.gw, 'Passerelle invalide : exemple 192.168.0.254'); return; }
      clearFieldError(inputs.gw);
      n.routes = n.routes || [];
      var net = int2ip((ip2(dst) & ip2(mask)) >>> 0);
      n.routes = n.routes.filter(function (r) { return !(r.dst === net && r.mask === mask); });
      n.routes.push({ dst: net, mask: mask, gw: gw });
      sel = null; inputs.dst.value = ''; inputs.gw.value = '';
      setStatus('Route ajoutée : ' + net + '/' + prefixLen(mask) + ' via ' + gw + '.');
      fill();
    });
    del.addEventListener('click', function () {
      if (!sel) { setStatus('Sélectionnez une ligne ajoutée (non grisée) pour la supprimer.'); return; }
      n.routes = (n.routes || []).filter(function (r) { return r !== sel; });
      setStatus('Route supprimée.'); sel = null; fill();
    });
    fill();
  }

  function draw() { buildNetColours(); drawBlocks(); drawLinks(); drawNodes(); }

  // Plans d'avant : un « serveur » devient un ordinateur avec ses services installés
  function upgradeNode(n) {
    if (n.type !== 'server') return;
    n.type = 'pc'; n.kind = 'pc';
    n.software = n.software || [];
    if (n.web && n.software.indexOf('web') < 0) n.software.push('web');
    if (n.dnsSvc && n.software.indexOf('dns') < 0) n.software.push('dns');
    if (n.dhcpSvc && n.software.indexOf('dhcp') < 0) n.software.push('dhcp');
  }
  function refresh() {
    syncWifi();
    draw();
    renderProps();
    refreshHosts();
    syncModeButtons();
    updateBadge();
    updateLegend();
    renderDesk();
  }

  function toSvg(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function onDown(e, n, g) {
    if (mode !== 'select' || isSim()) return;
    e.preventDefault();
    selBlock = null;
    var p = toSvg(e);
    drag = { n: n, g: g, dx: p.x - n.x, dy: p.y - n.y, moved: false, sx: e.clientX, sy: e.clientY };
    g.setPointerCapture(e.pointerId);
  }
  function onMove(e, g) {
    if (!drag || drag.g !== g) return;
    var p = toSvg(e);
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
    setPos(drag.n, clamp(p.x - drag.dx, WORLD.x0, WORLD.x1), clamp(p.y - drag.dy, WORLD.y0, WORLD.y1));
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
      selected = n.id; selBlock = null;
      setStatus('Configurez ' + n.label + ' à droite. Glissez l\'appareil pour le déplacer.');
      refresh();
    } else if (mode === 'cable') {
      // Comme dans Filius : un clic sur un appareil, puis un clic sur un autre appareil ; le premier port libre est pris
      if (!pending) { pending = { vis: n.id, idx: null }; setStatus('Cliquez maintenant un autre appareil (ou un de ses ports).'); }
      else if (pending.vis === n.id) { pending = null; setStatus('Câblage annulé.'); }
      else linkDevices(pending.vis, pending.idx, n.id, null);
      refresh();
    } else if (mode === 'delete') {
      removeNode(n.id);
    }
  }

  // Premier port libre d'un appareil (indice dans targetsOf), ou -1
  function freePortIdx(visId) {
    var ts = targetsOf(visId);
    for (var k = 0; k < ts.length; k++) if (ts[k] && !linkAt(ts[k].n, ts[k].i)) return k;
    return -1;
  }
  // Relie deux appareils : idxA ou idxB est null pour prendre le premier port libre
  // Un appareil sans fil se connecte au routeur Wi-Fi, il ne se câble pas
  function wirelessNode(n) { return !!(n && n.ifaces && n.ifaces[0] && n.ifaces[0].wifi); }
  function wirelessLink(l) { return wirelessNode(N(l.a.n)) || wirelessNode(N(l.b.n)); }
  function linkDevices(visA, idxA, visB, idxB) {
    var a = idxA === null ? freePortIdx(visA) : idxA;
    var b = idxB === null ? freePortIdx(visB) : idxB;
    var na = N(visA), nb = N(visB);
    if (wirelessNode(na) || wirelessNode(nb)) { pending = null; setStatus((wirelessNode(na) ? na : nb).label + ' se connecte en Wi-Fi : il ne se relie pas par câble.'); refresh(); return; }
    if (a < 0) { pending = null; setStatus('Plus de port libre sur ' + na.label + '.'); return; }
    if (b < 0) { pending = null; setStatus('Plus de port libre sur ' + nb.label + '.'); return; }
    var r = addLink(targetsOf(visA)[a], targetsOf(visB)[b]);
    setStatus(r.ok ? 'Câble branché.' : r.msg);
    pending = null;
  }

  // Câblage : on clique un port (ou un appareil), puis un port (ou un appareil) de l'autre
  function handlePort(visId, idx) {
    var t = targetsOf(visId)[idx];
    if (!t) return;
    if (wirelessNode(N(visId))) { pending = null; setStatus(N(visId).label + ' se connecte en Wi-Fi : il ne se relie pas par câble.'); refresh(); return; }
    if (pending && pending.idx === null) {
      if (pending.vis === visId) { pending = null; setStatus('Câblage annulé.'); }
      else linkDevices(pending.vis, null, visId, idx);
    } else if (!pending) {
      if (linkAt(t.n, t.i)) { setStatus('Ce port est déjà branché. Choisissez-en un autre.'); }
      else { pending = { vis: visId, idx: idx }; setStatus('Cliquez maintenant un port de l\'autre appareil.'); }
    } else if (pending.vis === visId && pending.idx === idx) {
      pending = null;
      setStatus('Câblage annulé.');
    } else {
      linkDevices(pending.vis, pending.idx, visId, idx);
    }
    refresh();
  }

  /* ----- Câblage par glisser : on maintient le clic sur un port, puis on relâche sur un autre port ----- */
  var cableDrag = null, skipClick = false;
  function startCableDrag(visId, idx) {
    var t = targetsOf(visId)[idx];
    if (!t) return;
    if (wirelessNode(N(visId))) { setStatus(N(visId).label + ' se connecte en Wi-Fi : il ne se relie pas par câble.'); return; }
    if (linkAt(t.n, t.i)) { setStatus('Ce port est déjà branché. Choisissez-en un autre.'); return; }
    var dev = N(visId);
    var p = portSpots(dev)[idx];
    var line = el('line', { x1: dev.x + p.x, y1: dev.y + p.y, x2: dev.x + p.x, y2: dev.y + p.y, class: 'cable-tmp' }, layerPk);
    cableDrag = { vis: visId, idx: idx, line: line };
    setStatus('Relâchez le clic sur un port de l\'autre appareil.');
    $('planHint').textContent = 'Relâchez le clic sur un port bleu qui clignote (un port libre).';
    markTargets(cableDrag);
  }
  document.addEventListener('pointermove', function (e) {
    if (!cableDrag) return;
    var q = toSvg(e);
    cableDrag.line.setAttribute('x2', q.x);
    cableDrag.line.setAttribute('y2', q.y);
    // Le port survolé s'allume s'il est une cible valide
    var under = document.elementFromPoint(e.clientX, e.clientY);
    var pgHot = under && under.closest ? under.closest('.port') : null;
    layerNodes.querySelectorAll('.port.hot').forEach(function (x) { x.classList.remove('hot'); });
    if (pgHot && pgHot.classList.contains('target')) pgHot.classList.add('hot');
  });

  // Ports cibles : libres et sur un autre appareil que le port de départ
  function currentSrc() {
    if (cableDrag) return { vis: cableDrag.vis, idx: cableDrag.idx };
    return pending ? { vis: pending.vis, idx: pending.idx } : null;
  }
  function markTargets(src) {
    layerNodes.querySelectorAll('.port').forEach(function (pg) {
      pg.classList.remove('target', 'src', 'hot');
      if (!src) return;
      var vis = pg.getAttribute('data-vis'), idx = +pg.getAttribute('data-idx');
      if (vis === src.vis && idx === src.idx) { pg.classList.add('src'); return; }
      if (vis === src.vis) return;
      var t = targetsOf(vis)[idx];
      if (t && !linkAt(t.n, t.i)) pg.classList.add('target');
    });
  }
  document.addEventListener('pointerup', function (e) {
    if (!cableDrag) return;
    var d = cableDrag;
    cableDrag = null;
    d.line.remove();
    markTargets(null);
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    var target = null;
    var pgEl = hit && hit.closest ? hit.closest('.port') : null;
    if (pgEl) {
      target = { vis: pgEl.getAttribute('data-vis'), idx: +pgEl.getAttribute('data-idx') };
    } else {
      var devEl = hit && hit.closest ? hit.closest('.dev') : null;
      if (devEl && portSpots(N(devEl.getAttribute('data-id'))).length === 1) target = { vis: devEl.getAttribute('data-id'), idx: 0 };
    }
    if (target && target.vis === d.vis && target.idx === d.idx) return; // simple clic : géré par le clic-clic
    if (!target) { setStatus('Câblage annulé : relâchez le clic sur un port.'); refresh(); return; }
    var r = addLink(targetsOf(d.vis)[d.idx], targetsOf(target.vis)[target.idx]);
    setStatus(r.ok ? 'Câble branché.' : r.msg);
    skipClick = true;
    setTimeout(function () { skipClick = false; }, 0);
    refresh();
  });

  function syncModeButtons() {
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-mode') === mode ? 'true' : 'false');
    });
    svg.setAttribute('data-mode', mode);
  }
  function setMode(m) {
    if (isSim() && m !== 'select') { setStatus('Plan verrouillé en mode simulation.'); return; }
    mode = m; pending = null;
    setStatus(m === 'cable' ? 'Cliquez un appareil, puis un autre pour les relier. Clic droit sur le plan ou Échap pour sortir.' : m === 'delete' ? 'Cliquez un appareil ou un câble pour le supprimer. Échap pour sortir.' : 'Cliquez un appareil pour le configurer.');
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
  function maskChange(setter) {
    return function (inp) {
      var v = inp.value.trim();
      if (!maskOK(v)) { showFieldError(inp, 'Masque invalide. Exemples : 255.255.255.0 ou 255.255.0.0'); return; }
      clearFieldError(inp);
      setter(v);
      inp.defaultValue = v;
      setStatus('Enregistré.');
      draw();
      refreshHosts();
    };
  }
  // Erreur affichée sous le champ (relié par aria-describedby) ; la saisie est conservée pour être corrigée
  function showFieldError(inp, msg) {
    var wrap = inp.closest('.field'), id = inp.id + '-err';
    var e = wrap.querySelector('.field-error');
    if (!e) { e = document.createElement('p'); e.className = 'field-error'; wrap.appendChild(e); }
    e.id = id; e.textContent = msg;
    inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', id);
  }
  function clearFieldError(inp) {
    var e = inp.closest('.field') && inp.closest('.field').querySelector('.field-error');
    if (e) e.remove();
    inp.removeAttribute('aria-invalid'); inp.removeAttribute('aria-describedby');
  }
  function ipChange(setter) {
    return function (inp) {
      var v = inp.value.trim();
      if (v && !ipOK(v)) { showFieldError(inp, 'Adresse invalide. Exemple : 192.168.0.11'); return; }
      clearFieldError(inp);
      setter(v);
      inp.defaultValue = v;
      setStatus('Enregistré.');
      draw();
      refreshHosts();
      renderProps();
    };
  }

  // Un serveur peut tenir plusieurs rôles à la fois (web, DNS, DHCP) : on coche les services fournis
  // Réglages des services installés (ouverts depuis le bureau de la machine)
  function webFields(n, parent) {
    field(parent, 'Nom du site', n.siteName || SITE, function (inp) { n.siteName = inp.value.trim() || SITE; inp.value = n.siteName; setStatus('Nom du site enregistré.'); }, 'Le nom affiché sur la page d\'accueil du serveur.');
  }
  // Enregistrements du serveur DNS, sur le modèle de Filius : nom d'hôte / domaine et adresse IP
  function dnsFields(n, parent) {
    var sel = null;
    var h4 = document.createElement('h4'); h4.className = 'area-label'; h4.textContent = 'Adresse (A)';
    var nameF = document.createElement('div'); nameF.className = 'field';
    var nameLab = document.createElement('label'); nameLab.htmlFor = 'dnsName' + (++fid); nameLab.textContent = 'Nom d\'hôte / de domaine :';
    var nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.id = nameLab.htmlFor; nameInp.autocomplete = 'off'; nameInp.spellcheck = false;
    nameF.appendChild(nameLab); nameF.appendChild(nameInp);
    var ipF = document.createElement('div'); ipF.className = 'field';
    var ipLab = document.createElement('label'); ipLab.htmlFor = 'dnsIp' + (++fid); ipLab.textContent = 'Adresse IP :';
    var ipInp = document.createElement('input'); ipInp.type = 'text'; ipInp.id = ipLab.htmlFor; ipInp.autocomplete = 'off'; ipInp.spellcheck = false;
    ipF.appendChild(ipLab); ipF.appendChild(ipInp);
    var btns = document.createElement('div'); btns.className = 'dns-btns';
    var add = document.createElement('button'); add.type = 'button'; add.textContent = 'Ajouter';
    var del = document.createElement('button'); del.type = 'button'; del.textContent = 'Supprimer la sélection';
    btns.appendChild(add); btns.appendChild(del);
    var wrap = document.createElement('div'); wrap.className = 'dns-wrap';
    var table = document.createElement('table'); table.className = 'dns-table';
    table.innerHTML = '<thead><tr><th scope="col">Nom d\'hôte / de domaine</th><th scope="col">Adresse IP</th></tr></thead>';
    var tbody = document.createElement('tbody'); table.appendChild(tbody); wrap.appendChild(table);
    function rows() {
      tbody.textContent = '';
      var keys = Object.keys(n.records || {});
      if (!keys.length) { var tr0 = tbody.insertRow(); var td0 = tr0.insertCell(); td0.colSpan = 2; td0.className = 'dns-empty'; td0.textContent = 'Aucun enregistrement.'; return; }
      keys.forEach(function (k) {
        var tr = tbody.insertRow(); tr.tabIndex = 0;
        var on = k === sel;
        tr.className = on ? 'sel' : ''; tr.setAttribute('aria-selected', on ? 'true' : 'false');
        tr.insertCell().textContent = k; tr.insertCell().textContent = n.records[k];
        var pick = function () { sel = k; rows(); };
        tr.addEventListener('click', pick);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      });
    }
    add.addEventListener('click', function () {
      var name = nameInp.value.trim(), ip = ipInp.value.trim();
      if (!name) { setStatus('Saisissez un nom d\'hôte ou un domaine.'); nameInp.focus(); return; }
      if (!ipOK(ip)) { showFieldError(ipInp, 'Adresse IP invalide : exemple 192.168.21.1'); return; }
      clearFieldError(ipInp);
      n.records = n.records || {}; n.records[name] = ip; sel = null;
      nameInp.value = ''; ipInp.value = '';
      setStatus('Enregistrement ajouté : ' + name + ' → ' + ip + '.');
      rows();
    });
    del.addEventListener('click', function () {
      if (!sel) { setStatus('Sélectionnez un enregistrement dans la liste.'); return; }
      delete n.records[sel]; setStatus('Enregistrement supprimé : ' + sel + '.'); sel = null; rows();
    });
    parent.appendChild(h4); parent.appendChild(nameF); parent.appendChild(ipF); parent.appendChild(btns); parent.appendChild(wrap);
    rows();
  }
  function dhcpFields(n, parent) {
    var dhelp = document.createElement('p'); dhelp.className = 'help';
    dhelp.textContent = 'Le serveur distribue les adresses de sa plage aux machines de son réseau local qui le demandent.';
    parent.appendChild(dhelp);
    var poolChange = function (key) {
      return function (inp) {
        var v = inp.value.trim();
        if (v && !ipOK(v)) { setStatus('Adresse invalide : « ' + v + ' ».'); inp.value = inp.defaultValue; return; }
        n.pool[key] = v; inp.defaultValue = v; setStatus('Plage enregistrée.');
        draw();
      };
    };
    field(parent, 'Plage : première adresse', n.pool.start, poolChange('start'), 'Exemple : 192.168.0.100');
    field(parent, 'Plage : dernière adresse', n.pool.end, poolChange('end'), 'Exemple : 192.168.0.150');
    field(parent, 'Passerelle distribuée', n.dhcpGw, ipChange(function (v) { n.dhcpGw = v; }), 'Le routeur du réseau local, transmis aux machines.');
    field(parent, 'DNS distribué', n.dhcpDns, ipChange(function (v) { n.dhcpDns = v; }), 'Le serveur DNS, transmis aux machines.');
    var lt = document.createElement('p'); lt.className = 'area-label'; lt.textContent = 'Adresses attribuées';
    parent.appendChild(lt);
    var lids = Object.keys(n.leases || {});
    if (!lids.length) {
      var none = document.createElement('p'); none.className = 'help';
      none.textContent = 'Aucune adresse distribuée pour l\'instant.';
      parent.appendChild(none);
    } else {
      var lta = document.createElement('table'); lta.className = 'rtable';
      var lh = lta.createTHead().insertRow();
      ['Machine', 'Adresse'].forEach(function (txt) { var th = document.createElement('th'); th.textContent = txt; lh.appendChild(th); });
      var lb = lta.createTBody();
      lids.forEach(function (id) {
        var tr = lb.insertRow();
        var mach = N(id);
        [mach ? mach.label : id, n.leases[id]].forEach(function (txt) { var td = tr.insertCell(); td.textContent = txt; });
      });
      parent.appendChild(lta);
    }
  }

  // Onglet ouvert dans la configuration d'un routeur (conservé d'un clic à l'autre)
  var routerTab = 'iface';
  function renderProps() {
    hiPort = null;
    propsEl.textContent = '';
    var bl = selBlock ? BLOCKS.find(function (b) { return b.id === selBlock; }) : null;
    if (bl) { renderBlockProps(bl); return; }
    var n = N(selected);
    if (!n || n.hidden) {
      var p = document.createElement('p'); p.className = 'help';
      p.textContent = 'Cliquez sur un appareil du plan pour le configurer.';
      propsEl.appendChild(p);
      return;
    }
    var title = document.createElement('p'); title.className = 'props-title';
    title.textContent = n.label;
    propsEl.appendChild(title);

    field(propsEl, 'Nom', n.label, function (inp) { n.label = inp.value.trim() || n.label; inp.value = n.label; draw(); refreshHosts(); });
    var clashCf = ipConflicts(), clash = '';
    (n.ifaces || []).forEach(function (f) {
      if (f.ip && clashCf[f.ip]) clash = 'L\'adresse ' + f.ip + ' est aussi utilisée par ' + clashCf[f.ip].filter(function (l) { return l !== n.label; }).join(', ') + '.';
    });
    if (clash) { var cp = document.createElement('p'); cp.className = 'help'; cp.textContent = 'Conflit d\'adresse IP : ' + clash; propsEl.appendChild(cp); }

    if (n.type === 'switch') {
      var s = document.createElement('p'); s.className = 'help';
      s.textContent = 'Un switch relie les machines d\'un même réseau. Il n\'a pas d\'adresse à configurer.';
      propsEl.appendChild(s);
    } else if (isWifiRouter(n)) {
      var wi = document.createElement('p'); wi.className = 'help';
      wi.textContent = 'Ports 1 à 4 : réseau local (sans fil simulé par des câbles). Port W : vers l\'opérateur.';
      propsEl.appendChild(wi);
      field(propsEl, 'Mot de passe Wi-Fi', n.wifiPwd, function (inp) { n.wifiPwd = inp.value; setStatus('Mot de passe enregistré.'); draw(); refresh(); }, 'Les appareils sans fil doivent saisir ce même mot de passe.');
      field(propsEl, 'Nom du réseau Wi-Fi (SSID)', n.ssid, function (inp) { n.ssid = inp.value.trim(); setStatus('Nom du réseau enregistré.'); draw(); refresh(); }, 'Les machines en « sans fil » qui saisissent ce même nom se connectent à ce routeur.');
      field(propsEl, 'Réseau local : adresse IP', n.ifaces[0].ip, ipChange(function (v) { n.ifaces[0].ip = v; }), 'Passerelle des appareils du réseau local.');
      field(propsEl, 'Réseau local : masque', maskOf(n.ifaces[0]), maskChange(function (v) { n.ifaces[0].mask = v; }));
      field(propsEl, 'Côté opérateur : adresse IP', n.ifaces[1].ip, ipChange(function (v) { n.ifaces[1].ip = v; }));
      field(propsEl, 'Côté opérateur : masque', maskOf(n.ifaces[1]), maskChange(function (v) { n.ifaces[1].mask = v; }));
      field(propsEl, 'Route par défaut : passerelle', n.defGw, ipChange(function (v) { n.defGw = v; }), 'Adresse du routeur vers lequel envoyer ce qui ne reste pas dans les réseaux connus.');
      if (n.kind === 'box') field(propsEl, 'DNS de l\'opérateur', n.wanDns, ipChange(function (v) { n.wanDns = v; }), DNS_BOX_HELP);
    } else if (n.type === 'router') {
      var tabs = document.createElement('div'); tabs.className = 'ptabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Sections de configuration');
      var TABS = [['iface', 'Interfaces'], ['conn', 'Connexions'], ['route', 'Routes']];
      var panes = {}, tabBtns = {};
      var showPane = function (k) {
        TABS.forEach(function (t) {
          panes[t[0]].hidden = t[0] !== k;
          tabBtns[t[0]].setAttribute('aria-selected', t[0] === k ? 'true' : 'false');
          tabBtns[t[0]].tabIndex = t[0] === k ? 0 : -1;
        });
        routerTab = k;
      };
      TABS.forEach(function (t) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'ptab'; b.setAttribute('role', 'tab'); b.textContent = t[1];
        b.id = 'rtab-' + t[0]; b.setAttribute('aria-controls', 'rpane-' + t[0]);
        b.addEventListener('click', function () { showPane(t[0]); });
        tabBtns[t[0]] = b; tabs.appendChild(b);
        var pn = document.createElement('div'); pn.className = 'ppane'; pn.setAttribute('role', 'tabpanel');
        pn.id = 'rpane-' + t[0]; pn.setAttribute('aria-labelledby', 'rtab-' + t[0]);
        panes[t[0]] = pn;
      });
      tabs.addEventListener('keydown', function (e) {
        var ks = TABS.map(function (t) { return t[0]; }), i = ks.indexOf(routerTab), j;
        if (e.key === 'ArrowRight') j = (i + 1) % ks.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + ks.length) % ks.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = ks.length - 1;
        else return;
        e.preventDefault(); showPane(ks[j]); tabBtns[ks[j]].focus();
      });
      propsEl.appendChild(tabs);
      TABS.forEach(function (t) { propsEl.appendChild(panes[t[0]]); });
      var ip = panes.iface;
      n.ifaces.forEach(function (f, i) {
        var card = document.createElement('div'); card.className = 'iface-card';
        var setHi = function (on) { var v = on ? { n: n.id, i: i } : null; if (JSON.stringify(v) !== JSON.stringify(hiPort)) { hiPort = v; drawLinks(); } };
        card.addEventListener('focusin', function () { setHi(true); });
        card.addEventListener('focusout', function (e) { if (!card.contains(e.relatedTarget)) setHi(false); });
        card.addEventListener('mouseenter', function () { setHi(true); });
        card.addEventListener('mouseleave', function () { if (!card.contains(document.activeElement)) setHi(false); });
        var title = document.createElement('p'); title.className = 'iface-title';
        var titleText = function () { return 'Interface ' + (i + 1) + (f.wan ? ' · vers l\'opérateur' : ''); };
        title.textContent = titleText();
        card.appendChild(title);
        var pair = document.createElement('div'); pair.className = 'pair';
        field(pair, 'Adresse IP', f.ip, ipChange(function (v) { f.ip = v; }));
        field(pair, 'Masque', maskOf(f), maskChange(function (v) { f.mask = v; }));
        card.appendChild(pair);
        var wrap = document.createElement('div'); wrap.className = 'field check';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'f' + (++fid); cb.checked = !!f.wan;
        cb.addEventListener('change', function () { f.wan = cb.checked; title.textContent = titleText(); draw(); });
        var cl = document.createElement('label'); cl.htmlFor = cb.id; cl.textContent = 'Interface vers l\'opérateur (WAN)';
        wrap.appendChild(cb); wrap.appendChild(cl); card.appendChild(wrap);
        ip.appendChild(card);
      });
      var bar = document.createElement('div'); bar.className = 'iface-bar';
      var add = document.createElement('button'); add.type = 'button'; add.textContent = 'Ajouter une interface';
      add.addEventListener('click', function () { n.ifaces.push({ ip: '' }); setStatus('Interface ajoutée.'); refresh(); });
      var rem = document.createElement('button'); rem.type = 'button'; rem.textContent = 'Retirer la dernière';
      rem.disabled = n.ifaces.length <= 1 || linkAt(n.id, n.ifaces.length - 1);
      rem.addEventListener('click', function () { n.ifaces.pop(); setStatus('Interface retirée.'); refresh(); });
      bar.appendChild(add); bar.appendChild(rem); ip.appendChild(bar);
      field(ip, 'Route par défaut : passerelle', n.defGw, ipChange(function (v) { n.defGw = v; }), 'Adresse du routeur vers lequel envoyer ce qui ne reste pas dans les réseaux connus.');
      if (n.kind === 'box') field(ip, 'DNS de l\'opérateur', n.wanDns, ipChange(function (v) { n.wanDns = v; }), DNS_BOX_HELP);
      if (n.dnsSvc) field(ip, 'Enregistrements DNS', dnsText(n), function (inp) { setRecords(n, inp.value); setStatus('Enregistrements DNS mis à jour.'); draw(); }, 'Les noms connus de ce serveur, séparés par des virgules : nom=adresse. Ex. www.monsite-snt.fr=203.0.113.10');
      var fwWrap = document.createElement('div'); fwWrap.className = 'field check';
      var fwCb = document.createElement('input'); fwCb.type = 'checkbox'; fwCb.id = 'f' + (++fid); fwCb.checked = n.forward !== false;
      fwCb.addEventListener('change', function () { n.forward = fwCb.checked; setStatus(fwCb.checked ? 'Routage des paquets activé.' : 'Routage des paquets désactivé : les paquets ne traversent plus ce routeur.'); });
      var fwLab = document.createElement('label'); fwLab.htmlFor = fwCb.id; fwLab.textContent = 'Activer le routage des paquets';
      fwWrap.appendChild(fwCb); fwWrap.appendChild(fwLab); ip.appendChild(fwWrap);
      renderConnections(n, panes.conn);
      renderRoutingTable(n, panes.route);
      showPane(panes[routerTab] ? routerTab : 'iface');
    } else {
      var sv = document.createElement('p'); sv.className = 'help';
      sv.textContent = 'Les services (serveur web, DNS, DHCP) s\'installent sur le bureau de la machine, en simulation (clic sur l\'ordinateur).';
      propsEl.appendChild(sv);
      var f0 = n.ifaces[0];
      var wwrap = document.createElement('div'); wwrap.className = 'field check';
      var wcb = document.createElement('input'); wcb.type = 'checkbox'; wcb.id = 'f' + (++fid); wcb.checked = !!f0.wifi;
      wcb.addEventListener('change', function () {
        f0.wifi = wcb.checked;
        var removed = 0;
        if (wcb.checked) {
          // Un appareil sans fil ne garde aucun câble : on retire ceux qui étaient déjà branchés
          var before = LINKS.length;
          LINKS = LINKS.filter(function (l) { return l.wireless || (l.a.n !== n.id && l.b.n !== n.id); });
          removed = before - LINKS.length;
        }
        setStatus(wcb.checked ? 'Connexion sans fil : saisissez le nom du réseau.' + (removed ? ' Câble retiré.' : '') : 'Connexion filaire.');
        draw(); refresh();
      });
      var wcl = document.createElement('label'); wcl.htmlFor = wcb.id; wcl.textContent = 'Connexion sans fil (Wi-Fi)';
      wwrap.appendChild(wcb); wwrap.appendChild(wcl); propsEl.appendChild(wwrap);
      if (f0.wifi) {
        field(propsEl, 'Nom du réseau Wi-Fi (SSID)', f0.ssid, function (inp) { f0.ssid = inp.value.trim(); var stt = wifiState(n); setStatus(stt && !stt.ok ? stt.msg : 'Nom du réseau enregistré.', !!(stt && !stt.ok)); draw(); refresh(); });
        field(propsEl, 'Mot de passe Wi-Fi', f0.pwd, function (inp) { f0.pwd = inp.value; setStatus('Mot de passe enregistré.'); draw(); refresh(); });
        var w0 = wifiOf(n);
        var st = document.createElement('p'); st.className = 'help';
        var ws = wifiState(n); st.textContent = w0 ? 'Connecté au routeur Wi-Fi « ' + w0.label + ' ».' : ((ws || {}).msg || 'Pas de connexion.'); st.classList.toggle('warn', !w0 && !!ws && !ws.ok);
        propsEl.appendChild(st);
      }
      field(propsEl, 'Adresse IP', n.ifaces[0].ip, ipChange(function (v) { n.ifaces[0].ip = v; }));
      field(propsEl, 'Masque', maskOf(n.ifaces[0]), maskChange(function (v) { n.ifaces[0].mask = v; }), 'Les machines ayant les mêmes nombres (selon le masque) sont sur le même réseau. 255.255.255.0 : réseau /24.');
      if (isHostType(n)) {
        var dwrap = document.createElement('div'); dwrap.className = 'field check';
        var dcb = document.createElement('input'); dcb.type = 'checkbox'; dcb.id = 'f' + (++fid); dcb.checked = !!n.dhcp;
        dcb.addEventListener('change', function () {
          if (dcb.checked) { var r = dhcpRequest(n); setStatus(r.msg); if (!r.ok) n.dhcp = false; }
          else { n.dhcp = false; setStatus('DHCP désactivé : saisissez une adresse fixe.'); }
          draw(); refresh();
        });
        var dcl = document.createElement('label'); dcl.htmlFor = dcb.id; dcl.textContent = 'Obtenir automatiquement (DHCP)';
        dwrap.appendChild(dcb); dwrap.appendChild(dcl); propsEl.appendChild(dwrap);
        if (n.dhcp) {
          var rbar = document.createElement('div'); rbar.className = 'iface-bar';
          var renew = document.createElement('button');
          renew.type = 'button'; renew.textContent = 'Renouveler l\'adresse';
          renew.addEventListener('click', function () { var r = dhcpRequest(n); setStatus(r.msg); draw(); refresh(); });
          rbar.appendChild(renew); propsEl.appendChild(rbar);
        }
      }
      field(propsEl, 'Passerelle', n.gw, ipChange(function (v) { n.gw = v; }), 'Le routeur de mon réseau, pour sortir de mon réseau.');
      field(propsEl, 'DNS utilisé', n.dns, ipChange(function (v) { n.dns = v; }), 'Le serveur DNS interrogé par cette machine pour traduire un nom en adresse IP.');
    }

    var del = document.createElement('button');
    del.type = 'button'; del.className = 'danger'; del.textContent = 'Supprimer cet appareil';
    del.addEventListener('click', function () { removeNode(n.id); });
    propsEl.appendChild(del);
  }

  /* ----- Logiciels et bureaux (simulation) : comme dans Filius ----- */
  // Liste et noms repris de la fenêtre « Installation des logiciels » de Filius
  var SOFT = [
    { id: 'cmd', label: 'Ligne de commande', tile: '>_', cls: 'cmd' },
    { id: 'fich', label: 'Explorateur de fichiers', tile: 'Fi', cls: 'net' },
    { id: 'edit', label: 'Éditeur de textes', tile: 'Ed', cls: 'net' },
    { id: 'img', label: 'Afficheur d\'images', tile: 'Im', cls: 'net' },
    { id: 'dns', label: 'Serveur DNS', tile: 'DNS', cls: 'srv' },
    { id: 'dhcp', label: 'Serveur DHCP', tile: 'DHCP', cls: 'srv' },
    { id: 'web', label: 'Serveur web', tile: 'Web', cls: 'srv' },
    { id: 'nav', label: 'Navigateur web', tile: 'Nav', cls: 'net' }
  ];
  var softOf = function (id) { return SOFT.find(function (s) { return s.id === id; }); };
  // Interface en simulation selon l'appareil : pc (bureau complet), mobile (navigateur seul),
  // tv (état de connexion seul), none (pas d'interface : imprimante, enceinte connectée)
  function deskKind(h) {
    if (h.kind === 'smartphone' || h.kind === 'tablet') return 'mobile';
    if (h.kind === 'tv') return 'tv';
    if (h.kind === 'printer' || h.kind === 'iot') return 'none';
    return 'pc';
  }
  // Connecté au réseau : une adresse IP, et un câble ou un Wi-Fi valide
  function netOk(h) {
    var f = h.ifaces && h.ifaces[0];
    if (!f || !f.ip) return false;
    if (f.wifi) { var ws = wifiState(h); return !!(ws && ws.ok); }
    return !!linkAt(h.id, 0);
  }
  var hasSoft = function (n, id) { return (n.software || []).indexOf(id) >= 0; };
  // Installer ou désinstaller un logiciel. Serveur web et Serveur DNS fixent les services du serveur.
  // Fichier index.html du site, tel qu'il est au départ
  function defaultPage(n) {
    return '<h1>' + (n.siteName || SITE) + '</h1>\n<p>Bienvenue sur mon site.</p>';
  }
  // État d'un service (web, dns, dhcp) : en marche par défaut ; arrêté, il ne répond plus
  function svcRunning(n, kind) { return !(n.svcStop && n.svcStop[kind]); }
  function setSvcRunning(n, kind, on) { n.svcStop = n.svcStop || {}; n.svcStop[kind] = !on; }
  function setSoftware(n, id, on) {
    n.software = n.software || [];
    var i = n.software.indexOf(id);
    if (on && i < 0) n.software.push(id);
    if (!on && i >= 0) n.software.splice(i, 1);
    if (on && n.svcStop) delete n.svcStop[id];
    if (id === 'web') { n.web = on; if (on && !n.siteName) n.siteName = SITE; if (on && !n.pageHtml) n.pageHtml = defaultPage(n); }
    if (id === 'dns') { n.dnsSvc = on; if (on && !n.records) n.records = {}; }
    if (id === 'dhcp') {
      n.dhcpSvc = on;
      if (on) { if (!n.pool) n.pool = { start: '', end: '' }; if (n.dhcpGw === undefined) n.dhcpGw = ''; if (n.dhcpDns === undefined) n.dhcpDns = ''; if (!n.leases) n.leases = {}; }
    }
  }
  function openWin(type, hostId, extra) {
    if (!isSim()) return;
    var h = N(hostId);
    if (!h || h.type === 'switch' || h.type === 'router') return;
    if (type === 'desk' && deskKind(h) === 'none') { setStatus(h.label + ' : pas d\'interface en mode simulation.'); return; }
    var ex = WINS.find(function (w) { return w.type === type && w.host === hostId && (!extra || w.file === extra.file); });
    if (ex) ex.min = false;
    if (!ex) {
      ex = { id: ++wseq, type: type, host: hostId, pending: (h.software || []).slice(), sel: null, fresh: true };
      if (extra) { ex.file = extra.file; ex.folder = extra.folder; }
      if (type === 'fich') ex.folder = 'webserver';
      WINS.push(ex);
    }
    renderDesk();
  }
  function closeWin(id) {
    var c = WINS.find(function (w) { return w.id === id; });
    WINS = WINS.filter(function (w) { return w.id !== id && !(c && c.type === 'desk' && w.host === c.host && w.type !== 'desk'); });
    renderDesk();
  }
  var ICON_MIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_SCREEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v12H3z M8 20h8 M12 16v4"/></svg>';
  // En-tête de fenêtre : titre, réduire (vers la barre du bas), fermer
  // Réduire : la fenêtre rejoint la barre des tâches de son bureau (ou le coin du bureau pour un bureau réduit)
  var TASK_NAMES = { term: 'Ligne de commande', nav: 'Navigateur web', edit: 'Éditeur de textes', trames: 'Échanges de données', install: 'Installation', 'svc-web': 'Serveur web', 'svc-dns': 'Serveur DNS', 'svc-dhcp': 'DHCP', fich: 'Explorateur de fichiers', img: 'Afficheur d\'images' };
  // Pastilles reprises des icônes du bureau, pour la barre des tâches
  var TASK_TILES = { term: { tile: '>_', cls: 'cmd' }, nav: { tile: 'Nav', cls: 'net' }, edit: { tile: 'Ed', cls: 'net' }, trames: { tile: 'Tr', cls: 'net' }, install: { tile: '+', cls: 'inst' }, 'svc-web': { tile: 'Web', cls: 'srv' }, 'svc-dns': { tile: 'DNS', cls: 'srv' }, 'svc-dhcp': { tile: 'DHCP', cls: 'srv' }, fich: { tile: 'Fi', cls: 'net' }, img: { tile: 'Im', cls: 'net' } };
  function minimizeWin(btn, w) {
    var el = btn.closest('.dwin');
    if (!el || reducedMotion()) { w.min = true; renderDesk(); return; }
    var screen = el.closest('.desk-screen'), r = el.getBoundingClientRect(), tgt;
    if (screen && screen.querySelector('.taskbar')) {
      var tb = screen.querySelector('.taskbar').getBoundingClientRect();
      tgt = { x: tb.left + 60, y: tb.top + tb.height / 2 };
    } else {
      var zr = deskZone.getBoundingClientRect();
      tgt = { x: zr.right - 30, y: zr.top + 20 };
    }
    el.style.setProperty('--dx', (tgt.x - (r.left + r.width / 2)) + 'px');
    el.style.setProperty('--dy', (tgt.y - (r.top + r.height / 2)) + 'px');
    el.style.pointerEvents = 'none';
    el.classList.add('dwin-min-anim');
    var done = false;
    var finish = function () { if (done) return; done = true; w.min = true; renderDesk(); };
    el.addEventListener('animationend', function (e) { if (e.target === el) finish(); });
    setTimeout(finish, 260);
  }
  // Fermer : la fenêtre s'estompe avant d'être retirée (sans mouvement si « réduire les animations »)
  function closeAnimated(btn, id) {
    var el = btn.closest('.dwin');
    if (!el || reducedMotion()) { closeWin(id); return; }
    el.style.pointerEvents = 'none';
    el.classList.add('dwin-leave');
    var done = false;
    var fin = function () { if (done) return; done = true; el.removeEventListener('transitionend', onEnd); closeWin(id); };
    // Seule la fin de la transition de la fenêtre compte (pas celle d'un bouton à l'intérieur, qui remonte jusqu'ici)
    var onEnd = function (e) { if (e.target === el) fin(); };
    el.addEventListener('transitionend', onEnd);
    setTimeout(fin, 220);
  }
  function winHead(w, title, canMin) {
    var head = document.createElement('div'); head.className = 'dwin-head';
    var t = document.createElement('span'); t.textContent = title;
    var ctl = document.createElement('div'); ctl.className = 'dwin-ctl';
    var min = document.createElement('button'); min.type = 'button'; min.className = 'dwin-btn'; min.innerHTML = ICON_MIN;
    min.setAttribute('aria-label', 'Réduire'); min.title = 'Réduire';
    min.addEventListener('click', function () { minimizeWin(min, w); });
    var close = document.createElement('button'); close.type = 'button'; close.className = 'dwin-btn'; close.innerHTML = ICON_CLOSE;
    close.setAttribute('aria-label', 'Fermer'); close.title = 'Fermer';
    close.addEventListener('click', function () { closeAnimated(close, w.id); });
    if (canMin !== false) ctl.appendChild(min);
    ctl.appendChild(close);
    head.appendChild(t); head.appendChild(ctl);
    return head;
  }
  // Bureau d'un ordinateur : fond, icônes, barre des tâches (comme un vrai écran)
  // Réglage d'un service installé, dans le bureau
  function buildSvc(w, box) {
    var h = N(w.host);
    var kind = w.type.slice(4);
    var titles = { web: 'Serveur web', dns: 'Serveur DNS', dhcp: 'Serveur DHCP' };
    var win = document.createElement('section'); win.className = 'dwin app svc'; win.setAttribute('aria-label', titles[kind] + ' de ' + h.label);
    win.appendChild(winHead(w, h.label.toLowerCase() === titles[kind].toLowerCase() ? titles[kind] : titles[kind] + ' · ' + h.label));
    var body = document.createElement('div'); body.className = 'dwin-body';
    // Démarrer ou arrêter le service : un service arrêté ne répond plus aux machines
    var running = svcRunning(h, kind);
    var state = document.createElement('div'); state.className = 'svc-state';
    var stText = document.createElement('p'); stText.className = 'svc-status';
    stText.textContent = running ? 'Service en marche.' : 'Service arrêté : les machines ne peuvent pas l\'utiliser.';
    var stBtn = document.createElement('button'); stBtn.type = 'button'; stBtn.className = 'dwin-apply';
    stBtn.textContent = running ? 'Arrêter le service' : 'Démarrer le service';
    stBtn.addEventListener('click', function () {
      setSvcRunning(h, kind, !svcRunning(h, kind));
      setStatus(titles[kind] + ' ' + (svcRunning(h, kind) ? 'démarré' : 'arrêté') + ' sur ' + h.label + '.');
      draw();
      renderDesk();
    });
    state.appendChild(stText); state.appendChild(stBtn);
    body.appendChild(state);
    if (kind === 'web') webFields(h, body);
    if (kind === 'dns') dnsFields(h, body);
    if (kind === 'dhcp') dhcpFields(h, body);
    win.appendChild(body);
    decorateWin(win, w, box);
    return win;
  }
  // Éditeur de textes : modifie le fichier index.html du site de la machine
  /* ----- Fichiers des machines : explorateur et afficheur d'images ----- */
  var MAX_IMG = 200 * 1024; // taille maximale d'une image importée, en octets
  function filesOf(n, folder) { n.files = n.files || {}; n.files[folder] = n.files[folder] || {}; return n.files[folder]; }
  // Dans la page publiée, une image est référencée par son nom : on la remplace par l'image importée
  function withImages(srv, html) {
    var imgs = (srv.files && srv.files.webserver) || {};
    Object.keys(imgs).forEach(function (name) {
      var esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp('(src=["\'])' + esc + '(["\'])', 'g'), function (m, a, b) { return a + imgs[name].data + b; });
    });
    return html;
  }
  function buildFich(w, box) {
    var h = N(w.host);
    var win = document.createElement('section'); win.className = 'dwin app fich'; win.setAttribute('aria-label', 'Explorateur de fichiers de ' + h.label);
    win.appendChild(winHead(w, 'Explorateur de fichiers · ' + h.label));
    var body = document.createElement('div'); body.className = 'dwin-body fich-body';
    var bar = document.createElement('div'); bar.className = 'dns-btns';
    var refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Actualiser';
    var imp = document.createElement('button'); imp.type = 'button'; imp.textContent = 'Importer une image';
    var file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp'; file.className = 'fich-file'; file.tabIndex = -1;
    file.setAttribute('aria-hidden', 'true');
    bar.appendChild(refresh); bar.appendChild(imp); bar.appendChild(file);
    var cols = document.createElement('div'); cols.className = 'fich-cols';
    var tree = document.createElement('div'); tree.className = 'fich-tree'; tree.setAttribute('aria-label', 'Dossiers');
    var list = document.createElement('div'); list.className = 'fich-list'; list.setAttribute('aria-label', 'Fichiers du dossier');
    cols.appendChild(tree); cols.appendChild(list);
    body.appendChild(bar); body.appendChild(cols);
    win.appendChild(body);
    function renderTree() {
      tree.textContent = '';
      [['root', 'root', 0], ['dns', 'dns', 1], ['webserver', 'webserver', 1]].forEach(function (f) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'fich-folder' + (w.folder === f[0] ? ' on' : '');
        b.style.paddingLeft = (8 + f[2] * 16) + 'px';
        b.textContent = (f[2] ? '▸ ' : '') + f[1];
        b.setAttribute('aria-pressed', w.folder === f[0] ? 'true' : 'false');
        b.addEventListener('click', function () { w.folder = f[0]; renderTree(); renderList(); });
        tree.appendChild(b);
      });
    }
    function renderList() {
      list.textContent = '';
      if (w.folder === 'root') { note('Choisissez un dossier.'); return; }
      var items = [];
      if (w.folder === 'webserver') items.push({ name: 'index.html', kind: 'html' });
      var f = (h.files && h.files[w.folder]) || {};
      Object.keys(f).forEach(function (k) { items.push({ name: k, kind: f[k].kind }); });
      if (!items.length) { note('Dossier vide.'); return; }
      items.forEach(function (it) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'fich-item';
        b.textContent = it.name;
        var k = document.createElement('small'); k.textContent = it.kind === 'html' ? 'page web' : 'image';
        b.appendChild(k);
        b.addEventListener('click', function () {
          if (it.kind === 'html') openWin('edit', h.id);
          else openWin('img', h.id, { file: it.name, folder: w.folder });
        });
        list.appendChild(b);
      });
    }
    function note(txt) { var p = document.createElement('p'); p.className = 'fich-note'; p.textContent = txt; list.appendChild(p); }
    refresh.addEventListener('click', function () { renderList(); setStatus('Dossier actualisé.'); });
    imp.addEventListener('click', function () {
      if (w.folder === 'root') { setStatus('Choisissez d\'abord un dossier pour importer une image.'); return; }
      file.click();
    });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) { setStatus('Seules les images peuvent être importées.'); return; }
      if (f.size > MAX_IMG) { setStatus('Image trop lourde : 200 Ko maximum.'); return; }
      if (f.name === 'index.html') { setStatus('Ce nom est réservé à la page du serveur web.'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        filesOf(h, w.folder)[f.name] = { kind: 'image', data: reader.result };
        setStatus('Image importée : ' + f.name + '.');
        renderList();
      };
      reader.readAsDataURL(f);
    });
    renderTree(); renderList();
    decorateWin(win, w, box);
    return win;
  }
  function buildImg(w, box) {
    var h = N(w.host);
    var win = document.createElement('section'); win.className = 'dwin app img'; win.setAttribute('aria-label', 'Afficheur d\'images : ' + w.file);
    win.appendChild(winHead(w, w.file));
    var body = document.createElement('div'); body.className = 'dwin-body img-body';
    var rec = h.files && h.files[w.folder] && h.files[w.folder][w.file];
    if (rec) {
      var im = document.createElement('img'); im.className = 'img-view'; im.src = rec.data; im.alt = w.file;
      body.appendChild(im);
    } else {
      var p = document.createElement('p'); p.className = 'fich-note'; p.textContent = 'Fichier introuvable.';
      body.appendChild(p);
    }
    win.appendChild(body);
    decorateWin(win, w, box);
    return win;
  }
  function buildEdit(w, box) {
    var h = N(w.host);
    var win = document.createElement('section'); win.className = 'dwin app edit'; win.setAttribute('aria-label', 'Éditeur de textes de ' + h.label);
    win.appendChild(winHead(w, 'Éditeur de textes · ' + h.label));
    var body = document.createElement('div'); body.className = 'dwin-body edit-body';
    var name = document.createElement('p'); name.className = 'edit-name';
    name.textContent = 'index.html' + (hasSoft(h, 'web') ? ' · publié par le serveur web' : ' · pas de serveur web : fichier non publié');
    var ta = document.createElement('textarea'); ta.spellcheck = false; ta.setAttribute('aria-label', 'Contenu de index.html');
    ta.value = h.pageHtml || defaultPage(h);
    var save = document.createElement('button'); save.type = 'button'; save.className = 'edit-save'; save.textContent = 'Enregistrer';
    save.addEventListener('click', function () { h.pageHtml = ta.value; setStatus('index.html enregistré sur ' + h.label + '.'); });
    body.appendChild(name); body.appendChild(ta); body.appendChild(save);
    win.appendChild(body);
    decorateWin(win, w, box);
    return win;
  }
  function trameRows(tbody, hostId) {
    tbody.textContent = '';
    var list = (TRAMES[hostId] || []).slice().reverse().slice(0, 80);
    if (!list.length) {
      var tr0 = tbody.insertRow(); var td0 = tr0.insertCell(); td0.colSpan = 5; td0.className = 'trames-empty';
      td0.textContent = 'Aucune trame pour l\'instant. Lancez un ping, une page web ou un traceroute.';
      return;
    }
    list.forEach(function (t) {
      var tr = tbody.insertRow();
      [t.n, t.layer, t.src, t.dst, t.info].forEach(function (txt) { var td = tr.insertCell(); td.textContent = txt; });
    });
  }
  // Fenêtre « Échanges de données » : les trames vues par cette machine, couche par couche
  function buildTrames(w, box) {
    var h = N(w.host);
    var win = document.createElement('section'); win.className = 'dwin app trames-app'; win.setAttribute('data-host', h.id);
    win.setAttribute('aria-label', 'Échanges de données de ' + h.label);
    win.appendChild(winHead(w, 'Échanges de données · ' + h.label));
    var body = document.createElement('div'); body.className = 'dwin-body trames-body';
    var tbl = document.createElement('table'); tbl.className = 'rtable trames-table';
    var head = tbl.createTHead().insertRow();
    ['N°', 'Couche', 'Source', 'Destination', 'Information'].forEach(function (txt) { var th = document.createElement('th'); th.textContent = txt; head.appendChild(th); });
    trameRows(tbl.createTBody(), h.id);
    body.appendChild(tbl); win.appendChild(body);
    decorateWin(win, w, box);
    return win;
  }
  function updateTrameApps(hostId) {
    if (!deskZone) return;
    deskZone.querySelectorAll('.trames-app').forEach(function (t) {
      if (t.getAttribute('data-host') === hostId) trameRows(t.querySelector('tbody'), hostId);
    });
  }
  // Fenêtre du navigateur web dans le bureau
  function buildNav(w, box) {
    var h = N(w.host);
    var win = document.createElement('section'); win.className = 'dwin app nav'; win.setAttribute('aria-label', 'Navigateur web de ' + h.label);
    win.appendChild(winHead(w, 'Navigateur web · ' + h.label));
    var body = document.createElement('div'); body.className = 'dwin-body nav-body';
    var bar = document.createElement('form'); bar.className = 'nav-bar';
    var inp = document.createElement('input'); inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.placeholder = 'www.monsite-snt.fr'; inp.value = w.url || ''; inp.setAttribute('aria-label', 'Adresse à ouvrir');
    inp.addEventListener('input', function () { w.url = inp.value; });
    var go = document.createElement('button'); go.type = 'submit'; go.title = 'Ouvrir cette adresse'; go.setAttribute('aria-label', 'Ouvrir');
    go.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14 M13 6l6 6-6 6"/></svg>';
    bar.addEventListener('submit', function (e) { e.preventDefault(); browse(w, inp.value); });
    bar.appendChild(inp); bar.appendChild(go);
    var view = document.createElement('div'); view.className = 'nav-view';
    var st = w.state;
    if (!st) {
      var hint = document.createElement('p'); hint.className = 'nav-hint';
      hint.textContent = 'Saisissez une adresse, par exemple www.monsite-snt.fr. Le navigateur demande d\'abord l\'adresse IP au serveur DNS, puis envoie la requête au serveur web.';
      view.appendChild(hint);
    } else if (st.page) {
      var page = document.createElement('div'); page.className = 'nav-page';
      var p1 = document.createElement('p'); p1.className = 'nav-url'; p1.textContent = st.page.name + ' · ' + st.page.ip;
      // Rendu du fichier index.html dans un cadre sans script (sandbox vide)
      var frame = document.createElement('iframe'); frame.className = 'nav-frame'; frame.setAttribute('sandbox', '');
      frame.setAttribute('title', 'Page ' + st.page.name); frame.srcdoc = st.page.html || '';
      page.appendChild(p1); page.appendChild(frame);
      if (st.page.https) { var p2 = document.createElement('p'); p2.className = 'nav-note'; p2.textContent = 'Connexion HTTPS : l\'échange est chiffré (chiffrement non simulé ici).'; page.appendChild(p2); }
      view.appendChild(page);
    } else if (st.error) {
      var err = document.createElement('div'); err.className = 'nav-error';
      var eh = document.createElement('h3'); eh.textContent = st.status;
      var ep = document.createElement('p'); ep.textContent = st.error;
      err.appendChild(eh); err.appendChild(ep); view.appendChild(err);
    }
    var sbar = document.createElement('p'); sbar.className = 'nav-status'; sbar.setAttribute('role', 'status');
    sbar.textContent = st && st.status ? st.status : '';
    body.appendChild(bar); body.appendChild(view); body.appendChild(sbar);
    win.appendChild(body);
    decorateWin(win, w, box);
    return win;
  }
  // Application « Ligne de commande » dans le bureau d'une machine
  function buildTerm(w, box) {
    var h = N(w.host);
    var win = document.createElement('section'); win.className = 'dwin app term-app'; win.setAttribute('data-host', h.id);
    win.setAttribute('aria-label', 'Ligne de commande de ' + h.label);
    win.appendChild(winHead(w, 'Ligne de commande · ' + h.label + ' (' + (h.ifaces[0].ip || 'pas d\'IP') + ')'));
    var body = document.createElement('div'); body.className = 'dwin-body term-body';
    // Console : la sortie défile, l'invite est sur la dernière ligne (comme dans l'activité)
    var con = document.createElement('div'); con.className = 'term-app-out'; con.setAttribute('aria-label', 'Ligne de commande');
    var lines = document.createElement('pre'); lines.className = 'term-lines';
    var form = document.createElement('form'); form.className = 'term-prompt';
    var ps = document.createElement('span'); ps.className = 'term-ps'; ps.textContent = h.label + ' > ';
    var inp = document.createElement('input'); inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.setAttribute('aria-label', 'Saisie de la commande'); inp.value = w.draft || '';
    inp.addEventListener('input', function () { w.draft = inp.value; });
    form.appendChild(ps); form.appendChild(inp);
    // Historique des commandes par machine : flèches haut et bas pour rappeler une commande tapée
    var hist = cmdHist[h.id] = cmdHist[h.id] || [];
    var hi = hist.length;
    inp.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      if (!hist.length) return;
      if (e.key === 'ArrowUp') hi = Math.max(0, hi - 1);
      else hi = Math.min(hist.length, hi + 1);
      inp.value = hi < hist.length ? hist[hi] : '';
      w.draft = inp.value;
      inp.setSelectionRange(inp.value.length, inp.value.length);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var line = inp.value;
      if (!termBusy) {
        if (line.trim() && hist[hist.length - 1] !== line) hist.push(line);
        hi = hist.length;
        inp.value = ''; w.draft = '';
      }
      refreshHosts(); termHost.value = h.id;
      runCommand(line);
    });
    con.appendChild(lines); con.appendChild(form);
    con.addEventListener('click', function (e) { if (e.target === con || e.target === lines) inp.focus(); });
    body.appendChild(con);
    win.appendChild(body);
    fillTermApp(win, h.id);
    decorateWin(win, w, box);
    setTimeout(function () { inp.focus(); }, 0);
    return win;
  }
  function fillTermApp(win, hostId) {
    var con = win.querySelector('.term-app-out');
    var lines = win.querySelector('.term-lines');
    var out = OUT[hostId] || [];
    lines.textContent = out.length ? out.join('\n') : 'Tapez « aide » pour la liste des commandes.';
    con.scrollTop = con.scrollHeight;
  }
  // Mise à jour des fenêtres de ligne de commande ouvertes sur cette machine
  function updateTermApps(hostId) {
    deskZone.querySelectorAll('.term-app').forEach(function (t) {
      if (t.getAttribute('data-host') === hostId) fillTermApp(t, hostId);
    });
  }
  function buildAppWin(a, screen) {
    return a.type === 'term' ? buildTerm(a, screen) : a.type === 'trames' ? buildTrames(a, screen) : a.type === 'nav' ? buildNav(a, screen) : a.type === 'edit' ? buildEdit(a, screen) : a.type.indexOf('svc-') === 0 ? buildSvc(a, screen) : a.type === 'fich' ? buildFich(a, screen) : a.type === 'img' ? buildImg(a, screen) : buildInstall(a, screen);
  }
  // Smartphone, tablette et smart TV : leur propre écran, sans barre des tâches d'ordinateur
  function buildDevice(w, h, kind) {
    var isTv = kind === 'tv', tablet = h.kind === 'tablet';
    var on = netOk(h);
    var win = document.createElement('section');
    win.className = 'dwin desk dev ' + (isTv ? 'tv' : tablet ? 'tablet' : 'phone');
    win.setAttribute('aria-label', 'Écran de ' + h.label);
    win.appendChild(winHead(w, h.label));
    var frame = document.createElement('div'); frame.className = 'dev-frame';
    if (isTv) {
      var tvs = document.createElement('div'); tvs.className = 'tv-screen' + (on ? ' on' : '');
      var big = document.createElement('p'); big.className = 'tv-msg';
      var sub = document.createElement('p'); sub.className = 'tv-sub';
      if (on) { big.textContent = 'Smart TV'; sub.textContent = 'Connectée au réseau · ' + h.ifaces[0].ip; }
      else { big.textContent = 'Pas connectée'; sub.textContent = 'Aucune connexion au réseau.'; }
      tvs.appendChild(big); tvs.appendChild(sub);
      frame.appendChild(tvs);
    } else {
      var screen = document.createElement('div'); screen.className = 'dev-screen';
      var f = h.ifaces[0];
      var st = document.createElement('div'); st.className = 'dev-status';
      var sl = document.createElement('span'); sl.textContent = on ? (f.wifi ? 'Wi-Fi · ' + f.ssid : 'Réseau filaire') : 'Pas de réseau';
      var sr = document.createElement('span'); sr.textContent = f.ip || 'sans IP';
      st.appendChild(sl); st.appendChild(sr); screen.appendChild(st);
      var grid = document.createElement('div'); grid.className = 'dev-apps';
      var nav = softOf('nav');
      var b = document.createElement('button'); b.type = 'button'; b.className = 'dev-app';
      var t = document.createElement('span'); t.className = 'tile ' + nav.cls; t.textContent = nav.tile;
      var l = document.createElement('span'); l.textContent = 'Navigateur';
      b.appendChild(t); b.appendChild(l);
      b.addEventListener('click', function () { openWin('nav', h.id); });
      grid.appendChild(b); screen.appendChild(grid);
      var home = document.createElement('div'); home.className = 'dev-home'; screen.appendChild(home);
      WINS.filter(function (a) { return a.type !== 'desk' && a.host === w.host && !a.min; }).forEach(function (a) {
        screen.appendChild(buildAppWin(a, screen));
      });
      frame.appendChild(screen);
    }
    win.appendChild(frame);
    // Position : les écrans d'appareils ne se superposent pas à l'ouverture ; leur taille est celle de leur cadre
    if (w.x === undefined) {
      var di = WINS.filter(function (x) { return x.type === 'desk'; }).indexOf(w);
      w.x = 12 + (di % 3) * 300; w.y = 12 + Math.floor(di / 3) * 470;
    }
    decorateWin(win, w, deskZone);
    win.style.width = ''; win.style.height = '';
    return win;
  }
  function buildDesk(w) {
    var h = N(w.host);
    var kind = deskKind(h);
    if (kind === 'mobile' || kind === 'tv') return buildDevice(w, h, kind);
    var win = document.createElement('section'); win.className = 'dwin desk'; win.setAttribute('aria-label', 'Bureau de ' + h.label);
    win.appendChild(winHead(w, 'Bureau · ' + h.label + ' (' + (h.ifaces[0].ip || 'pas d\'IP') + ')'));
    var screen = document.createElement('div'); screen.className = 'desk-screen';
    var grid = document.createElement('div'); grid.className = 'desk-icons';
    var apps = kind === 'pc'
      ? [{ id: 'install', label: 'Installation des logiciels', tile: '+', cls: 'inst' }, { id: 'trames', label: 'Échanges de données', tile: 'Tr', cls: 'net' }].concat(SOFT.filter(function (s) { return hasSoft(h, s.id); }))
      : kind === 'mobile' ? [softOf('nav')] : [];
    apps.forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'desk-icon';
      var t = document.createElement('span'); t.className = 'tile ' + (a.cls || ''); t.textContent = a.tile;
      var l = document.createElement('span'); l.textContent = a.label;
      b.appendChild(t); b.appendChild(l);
      b.addEventListener('click', function () {
        if (a.id === 'install') openWin('install', h.id);
        else if (a.id === 'cmd') openWin('term', h.id);
        else if (a.id === 'web' || a.id === 'dns' || a.id === 'dhcp') openWin('svc-' + a.id, h.id);
        else if (a.id === 'nav') openWin('nav', h.id);
        else if (a.id === 'edit') openWin('edit', h.id);
        else if (a.id === 'fich') openWin('fich', h.id);
        else if (a.id === 'img') setStatus('Ouvrez une image depuis l\'explorateur de fichiers.');
        else if (a.id === 'trames') openWin('trames', h.id);
        else setStatus(a.label + ' : pas encore disponible dans le simulateur.');
      });
      grid.appendChild(b);
    });
    screen.appendChild(grid);
    if (kind === 'pc' && !(h.software || []).length) {
      var note = document.createElement('p'); note.className = 'desk-note';
      note.textContent = 'Aucun logiciel installé. Ouvrez « Installation des logiciels » pour en ajouter.';
      screen.appendChild(note);
    }
    if (kind === 'tv') {
      var tvn = document.createElement('p'); tvn.className = 'desk-note';
      tvn.textContent = netOk(h) ? 'Télévision connectée au réseau (' + h.ifaces[0].ip + ').' : 'Pas de connexion au réseau : la télévision ne peut rien afficher.';
      screen.appendChild(tvn);
    }
    var bar = document.createElement('div'); bar.className = 'taskbar';
    var start = document.createElement('span'); start.className = 'start'; start.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z"/></svg>';
    var net = document.createElement('span'); net.className = 'tray'; net.innerHTML = ICON_SCREEN;
    var ip = document.createElement('span'); ip.textContent = h.ifaces[0].ip || 'sans IP';
    bar.appendChild(start);
    WINS.filter(function (a) { return a.type !== 'desk' && a.host === w.host && a.min; }).forEach(function (a) {
      var name = TASK_NAMES[a.type] || 'Fenêtre';
      var info = TASK_TILES[a.type] || { tile: '?', cls: '' };
      var tk = document.createElement('button'); tk.type = 'button'; tk.className = 'task-item';
      tk.setAttribute('aria-label', 'Restaurer ' + name);
      var tt = document.createElement('span'); tt.className = 'tile ' + info.cls; tt.textContent = info.tile;
      var tip = document.createElement('span'); tip.className = 'task-tip'; tip.setAttribute('aria-hidden', 'true'); tip.textContent = name;
      tk.appendChild(tt); tk.appendChild(tip);
      tk.addEventListener('click', function () { a.min = false; renderDesk(); });
      bar.appendChild(tk);
    });
    bar.appendChild(net); bar.appendChild(ip);
    screen.appendChild(bar);
    win.appendChild(screen);
    // Applications ouvertes sur cette machine : elles sont dans l'écran du bureau
    WINS.filter(function (a) { return a.type !== 'desk' && a.host === w.host && !a.min; }).forEach(function (a) {
      screen.appendChild(buildAppWin(a, screen));
    });
    decorateWin(win, w, deskZone);
    return win;
  }
  function buildInstall(w, box) {
    var h = N(w.host);
    var win = document.createElement('section'); win.className = 'dwin app install'; win.setAttribute('aria-label', 'Installation des logiciels de ' + h.label);
    win.appendChild(winHead(w, 'Installation des logiciels · ' + h.label));
    var body = document.createElement('div'); body.className = 'dwin-body';
    var cols = document.createElement('div'); cols.className = 'sw-cols';
    function list(heading, ids, side) {
      var col = document.createElement('div');
      var hh = document.createElement('h4'); hh.textContent = heading; col.appendChild(hh);
      var ul = document.createElement('ul'); ul.setAttribute('role', 'listbox'); ul.setAttribute('aria-label', heading);
      ids.forEach(function (id) {
        var s = softOf(id); if (!s) return;
        var li = document.createElement('li'); li.textContent = s.label; li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', w.sel && w.sel.side === side && w.sel.id === id ? 'true' : 'false');
        // Clic simple : sélection sans reconstruire la liste, pour que le double clic reste sur le même élément
        li.addEventListener('click', function () {
          w.sel = { side: side, id: id };
          win.querySelectorAll('li[role="option"]').forEach(function (x) { x.setAttribute('aria-selected', x === li ? 'true' : 'false'); });
        });
        // Double clic : même effet que la flèche (installer dans « Disponibles », désinstaller dans « Installés »)
        li.addEventListener('dblclick', function () {
          if (side === 'R') w.pending.push(id);
          else w.pending = w.pending.filter(function (x) { return x !== id; });
          w.sel = null; renderDesk();
        });
        ul.appendChild(li);
      });
      col.appendChild(ul);
      return col;
    }
    var installed = w.pending;
    var available = SOFT.map(function (s) { return s.id; }).filter(function (id) { return installed.indexOf(id) < 0; });
    cols.appendChild(list('Installés', installed, 'L'));
    var arr = document.createElement('div'); arr.className = 'arrows';
    var up = document.createElement('button'); up.type = 'button'; up.textContent = '⬅'; up.title = 'Installer le logiciel sélectionné';
    up.setAttribute('aria-label', 'Installer');
    up.addEventListener('click', function () {
      if (!w.sel || w.sel.side !== 'R') { setStatus('Sélectionnez un logiciel dans « Disponibles ».'); return; }
      w.pending.push(w.sel.id); w.sel = null; renderDesk();
    });
    var down = document.createElement('button'); down.type = 'button'; down.textContent = '➡'; down.title = 'Désinstaller le logiciel sélectionné';
    down.setAttribute('aria-label', 'Désinstaller');
    down.addEventListener('click', function () {
      if (!w.sel || w.sel.side !== 'L') { setStatus('Sélectionnez un logiciel dans « Installés ».'); return; }
      w.pending = w.pending.filter(function (id) { return id !== w.sel.id; }); w.sel = null; renderDesk();
    });
    arr.appendChild(up); arr.appendChild(down);
    cols.appendChild(arr);
    cols.appendChild(list('Disponibles', available, 'R'));
    body.appendChild(cols);
    var apply = document.createElement('button'); apply.type = 'button'; apply.className = 'dwin-apply'; apply.textContent = 'Appliquer les modifications';
    apply.addEventListener('click', function () {
      SOFT.forEach(function (s) { setSoftware(h, s.id, w.pending.indexOf(s.id) >= 0); });
      setStatus('Logiciels mis à jour sur ' + h.label + '.');
      refresh();
    });
    body.appendChild(apply);
    win.appendChild(body);
    decorateWin(win, w, box);
    return win;
  }
  function renderDesk() {
    WINS = WINS.filter(function (w) { return N(w.host); });
    deskZone.textContent = '';
    deskZone.hidden = !isSim();
    if (deskZone.hidden) return;
    if (!WINS.length) {
      var em = document.createElement('p'); em.className = 'desk-empty';
      em.textContent = 'Cliquez sur un ordinateur du plan pour ouvrir son bureau.';
      deskZone.appendChild(em); return;
    }
    // Seuls les bureaux sont au premier niveau ; leurs applications sont dans leur écran
    WINS.filter(function (w) { return w.type === 'desk' && !w.min; }).forEach(function (w) { deskZone.appendChild(buildDesk(w)); });
    var reduced = WINS.filter(function (w) { return w.type === 'desk' && w.min; });
    if (reduced.length) {
      var dock = document.createElement('div'); dock.className = 'desk-dock'; dock.setAttribute('aria-label', 'Fenêtres réduites');
      reduced.forEach(function (w) {
        var h = N(w.host);
        var unit = document.createElement('div'); unit.className = 'dock-unit';
        var b = document.createElement('button'); b.type = 'button'; b.className = 'dock-item';
        b.innerHTML = ICON_SCREEN;
        var l = document.createElement('span'); l.textContent = 'Bureau · ' + h.label;
        b.appendChild(l);
        b.title = 'Restaurer';
        b.addEventListener('click', function () { w.min = false; w.z = ++zseq; renderDesk(); });
        var x = document.createElement('button'); x.type = 'button'; x.className = 'dock-close';
        x.innerHTML = ICON_CLOSE;
        x.setAttribute('aria-label', 'Fermer le bureau de ' + h.label); x.title = 'Fermer le bureau';
        x.addEventListener('click', function () { closeWin(w.id); });
        unit.appendChild(b); unit.appendChild(x);
        dock.appendChild(unit);
      });
      deskZone.appendChild(dock);
    }
  }

  /* ----- Terminal ----- */
  function hosts() { return NODES.filter(function (n) { return !n.hidden && n.type !== 'switch' && n.type !== 'router'; }); }
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
    updateTermApps(hostId);
    if (termHost.value === hostId) renderTermOut();
  }
  function renderTermOut() {
    var lines = OUT[termHost.value] || [];
    if (lines.length) {
      termOut.classList.remove('hint');
      termOut.textContent = lines.join('\n');
    } else {
      termOut.classList.add('hint');
      termOut.textContent = 'Tapez « aide » pour la liste des commandes.';
    }
    termOut.scrollTop = termOut.scrollHeight;
  }

  // Pas-à-pas : en mode pas-à-pas, chaque segment parcouru par un paquet attend un clic (ou la flèche droite)
  var stepMode = false, stepResolve = null;
  function releaseStep() { if (stepResolve) { var r = stepResolve; stepResolve = null; r(); } }
  function updateStepBar(text) {
    var bar = $('stepBar');
    bar.hidden = !(stepMode && isSim());
    $('stepText').textContent = text || 'Lancez un ping ou une page : chaque segment du paquet attend votre clic.';
  }
  function setStepMode(on) {
    stepMode = on;
    $('btnStep').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) releaseStep();
    updateStepBar();
  }
  function waitStep(text) {
    return new Promise(function (res) { stepResolve = res; updateStepBar(text); });
  }
  function fly(ids, cls, what) {
    return new Promise(function (resolve) {
      if (ids.length < 2) { resolve(); return; }
      var dot = el('circle', { r: 7, class: 'packet ' + cls }, layerPk);
      var steps = reduceMotion ? 1 : 16;
      var i = 0;
      (function nextSeg() {
        if (i >= ids.length - 1) { dot.remove(); resolve(); return; }
        var a = N(ids[i]), b = N(ids[i + 1]), s = 0;
        var go = function () {
          (function tick() {
            s++;
            var t = s / steps;
            dot.setAttribute('cx', a.x + (b.x - a.x) * t);
            dot.setAttribute('cy', a.y + (b.y - a.y) * t);
            if (s < steps) setTimeout(tick, animDelay);
            else { i++; nextSeg(); }
          })();
        };
        if (stepMode) waitStep(what + ' : ' + a.label + ' → ' + b.label + ' (' + (i + 1) + '/' + (ids.length - 1) + ')').then(function () { updateStepBar(); go(); });
        else go();
      })();
    });
  }
  // Vitesse d'animation réglée par le curseur de la barre (1 = lente, 5 = rapide) : délai entre deux positions du paquet
  var SPEED_DELAY = [70, 36, 18, 9, 3];
  var animDelay = SPEED_DELAY[2];
  function setAnimSpeed(v) { animDelay = SPEED_DELAY[Math.max(0, Math.min(4, (+v || 3) - 1))]; }
  async function flyLegs(legs) {
    for (var k = 0; k < legs.length; k++) {
      await fly(expand(legs[k]), k === 0 ? 'req' : 'rep', k === 0 ? 'Requête' : 'Réponse');
    }
  }

  // Temps simulé : environ 1 ms par segment traversé, plus une petite variation
  function latency(legs) {
    var segs = 0;
    legs.forEach(function (leg) { segs += expand(leg).length - 1; });
    return Math.max(1, Math.round(segs * 1.2 + 1 + Math.random() * 2));
  }

  // Sortie du ping comme sous Windows (capture d'un ordinateur réel)
  function pingLatency(legs) {
    var segs = 0;
    legs.forEach(function (leg) { segs += expand(leg).length - 1; });
    return segs * 0.5 + Math.random() * 0.7;
  }
  function pingTime(ms) { return ms < 1 ? '<1ms' : '=' + Math.round(ms) + 'ms'; }
  // Recherche inverse (ping -a) : nom enregistré pour une adresse, sur le serveur DNS
  function ptrCore(hostId, ip) {
    var h = N(hostId);
    var dnsNode = h.dns && dnsServerAt(h.dns);
    if (!dnsNode) return { ok: false, msg: 'Aucun serveur DNS joignable.', legs: [] };
    var q = pingCore(hostId, h.dns, 'Requête DNS inverse : ' + ip);
    if (!q.ok) return { ok: false, msg: 'Serveur DNS injoignable.', legs: q.legs };
    if (!svcRunning(dnsNode, 'dns')) return { ok: false, msg: 'Le service DNS est arrêté.', legs: q.legs };
    var name = Object.keys(dnsNode.records || {}).find(function (k) { return dnsNode.records[k] === ip; });
    if (!name) return { ok: false, msg: 'Aucun nom pour cette adresse.', legs: q.legs };
    return { ok: true, name: name, legs: q.legs };
  }
  // ping [-a] <adresse ou nom>, sortie comme sous Windows
  async function cmdPing(h, rest) {
    var reverse = false, target = rest || '';
    var mA = /^-a\s+(\S+)/.exec(rest || '');
    if (mA) { reverse = true; target = mA[1]; }
    if (!target) { printTo(h.id, 'Utilisation : ping [-a] <adresse ou nom>'); return; }
    var ip, header;
    if (reverse) {
      if (!ipOK(target)) { printTo(h.id, 'Adresse IP invalide : ' + target + '.'); return; }
      var rv = ptrCore(h.id, target);
      await flyLegs(rv.legs || []);
      ip = target;
      header = rv.ok ? 'Envoi d\'une requête \'ping\' sur ' + rv.name + ' [' + ip + '] avec 32 octets de données :'
                     : 'Envoi d\'une requête \'Ping\'  ' + ip + ' avec 32 octets de données :';
    } else {
      var r = resolveCore(h.id, target);
      await flyLegs(r.legs || []);
      if (!r.ok) { printTo(h.id, 'Impossible de trouver l\'hôte ' + target + '. Vérifiez le nom et réessayez.'); return; }
      ip = r.ip;
      header = ip === target ? 'Envoi d\'une requête \'Ping\'  ' + ip + ' avec 32 octets de données :'
                             : 'Envoi d\'une requête \'ping\' sur ' + target + ' [' + ip + '] avec 32 octets de données :';
    }
    printTo(h.id, header);
    printTo(h.id, '');
    var recus = 0, times = [];
    for (var k = 0; k < 4; k++) {
      var p = pingCore(h.id, ip);
      await flyLegs(p.legs);
      if (p.ok) {
        recus++;
        var ms = pingLatency(p.legs);
        times.push(ms < 1 ? 0 : Math.round(ms));
        printTo(h.id, 'Réponse de ' + ip + ' : octets=32 temps' + pingTime(ms) + ' TTL=' + ttlOf(p.legs[1] || p.legs[0]));
      } else {
        printTo(h.id, 'Délai d\'attente de la demande dépassé.');
      }
    }
    printTo(h.id, '');
    printTo(h.id, 'Statistiques Ping pour ' + ip + ':');
    printTo(h.id, '    Paquets : envoyés = 4, reçus = ' + recus + ', perdus = ' + (4 - recus) + ' (perte ' + Math.round((4 - recus) * 100 / 4) + '%),');
    if (times.length) {
      var mn = Math.min.apply(null, times), mx = Math.max.apply(null, times);
      var avg = Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length);
      printTo(h.id, 'Durée approximative des boucles en millisecondes :');
      printTo(h.id, '    Minimum = ' + mn + 'ms, Maximum = ' + mx + 'ms, Moyenne = ' + avg + 'ms');
    }
  }

  // host <nom> : traduit un nom en adresse IP par le serveur DNS (la requête voyage sur le schéma)
  async function cmdHost(h, target) {
    if (ipOK(target)) { printTo(h.id, target + ' est déjà une adresse IP.'); return; }
    var r = resolveCore(h.id, target);
    await flyLegs(r.legs || []);
    if (!r.ok) { printTo(h.id, r.msg); return; }
    printTo(h.id, target + ' a pour adresse ' + r.ip);
  }
  // route : table de routage de la machine (réseau directement connecté et passerelle)
  function routeCmd(h) {
    var f = h.ifaces[0], rows = [];
    if (f.ip) { var m = maskOf(f); rows.push([int2ip((ip2(f.ip) & ip2(m)) >>> 0) + '/' + prefixLen(m), 'directement connecté', 'Interface 1']); }
    if (h.gw) rows.push(['0.0.0.0/0', h.gw, 'Interface 1']);
    printTo(h.id, 'Destination'.padEnd(20) + 'Passerelle'.padEnd(24) + 'Interface');
    if (!rows.length) printTo(h.id, '(table vide : configurez l\'adresse IP)');
    rows.forEach(function (r) { printTo(h.id, r[0].padEnd(20) + r[1].padEnd(24) + r[2]); });
  }

  // Navigateur web : même chemin que la commande web (DNS, puis requête HTTP), avec animation
  var navSeq = 0;
  function navFinish(w, tok, st) { if (w.tok !== tok) return; w.state = st; renderDesk(); }
  async function browse(w, raw) {
    var h = N(w.host);
    var text = raw.trim();
    var https = /^https:\/\//i.test(text);
    var url = text.replace(/^https?:\/\//i, '');
    var slash = url.indexOf('/');
    var name = slash < 0 ? url : url.slice(0, slash);
    var path = slash < 0 ? '/' : url.slice(slash);
    var tok = ++navSeq;
    w.tok = tok; w.url = text;
    if (!name) return navFinish(w, tok, { status: 'Adresse vide.', error: 'Saisissez une adresse, par exemple www.monsite-snt.fr' });
    w.state = { status: 'Recherche de l\'adresse de ' + name + '…' };
    renderDesk();
    var r = resolveCore(h.id, name);
    await flyLegs(r.legs || []);
    if (!r.ok) return navFinish(w, tok, { status: 'Site introuvable', error: r.msg });
    w.state = { status: 'Requête vers ' + r.ip + '…' };
    renderDesk();
    var p = pingCore(h.id, r.ip, 'Requête HTTP GET ' + path);
    await flyLegs(p.legs);
    if (!p.ok) return navFinish(w, tok, { status: 'Pas de réponse', error: 'Pas de réponse du serveur : ' + p.msg });
    var srv = N(p.dstNode);
    if (srv && srv.web && !svcRunning(srv, 'web')) return navFinish(w, tok, { status: 'Connexion refusée', error: 'Le service web de ce serveur est arrêté.' });
    if (!(srv && srv.web && srv.ifaces.some(function (f) { return f.ip === r.ip; })))
      return navFinish(w, tok, { status: 'Connexion refusée', error: 'Ce serveur n\'a pas de serveur web installé.' });
    if (path !== '/') return navFinish(w, tok, { status: '404 Page introuvable', error: 'Le site « ' + name + ' » n\'a pas de page « ' + path + ' ».' });
    navFinish(w, tok, { status: '200 OK', page: { title: srv.siteName || SITE, name: name, ip: r.ip, https: https, html: withImages(srv, srv.pageHtml || defaultPage(srv)) } });
  }

  // Adresse de l'interface d'un appareil par laquelle arrive une trame venant de prevId
  // Indice de l'interface d'un appareil par laquelle arrive une trame venant de prevId
  function ifaceIndexFrom(node, prevId) {
    if (node.type === 'router') {
      for (var i = 0; i < node.ifaces.length; i++) {
        if (node.ifaces[i].ip && linkAt(node.id, i) && segment(node.id, i).some(function (e) { return e.n === prevId; })) return i;
      }
    }
    return 0;
  }
  async function cmdTrace(h, target) {
    var r = resolveCore(h.id, target);
    await flyLegs(r.legs || []);
    if (!r.ok) { printTo(h.id, r.msg); return; }
    var pid = ++pidSeq;
    var rr = route(h.id, h.ifaces[0].ip, r.ip, pid);
    var hops = rr.hops;
    await flyLegs([hops]);
    printTo(h.id, 'traceroute vers ' + target + ' (' + r.ip + ')');
    for (var k = 1; k < hops.length; k++) {
      var node = N(hops[k]);
      var idx = ifaceIndexFrom(node, hops[k - 1]);
      var ip = (k === hops.length - 1 && rr.ok) ? r.ip : (node.ifaces[idx] ? node.ifaces[idx].ip : '');
      var via = node.type === 'router' ? ' · interface ' + (idx + 1) : '';
      printTo(h.id, k + '  ' + ip + '  (' + node.label + via + ')  ' + latency([hops.slice(0, k + 1)]) + ' ms');
    }
    if (!rr.ok) printTo(h.id, 'Arrêt : ' + rr.msg);
    else printTo(h.id, 'Destination atteinte en ' + (hops.length - 1) + ' saut(s).');
  }
  function ipconfig(h) {
    printTo(h.id, 'Adresse IP : ' + (h.ifaces[0].ip || '(non configurée)'));
    printTo(h.id, 'Masque : ' + maskOf(h.ifaces[0]));
    printTo(h.id, 'Passerelle : ' + (h.gw || '(aucune)'));
    printTo(h.id, 'Serveur DNS : ' + (h.dns || '(aucun)'));
  }

  // Barre d'outils : un seul arrêt de Tab, flèches gauche et droite pour parcourir les boutons
  (function () {
    var bar = document.querySelector('.toolbar'); if (!bar) return;
    bar.setAttribute('role', 'toolbar');
    var items = Array.prototype.slice.call(bar.querySelectorAll('button.tb, a.tb'));
    items.forEach(function (el, i) { el.tabIndex = i === 0 ? 0 : -1; });
    bar.addEventListener('keydown', function (e) {
      var i = items.indexOf(document.activeElement), j;
      if (i < 0) return;
      if (e.key === 'ArrowRight') j = (i + 1) % items.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + items.length) % items.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = items.length - 1;
      else return;
      e.preventDefault();
      items.forEach(function (el, k) { el.tabIndex = k === j ? 0 : -1; });
      items[j].focus();
    });
  })();
  // Historique des commandes saisies, par machine (conservé même si la fenêtre est fermée)
  var cmdHist = {};
  // Une seule commande à la fois : sinon les sorties d'un ping animé se mélangent à la commande suivante
  var termBusy = false;
  async function runCommand(line) {
    var hb = N(termHost.value);
    if (hb && termBusy) { printTo(hb.id, 'Patientez : la commande précédente n\'est pas terminée.'); return; }
    termBusy = true;
    try { await runCommandNow(line); } finally { termBusy = false; }
  }
  async function runCommandNow(line) {
    var h = N(termHost.value);
    if (!h) { setStatus('Ajoutez une machine pour utiliser le terminal.'); return; }
    if (!hasSoft(h, 'cmd')) {
      printTo(h.id, 'La ligne de commande n\'est pas installée sur ' + h.label + '. Cliquez l\'ordinateur en simulation, puis installez-la.');
      return;
    }
    if ((OUT[h.id] || []).length) printTo(h.id, '');
    printTo(h.id, h.label + ' > ' + line);
    var parts = line.trim().split(/\s+/);
    var cmd = (parts[0] || '').toLowerCase();
    var arg = parts[1] || '';
    var rest = line.trim().slice((parts[0] || '').length).trim();
    if (!cmd) return;
    if (cmd === 'aide') {
      printTo(h.id, 'ping <adresse ou nom> : teste la connexion (4 paquets)');
      printTo(h.id, 'ping -a <adresse IP> : retrouve le nom de la machine (serveur DNS)');
      printTo(h.id, 'traceroute <adresse ou nom> : liste les routeurs traversés');
      printTo(h.id, 'host <nom> : donne l\'adresse IP d\'un nom (serveur DNS)');
      printTo(h.id, 'route : affiche la table de routage');
      printTo(h.id, 'ipconfig : affiche la configuration');
      printTo(h.id, 'clear : efface le terminal');
    } else if (cmd === 'clear') {
      OUT[h.id] = []; renderTermOut();
    } else if (cmd === 'ipconfig') {
      ipconfig(h);
    } else if (cmd === 'route') {
      routeCmd(h);
    } else if (cmd === 'ping' || cmd === 'host' || cmd === 'traceroute') {
      if (!arg) { printTo(h.id, 'Usage : ' + cmd + ' <adresse ou nom>'); return; }
      if (!h.ifaces[0].ip) { printTo(h.id, h.label + ' : pas d\'adresse IP configurée.'); return; }
      busy = true; cmdInput.disabled = true;
      try { if (cmd === 'ping') await cmdPing(h, rest); else if (cmd === 'traceroute') await cmdTrace(h, arg); else await cmdHost(h, arg); }
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
      { id: 'PC', kind: 'pc', type: 'pc', label: 'Ordinateur', ifaces: [{ ip: '' }], gw: '', dns: '', software: ['cmd'], x: 100, y: 110 },
      { id: 'NB', kind: 'notebook', type: 'notebook', label: 'Portable', ifaces: [{ ip: '' }], gw: '192.168.0.254', dns: '', software: ['cmd'], x: 100, y: 300 },
      { id: 'SW1', kind: 'switch', type: 'switch', label: 'Switch', x: 250, y: 205 },
      { id: 'BOX', kind: 'router', type: 'router', label: 'Box', ifaces: [{ ip: '192.168.0.254' }, { ip: '192.168.140.100', wan: true }], defGw: '192.168.140.254', x: 400, y: 205 },
      { id: 'SW2', kind: 'switch', type: 'switch', label: 'Switch opérateur', x: 570, y: 205 },
      { id: 'OP', kind: 'router', type: 'router', label: 'Routeur opérateur', ifaces: [{ ip: '192.168.140.254' }, { ip: '192.168.21.254' }], defGw: '', x: 750, y: 205 },
      { id: 'DNS', kind: 'pc', type: 'pc', label: 'Serveur DNS', ifaces: [{ ip: '192.168.140.1' }], gw: '192.168.140.254', dns: '', dnsSvc: true, software: ['dns'], records: { 'www.monsite-snt.fr': '192.168.21.1' }, x: 570, y: 80 },
      { id: 'WEB', kind: 'pc', type: 'pc', label: 'Serveur Web', ifaces: [{ ip: '192.168.21.1' }], gw: '192.168.21.254', dns: '', web: true, software: ['web'], x: 910, y: 205 }
    ];
    LINKS = []; BLOCKS = []; selBlock = null; OUT = {}; TRAMES = {}; selected = null; pending = null;
    var L =function (a, b) { addLink(freeTarget(a), freeTarget(b)); };
    L('PC', 'SW1'); L('NB', 'SW1'); L('SW1', 'BOX'); L('BOX', 'SW2'); L('OP', 'SW2'); L('DNS', 'SW2'); L('OP', 'WEB');
    setStatus('Scénario de la séance chargé. Configurez le PC et le portable, puis testez.');
    refresh();
  }
  function clearAll() {
    NODES = []; LINKS = []; BLOCKS = []; selBlock = null; OUT = {}; TRAMES = {}; selected = null; pending = null;
    setStatus('Plan vidé.');
    refresh();
  }
  function exportPlan() {
    var data = JSON.stringify({ version: 3, nodes: NODES, links: LINKS.filter(function (l) { return !l.wireless; }), blocks: BLOCKS }, null, 2);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'simulateur-reseau.json';
    document.body.appendChild(a); a.click(); a.remove();
    setStatus('Plan exporté.');
  }
  // Sauvegarde Filius (.fls) : appareils, câbles, logiciels, DNS et pages reprises ; le reste est signalé
  function importFiliusPlan(file) {
    var reader = new FileReader();
    reader.onload = function () {
      FiliusImport.read(reader.result).then(function (res) {
        NODES = res.nodes; NODES.forEach(upgradeNode);
        LINKS = res.links; BLOCKS = [];
        selBlock = null; OUT = {}; TRAMES = {}; selected = null; pending = null;
        NODES.forEach(function (x) { var m = /(\d+)$/.exec(x.id); if (m) seq = Math.max(seq, +m[1]); });
        setStatus('Sauvegarde importée : ' + NODES.length + ' appareils, ' + LINKS.length + ' câbles.' + (res.warnings.length ? ' À noter : ' + res.warnings.join(' ') : ''));
        refresh();
      }).catch(function (err) {
        setStatus('Fichier de sauvegarde non reconnu : ' + err.message + '.');
      });
    };
    reader.readAsArrayBuffer(file);
  }
  function importPlan(file) {
    if (/\.fls$/i.test(file.name)) { importFiliusPlan(file); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('format');
        NODES = data.nodes; NODES.forEach(upgradeNode); LINKS = data.links.filter(function (l) { return !l.wireless && !wirelessLink(l); }); BLOCKS = Array.isArray(data.blocks) ? data.blocks : [];
        selBlock = null; OUT = {}; selected = null; pending = null;
        // Les nouveaux identifiants ne doivent pas reprendre ceux du plan importé
        NODES.concat(BLOCKS).forEach(function (x) { var m = /(\d+)$/.exec(x.id); if (m) seq = Math.max(seq, +m[1]); });
        setStatus('Plan importé.');
        refresh();
      } catch (err) {
        setStatus('Fichier non reconnu : ce n\'est pas un plan exporté depuis cet outil.');
      }
    };
    reader.readAsText(file);
  }

  /* ----- Zoom, déplacement du plan, clavier, terminal, palette ----- */
  var VB = { x: -170, y: -90, w: 1440, h: 748 };
  // Changement de cadrage : une transition en ease-in-out (sans mouvement si « réduire les animations »)
  var vbRaf = 0;
  function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function setVBAttr() { svg.setAttribute('viewBox', VB.x + ' ' + VB.y + ' ' + VB.w + ' ' + VB.h); }
  function applyVB() { if (vbRaf) { cancelAnimationFrame(vbRaf); vbRaf = 0; } setVBAttr(); }
  function tweenVB(to, ms) {
    if (vbRaf) { cancelAnimationFrame(vbRaf); vbRaf = 0; }
    if (!ms || reducedMotion()) { VB.x = to.x; VB.y = to.y; VB.w = to.w; VB.h = to.h; setVBAttr(); return; }
    var from = { x: VB.x, y: VB.y, w: VB.w, h: VB.h }, t0 = null;
    var step = function (now) {
      if (t0 === null) t0 = now;
      var k = Math.min(1, (now - t0) / ms);
      var e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      VB.x = from.x + (to.x - from.x) * e; VB.y = from.y + (to.y - from.y) * e;
      VB.w = from.w + (to.w - from.w) * e; VB.h = from.h + (to.h - from.h) * e;
      setVBAttr();
      vbRaf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    vbRaf = requestAnimationFrame(step);
  }
  // Mode simulation : le schéma se réduit pour tenir entièrement dans sa zone (à gauche), le bureau occupe l'autre zone
  var savedVB = null;
  function fitTarget() {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    NODES.forEach(function (n) {
      if (n.hidden || n.x == null) return;
      minX = Math.min(minX, n.x - 100); maxX = Math.max(maxX, n.x + 100);
      minY = Math.min(minY, n.y - 90); maxY = Math.max(maxY, n.y + 90);
    });
    if (minX === Infinity) return null;
    var aspect = r.width / r.height, bw = maxX - minX, bh = maxY - minY;
    var w = Math.max(bw, bh * aspect), h = w / aspect;
    return { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w: w, h: h };
  }
  function fitPlan(instant) {
    if (!isSim()) return;
    var t = fitTarget();
    if (t) tweenVB(t, instant ? 0 : 260);
  }
  window.addEventListener('resize', function () { if (isSim()) fitPlan(true); });
  function zoom(f) {
    var cx = VB.x + VB.w / 2, cy = VB.y + VB.h / 2;
    var nw = clamp(VB.w * f, 400, 9000), k = nw / VB.w;
    VB.w = nw; VB.h = VB.h * k;
    VB.x = cx - VB.w / 2; VB.y = cy - VB.h / 2;
    applyVB();
  }
  applyVB();
  $('btnZoomIn').addEventListener('click', function () { zoom(0.8); });
  $('btnZoomOut').addEventListener('click', function () { zoom(1.25); });

  // Glisser le fond du plan pour le déplacer ; un simple clic sur le fond désélectionne
  var pan = null;
  svg.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || (e.target.closest && e.target.closest('.dev, .cable, .block'))) return;
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

  // Clic droit sur une zone vide du plan : quitte le mode Câble ou Supprimer
  // Écoute sur toute la zone du plan (y compris les marges autour du dessin) ;
  // un câble a déjà traité son propre clic droit (defaultPrevented)
  document.querySelector('.stage').addEventListener('contextmenu', function (e) {
    var t = e.target;
    if (t.closest && t.closest('#term')) return; // le terminal garde son menu
    e.preventDefault();
    if (e.defaultPrevented && t.closest && t.closest('.cable')) return;
    if (t.closest && t.closest('.dev')) return;
    if (mode !== 'select' && !isSim()) setMode('select');
  });

  // Clavier : Suppr / Retour arrière supprime l'appareil ciblé, Échap annule un câblage en cours
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'Escape' && pending) { pending = null; setStatus('Câblage annulé.'); refresh(); return; }
    if (e.key === 'Escape' && mode !== 'select' && !isSim()) { setMode('select'); return; }    if (e.key === 'Delete' || e.key === 'Backspace') {
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
    var kind = b.getAttribute('data-add');
    var svgIc = b.querySelector('svg.ic');
    svgIc.setAttribute('class', 'ic k-' + kind);
    if (kind === 'block') {
      el('rect', { x: -30, y: -20, width: 60, height: 40, rx: 10, class: 'block-ic' }, svgIc);
      el('rect', { x: -22, y: -28, width: 30, height: 14, rx: 7, class: 'block-ic-tag' }, svgIc);
      return;
    }
    drawIcon(svgIc, { kind: kind });
  });
  var cableIc = document.querySelector('.palette [data-mode="cable"] svg.ic');
  if (cableIc) {
    el('path', { d: 'M-30 -14 C -12 -14, -12 14, 0 14 S 30 14, 30 -14', class: 'cable-ic' }, cableIc);
    el('circle', { cx: -30, cy: -14, r: 6, class: 'port-ic' }, cableIc);
    el('circle', { cx: 30, cy: -14, r: 6, class: 'port-ic' }, cableIc);
  }

  /* ----- Modes conception / simulation ----- */
  function isSim() { return document.body.classList.contains('sim'); }
  function updateBadge() {
    var sim = isSim();
    $('modeText').textContent = sim ? 'Mode simulation' : 'Mode conception';
    $('planHint').textContent = sim ? 'Plan verrouillé : lancez vos tests dans le terminal.'
      : mode === 'cable' ? 'Maintenez le clic sur un port, puis relâchez-le sur un autre port.'
      : mode === 'delete' ? 'Cliquez un appareil ou un câble pour le supprimer.'
      : 'Glissez un appareil pour le déplacer. Clic droit sur un câble pour le supprimer.';
  }
  function setSim(on) {
    if (on) savedVB = { x: VB.x, y: VB.y, w: VB.w, h: VB.h };
    document.body.classList.toggle('sim', on);
    if (!on) WINS = [];
    $('btnStep').hidden = !on;
    if (!on) setStepMode(false);
    if (on) fitPlan(false); else if (savedVB) tweenVB(savedVB, 260);
    $('btnSim').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('btnConcept').setAttribute('aria-pressed', on ? 'false' : 'true');
    if (on) { pending = null; mode = 'select'; setStatus('Mode simulation : le plan est verrouillé. Utilisez le terminal.'); }
    else setStatus('Mode conception : vous pouvez de nouveau modifier le plan.');
    refresh();
  }
  $('btnStep').addEventListener('click', function () { setStepMode(!stepMode); });
  $('stepNext').addEventListener('click', function () { releaseStep(); });
  $('stepPlay').addEventListener('click', function () { setStepMode(false); });
  document.addEventListener('keydown', function (e) {
    if (!stepResolve || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); releaseStep(); }
  });
  $('btnConcept').addEventListener('click', function () { setSim(false); });
  $('btnSim').addEventListener('click', function () { setSim(true); });
  $('modeBadge').addEventListener('click', function () { setSim(!isSim()); });

  // Familles de la palette : icône = celle du premier appareil du menu ; le menu s'ouvre à droite (survol, clic ou clavier)
  function closeFlies() {
    document.querySelectorAll('.pal-group.open').forEach(function (g) {
      g.classList.remove('open');
      g.querySelector('.pal-cat').setAttribute('aria-expanded', 'false');
    });
  }
  document.querySelectorAll('.pal-group').forEach(function (g) {
    var cat = g.querySelector('.pal-cat');
    var src = g.querySelector('.pal-fly svg.ic');
    if (src) { var ic = cat.querySelector('svg.ic'); ic.setAttribute('class', src.getAttribute('class')); ic.innerHTML = src.innerHTML; }
    cat.addEventListener('click', function () {
      var open = !g.classList.contains('open');
      closeFlies();
      g.classList.toggle('open', open);
      cat.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    g.querySelectorAll('.pal-fly button').forEach(function (b) { b.addEventListener('click', closeFlies); });
    // Largeur du menu selon son nombre d'icônes (3 colonnes au maximum)
    var fly = g.querySelector('.pal-fly');
    if (fly) fly.style.setProperty('--n', fly.querySelectorAll('button').length);
  });
  document.addEventListener('click', function (e) { if (!(e.target.closest && e.target.closest('.pal-group'))) closeFlies(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeFlies(); });

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
    if (!KINDS[kind] || isSim()) return;
    var p = toSvg(e);
    var n = makeNode(kind, clamp(p.x, WORLD.x0, WORLD.x1), clamp(p.y, WORLD.y0, WORLD.y1));
    NODES.push(n);
    selected = n.id;
    setStatus(n.label + ' posé sur le plan. Configurez-le à droite.');
    refresh();
  });
  document.querySelectorAll('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      // Recliquer l'outil déjà actif revient au mode Sélection
      var m = b.getAttribute('data-mode');
      setMode(m === mode ? 'select' : m);
    });
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
