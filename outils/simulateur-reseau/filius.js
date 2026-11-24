/* Import d'une sauvegarde Filius (.fls) dans le simulateur.
   Un fichier .fls est une archive ZIP qui contient projekt/konfiguration.xml (sérialisation XMLDecoder de Java).
   FiliusImport.read(arrayBuffer) renvoie { nodes, links, warnings } dans le format du plan du simulateur. */
(function (global) {
  'use strict';

  // Logiciels Filius repris par le simulateur (classe Java -> identifiant du simulateur)
  var SOFT_OF = {
    'filius.software.lokal.Terminal': 'cmd',
    'filius.software.www.WebServer': 'web',
    'filius.software.www.WebBrowser': 'nav',
    'filius.software.lokal.TextEditor': 'edit',
    'filius.software.dns.DNSServer': 'dns'
  };
  // Classes d'appareils reprises (les autres sont signalées)
  var KIND_OF = {
    'filius.hardware.knoten.Rechner': 'pc',
    'filius.hardware.knoten.Notebook': 'notebook',
    'filius.hardware.knoten.Switch': 'switch',
    'filius.hardware.knoten.Vermittlungsrechner': 'router'
  };

  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }

  // Lit une entrée d'une archive ZIP (méthode 0 ou 8 : déflate, décompressé par le navigateur)
  async function zipText(buf, wanted) {
    var d = new Uint8Array(buf), eocd = -1;
    for (var i = d.length - 22; i >= Math.max(0, d.length - 65558); i--) {
      if (u32(d, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ce n\'est pas un fichier de sauvegarde (.fls) reconnu');
    var count = u16(d, eocd + 10), p = u32(d, eocd + 16), dec = new TextDecoder('utf-8');
    for (var k = 0; k < count; k++) {
      if (u32(d, p) !== 0x02014b50) break;
      var method = u16(d, p + 10), csize = u32(d, p + 20), nlen = u16(d, p + 28), elen = u16(d, p + 30), clen = u16(d, p + 32), loc = u32(d, p + 42);
      var name = dec.decode(d.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name !== wanted) continue;
      var start = loc + 30 + u16(d, loc + 26) + u16(d, loc + 28);
      var data = d.subarray(start, start + csize);
      if (method === 0) return dec.decode(data);
      if (method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('ce navigateur ne sait pas décompresser le fichier');
        var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(stream).text();
      }
      throw new Error('compression non prise en charge');
    }
    throw new Error('projekt/konfiguration.xml est absent de l\'archive');
  }

  // Lecture des objets XMLDecoder : id / idref, propriétés <void property="...">, listes <void index> ou <void method="add">
  function parseXml(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML illisible');
    var ids = {};
    Array.prototype.forEach.call(doc.querySelectorAll('[id]'), function (el) { ids[el.getAttribute('id')] = el; });
    function resolve(el) {
      if (!el) return null;
      if (el.hasAttribute('idref')) return ids[el.getAttribute('idref')] || null;
      return el;
    }
    // Élément de la propriété name (enfant direct de el)
    function propEl(el, name) {
      if (!el) return null;
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (c.getAttribute('property') === name) return c;
      }
      return null;
    }
    // Valeur d'une propriété (objet ou valeur simple)
    function prop(el, name) {
      var w = propEl(el, name);
      return w && w.firstElementChild ? resolve(w.firstElementChild) : null;
    }
    function text(el) { return el ? el.textContent.trim() : ''; }
    // Éléments d'une liste : <void index="n"> (élément lui-même) ou <void method="add"><object/></void>
    function listItems(wrapper) {
      var out = [];
      for (var c = wrapper ? wrapper.firstElementChild : null; c; c = c.nextElementSibling) {
        if (c.hasAttribute('index')) out.push(c);
        else if (c.getAttribute('method') === 'add' && c.firstElementChild) out.push(resolve(c.firstElementChild));
      }
      return out;
    }
    return { doc: doc, resolve: resolve, propEl: propEl, prop: prop, text: text, listItems: listItems };
  }

  // Position d'un appareil dans la fenêtre Filius (java.awt.Rectangle : champs x et y)
  function position(x, item) {
    var out = { x: 100, y: 100 };
    var bounds = x.prop(x.prop(item, 'imageLabel'), 'bounds');
    if (!bounds) return out;
    var fields = bounds.getElementsByTagName('void');
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.getAttribute('method') !== 'getField') continue;
      var name = f.firstElementChild ? f.firstElementChild.textContent.trim() : '';
      var setEl = f.querySelector('void[method="set"]');
      var iv = setEl ? setEl.querySelector('int') : null;
      if (iv && (name === 'x' || name === 'y')) out[name] = parseInt(iv.textContent, 10);
    }
    return out;
  }

  // Fichiers du système de fichiers (arbre DefaultMutableTreeNode) : dossier, nom, contenu
  function collectFiles(x, node, folder, out) {
    var uo = x.propEl(node, 'userObject'), f = folder;
    if (uo && uo.firstElementChild) {
      var v = x.resolve(uo.firstElementChild);
      if (v && v.tagName === 'string') f = v.textContent;
      else if (v && v.getAttribute('class') === 'filius.software.system.Datei') {
        out.push({ folder: folder, name: x.text(x.prop(v, 'name')), content: x.text(x.prop(v, 'dateiInhalt')) });
        return;
      }
    }
    for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
      if (c.getAttribute('method') === 'add' && c.firstElementChild) collectFiles(x, x.resolve(c.firstElementChild), f, out);
    }
  }

  // Lignes « nom. A TTL adresse » du fichier hosts du serveur DNS
  function hostsRecords(content) {
    var rec = {};
    content.split(/\r?\n/).forEach(function (line) {
      var m = /^\s*(\S+?)\.?\s+A\s+\d+\s+(\S+)/.exec(line);
      if (m) rec[m[1].toLowerCase()] = m[2];
    });
    return rec;
  }

  // Identifiant XML d'un port : soit la propriété elle-même, soit l'objet référencé
  function portId(x, wrapper) {
    if (!wrapper) return '';
    if (wrapper.getAttribute('id')) return wrapper.getAttribute('id');
    var r = wrapper.firstElementChild ? x.resolve(wrapper.firstElementChild) : null;
    return r ? (r.getAttribute('id') || '') : '';
  }

  async function read(buf) {
    var x = parseXml(await zipText(buf, 'projekt/konfiguration.xml'));
    var doc = x.doc, warnings = [], nodes = [], links = [], portOwner = {}, routers = 0, ripRouters = 0;
    var items = Array.prototype.filter.call(doc.getElementsByTagName('object'), function (o) { return o.getAttribute('class') === 'filius.gui.netzwerksicht.GUIKnotenItem'; });

    items.forEach(function (item, k) {
      var kn = x.prop(item, 'knoten');
      var cls = kn ? kn.getAttribute('class') : '';
      var kind = KIND_OF[cls];
      if (!kind) { warnings.push('Appareil non repris : ' + (cls || 'inconnu').split('.').pop() + '.'); return; }
      var pos = position(x, item);
      var id = 'N' + (k + 1);
      // Sans nom, Filius affiche l'adresse IP de l'appareil (useIPAsName)
      var nom = x.text(x.prop(kn, 'name'));
      var firstIp = x.text(x.prop(x.listItems(x.propEl(kn, 'netzwerkInterfaces'))[0], 'ip'));
      var label = nom || firstIp || (kind === 'switch' ? 'Switch ' : 'Appareil ') + (k + 1);
      var n = { id: id, kind: kind, type: kind, label: label, x: pos.x, y: pos.y };

      if (kind === 'switch') {
        var sw = x.propEl(kn, 'anschluesse');
        for (var c = sw ? sw.firstElementChild : null; c; c = c.nextElementSibling) {
          if (c.hasAttribute('index') && c.getAttribute('id')) portOwner[c.getAttribute('id')] = { n: id, i: Number(c.getAttribute('index')) };
        }
        nodes.push(n);
        return;
      }

      // Interfaces réseau : adresse, passerelle, DNS et port de chacune
      var ifs = x.listItems(x.propEl(kn, 'netzwerkInterfaces'));
      n.ifaces = ifs.map(function (f, i) {
        var pid = portId(x, x.propEl(f, 'port'));
        if (pid) portOwner[pid] = { n: id, i: i };
        return { ip: x.text(x.prop(f, 'ip')) };
      });
      if (!n.ifaces.length) n.ifaces = [{ ip: '' }];

      var os = x.propEl(kn, 'systemSoftware');
      if (kind === 'router') {
        routers++;
        if (x.text(x.prop(os, 'ripEnabled')) === 'true') ripRouters++;
        n.defGw = '';
        nodes.push(n);
        return;
      }
      var first = ifs[0];
      n.gw = first ? x.text(x.prop(first, 'gateway')) : '';
      n.dns = first ? x.text(x.prop(first, 'dns')) : '';

      // Logiciels installés : « put » (clé + objet) ou « get » (l'élément porte la clé)
      var installed = [];
      var apps = x.propEl(os, 'installierteAnwendungen');
      for (var a = apps ? apps.firstElementChild : null; a; a = a.nextElementSibling) {
        var key = a.querySelector(':scope > string');
        if (!key) continue;
        var kname = key.textContent.trim();
        var app = a.getAttribute('method') === 'put' ? x.resolve(a.querySelector(':scope > object')) : a;
        if (!SOFT_OF[kname]) { warnings.push('Logiciel non repris sur ' + label + ' : ' + kname.split('.').pop() + '.'); continue; }
        installed.push({ sid: SOFT_OF[kname], active: x.text(x.prop(app, 'aktiv')) !== 'false' });
      }
      n.software = installed.map(function (s) { return s.sid; });
      installed.forEach(function (s) {
        if (s.sid === 'dns') { n.dnsSvc = true; if (!s.active) n.svcStop = Object.assign(n.svcStop || {}, { dns: true }); }
        if (s.sid === 'web') { n.web = true; if (!s.active) n.svcStop = Object.assign(n.svcStop || {}, { web: true }); }
      });

      // Fichiers : hosts du DNS (enregistrements), index.html du serveur web
      var files = [];
      var dfs = x.propEl(os, 'dateisystem');
      var root = dfs ? x.propEl(dfs, 'arbeitsVerzeichnis') : null;
      if (root) collectFiles(x, root, '', files);
      files.forEach(function (f) {
        if (f.folder === 'dns' && f.name === 'hosts') n.records = hostsRecords(f.content);
        else if (f.folder === 'webserver' && f.name === 'index.html') n.pageHtml = f.content;
      });
      if (n.dnsSvc && !n.records) n.records = {};
      var autres = files.filter(function (f) {
        return !((f.folder === 'dns' && f.name === 'hosts') || (f.folder === 'webserver' && f.name === 'index.html'));
      });
      if (autres.length) warnings.push('Fichiers non repris sur ' + label + ' : ' + autres.map(function (f) { return (f.folder ? f.folder + '/' : '') + f.name; }).join(', ') + '.');
      nodes.push(n);
    });

    // Câbles : chaque câble relie deux ports (<array> de deux références)
    Array.prototype.forEach.call(doc.getElementsByTagName('object'), function (o) {
      if (o.getAttribute('class') !== 'filius.gui.netzwerksicht.GUIKabelItem') return;
      var kab = x.prop(o, 'dasKabel');
      var wrap = kab ? x.propEl(kab, 'anschluesse') : null;
      var arr = wrap ? wrap.firstElementChild : null;
      var ends = [];
      for (var c = arr ? arr.firstElementChild : null; c; c = c.nextElementSibling) {
        var r = c.firstElementChild ? x.resolve(c.firstElementChild) : null;
        ends.push(r ? r.getAttribute('id') : '');
      }
      var a = portOwner[ends[0]], b = portOwner[ends[1]];
      if (!a || !b) { warnings.push('Câble ignoré : une extrémité n\'est reliée à aucun appareil repris.'); return; }
      links.push({ a: a, b: b });
    });

    if (ripRouters > 1) warnings.push('Routage automatique (RIP) non reproduit : saisissez les routes dans la table de routage.');
    var docs = doc.querySelectorAll('object[class="filius.gui.netzwerksicht.GUIDocuItem"]').length;
    if (docs) warnings.push(docs + ' document(s) ignoré(s).');
    return { nodes: nodes, links: links, warnings: warnings };
  }

  global.FiliusImport = { read: read };
})(window);
