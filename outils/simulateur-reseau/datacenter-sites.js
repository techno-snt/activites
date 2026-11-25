// Sites hébergés par le datacenter de l'exemple : contenu fixe, non modifiable dans le simulateur.
// Chaque site est une page HTML autonome (CSS et images SVG en ligne, sans script).
window.DC_SITES = [
  {
    name: 'www.boulangerie-dupont.fr',
    title: 'Boulangerie Dupont',
    html: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
body{margin:0;font-family:Georgia,'Times New Roman',serif;background:#fffaf2;color:#3b2314}
header{background:#7c2d12;color:#fff7ed;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
header h1{font-size:19px;margin:0;margin-right:auto;letter-spacing:.4px}
header a{color:#fed7aa;font-family:Arial,sans-serif;font-size:12px;text-decoration:none;margin-left:10px}
.hero{display:flex;align-items:center;gap:16px;padding:16px}
.hero h2{margin:0 0 6px;font-size:18px;color:#7c2d12}
.hero p{margin:0;font-size:13px;line-height:1.5;font-family:Arial,sans-serif}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:4px 16px 14px}
.card{background:#fff;border:1px solid #f5d0a9;border-radius:10px;overflow:hidden;text-align:center;font-family:Arial,sans-serif}
.card .band{height:8px;background:#fb923c}
.card div{padding:8px 6px}
.card b{display:block;font-size:13px;color:#7c2d12}
.card span{font-size:12px;color:#92400e}
footer{background:#3b2314;color:#fde68a;font-family:Arial,sans-serif;font-size:11px;padding:10px 16px;line-height:1.5}
</style></head><body>
<header><h1>Boulangerie Dupont</h1><a>Accueil</a><a>Produits</a><a>Horaires</a><a>Contact</a></header>
<div class="hero">
<svg width="150" height="105" viewBox="0 0 150 105" aria-hidden="true">
<ellipse cx="75" cy="92" rx="66" ry="8" fill="#fde68a"/>
<path d="M18 74c0-30 22-46 57-46s57 16 57 46c0 8-6 12-14 12H32c-8 0-14-4-14-12z" fill="#d97706"/>
<path d="M34 50 L44 72 M58 42 L62 72 M82 42 L78 72 M106 50 L98 72" stroke="#fef3c7" stroke-width="4" stroke-linecap="round"/>
<path d="M38 24c6-10 12-10 16-4M80 16c6-8 12-8 16-2" stroke="#b45309" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>
<div><h2>Fait maison, chaque matin</h2><p>Pain au levain, viennoiseries et gâteaux cuits dans notre four à bois depuis 1962.</p></div>
</div>
<div class="grid">
<div class="card"><div class="band"></div><div><b>Pain de campagne</b><span>3,20 €</span></div></div>
<div class="card"><div class="band"></div><div><b>Croissant au beurre</b><span>1,20 €</span></div></div>
<div class="card"><div class="band"></div><div><b>Éclair au chocolat</b><span>2,50 €</span></div></div>
</div>
<footer>12 rue des Lilas · Ouvert du mardi au dimanche, de 6 h 30 à 19 h 30 · Commandes par téléphone au 01 00 00 00 00</footer>
</body></html>`
  },
  {
    name: 'www.cinema-lumiere.fr',
    title: 'Cinéma Lumière',
    html: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
body{margin:0;font-family:Arial,sans-serif;background:#0b1020;color:#e2e8f0}
header{padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:2px solid #facc15}
header h1{font-size:18px;margin:0;color:#facc15;letter-spacing:1px}
.hero{display:flex;align-items:center;gap:14px;padding:14px 16px}
.hero h2{margin:0 0 4px;font-size:17px}
.hero p{margin:0;font-size:12px;color:#94a3b8;line-height:1.5}
.film{display:flex;gap:12px;align-items:center;margin:0 16px 10px;padding:8px;background:#111833;border-radius:10px}
.film b{display:block;font-size:14px}
.film small{color:#94a3b8;font-size:11px}
.time{margin-left:auto;background:#facc15;color:#0b1020;font-weight:bold;border-radius:6px;padding:4px 8px;font-size:12px;white-space:nowrap}
footer{font-size:11px;color:#94a3b8;padding:10px 16px;border-top:1px solid #1e293b;margin-top:6px}
</style></head><body>
<header><h1>CINÉMA LUMIÈRE</h1></header>
<div class="hero">
<svg width="140" height="100" viewBox="0 0 140 100" aria-hidden="true">
<rect x="14" y="30" width="112" height="60" rx="4" fill="#1f2937"/>
<path d="M14 30 L40 8 L120 8 L126 30 Z" fill="#374151"/>
<path d="M20 36 L42 16 M46 36 L68 16 M72 36 L94 16 M98 36 L120 16" stroke="#facc15" stroke-width="7"/>
<rect x="14" y="30" width="112" height="60" rx="4" fill="none" stroke="#facc15" stroke-width="2"/>
<circle cx="70" cy="62" r="14" fill="none" stroke="#facc15" stroke-width="3"/>
<circle cx="70" cy="62" r="3" fill="#facc15"/>
</svg>
<div><h2>Cette semaine à l'affiche</h2><p>Trois films, quatre salles, des séances en version originale.</p></div>
</div>
<div class="film"><svg width="34" height="46" viewBox="0 0 34 46" aria-hidden="true"><rect width="34" height="46" rx="4" fill="#1e3a8a"/><circle cx="17" cy="18" r="7" fill="#facc15"/><path d="M6 42 Q17 26 28 42Z" fill="#60a5fa"/></svg><div><b>La Grande Ourse</b><small>Drame · 1 h 52</small></div><span class="time">20 h 30</span></div>
<div class="film"><svg width="34" height="46" viewBox="0 0 34 46" aria-hidden="true"><rect width="34" height="46" rx="4" fill="#be185d"/><rect x="8" y="10" width="18" height="8" fill="#fde68a"/><rect x="8" y="24" width="18" height="12" fill="#fbcfe8"/></svg><div><b>Mer calme</b><small>Comédie · 1 h 35</small></div><span class="time">18 h 00</span></div>
<div class="film"><svg width="34" height="46" viewBox="0 0 34 46" aria-hidden="true"><rect width="34" height="46" rx="4" fill="#065f46"/><path d="M8 34 L17 10 L26 34Z" fill="#6ee7b7"/></svg><div><b>Les Cadrans</b><small>Animation · 1 h 20</small></div><span class="time">16 h 15</span></div>
<footer>Tarif plein 8 € · Tarif réduit 6 € · Place de la Gare · Réservation sur place</footer>
</body></html>`
  },
  {
    name: 'www.mairie-exemple.fr',
    title: 'Mairie',
    html: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
body{margin:0;font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a}
header{background:#1e3a8a;color:#ffffff;padding:12px 16px;display:flex;align-items:center;gap:10px}
header h1{font-size:17px;margin:0}
.hero{display:flex;align-items:center;gap:14px;padding:14px 16px;background:#ffffff;border-bottom:1px solid #e2e8f0}
.hero h2{margin:0 0 4px;font-size:16px;color:#1e3a8a}
.hero p{margin:0;font-size:12px;color:#475569;line-height:1.5}
.services{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:14px 16px}
.service{background:#ffffff;border:1px solid #cbd5e1;border-left:5px solid #1e3a8a;border-radius:6px;padding:10px;font-size:13px}
.service b{display:block;color:#1e3a8a;margin-bottom:2px}
.service span{color:#475569;font-size:11px}
footer{background:#e2e8f0;font-size:11px;color:#334155;padding:10px 16px;line-height:1.5}
</style></head><body>
<header><h1>Mairie</h1></header>
<div class="hero">
<svg width="130" height="100" viewBox="0 0 130 100" aria-hidden="true">
<rect x="0" y="0" width="130" height="100" rx="8" fill="#dbeafe"/>
<circle cx="104" cy="22" r="10" fill="#fde68a"/>
<path d="M20 44 L65 20 L110 44 Z" fill="#1e3a8a"/>
<rect x="24" y="46" width="82" height="8" fill="#e2e8f0"/>
<rect x="30" y="54" width="8" height="30" fill="#f1f5f9"/><rect x="48" y="54" width="8" height="30" fill="#f1f5f9"/>
<rect x="66" y="54" width="8" height="30" fill="#f1f5f9"/><rect x="84" y="54" width="8" height="30" fill="#f1f5f9"/>
<rect x="18" y="84" width="94" height="6" fill="#1e3a8a"/>
<path d="M65 6 L65 -6" stroke="#1e3a8a" stroke-width="2"/><path d="M65 -6 L76 -2 L65 2Z" fill="#dc2626"/>
</svg>
<div><h2>Vos démarches, en ligne ou au guichet</h2><p>La mairie vous accueille du lundi au vendredi. Retrouvez ici les services de la commune.</p></div>
</div>
<div class="services">
<div class="service"><b>État civil</b><span>Actes de naissance, mariage, décès</span></div>
<div class="service"><b>Urbanisme</b><span>Permis de construire, déclarations de travaux</span></div>
<div class="service"><b>Écoles</b><span>Inscriptions et restauration scolaire</span></div>
<div class="service"><b>Vie associative</b><span>Salles et subventions</span></div>
</div>
<footer>Place de la Mairie · Lundi au vendredi, 8 h 30 – 12 h et 13 h 30 – 17 h 00 · Standard : 01 00 00 00 01</footer>
</body></html>`
  }
];
