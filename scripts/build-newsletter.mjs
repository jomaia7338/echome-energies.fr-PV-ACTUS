// Node >=18. Lit tarifs/primes + feeds.json, remplace les {{…}} et écrit docs/index.html
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const PATHS = {
  template: "templates/newsletter.template.html",
  tarifs:   "data/tarifs.json",
  primes:   "data/primes.json",
  feeds:    "reports/feeds.json", // produit par scrape-feeds
  out:      "docs/index.html"
};

function fmtDateFR(d=new Date()){ return new Date(d).toLocaleDateString("fr-FR"); }
function esc(s){ return String(s).replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }

function buildTarifsRows(tarifs=[]) {
  if (!Array.isArray(tarifs) || !tarifs.length) return `<tr><td colspan="3">Non disponible</td></tr>`;
  // Attendu: [{puissance:"≤ 9 kWc", tarif:0.0400, exemple:"…"}, ...]
  return tarifs.map(t => `<tr><td>${esc(t.puissance||"")}</td><td>${(t.tarif??"").toString().replace(".",",")}</td><td>${esc(t.exemple||"—")}</td></tr>`).join("\n");
}
function buildPrimesRows(primes=[]) {
  if (!Array.isArray(primes) || !primes.length) return `<tr><td colspan="2">Non disponible</td></tr>`;
  // Attendu: [{puissance:"≤ 3 kWc", prime:330}, ...]
  return primes.map(p => `<tr><td>${esc(p.puissance||"")}</td><td>${(p.prime??"").toString().replace(".",",")}</td></tr>`).join("\n");
}
function groupBySource(items){
  const by = new Map();
  for(const it of items){
    const key = it.source_name || it.source_id || "source";
    if(!by.has(key)) by.set(key, []);
    by.get(key).push(it);
  }
  return by;
}
function buildNewsItems(feedData, maxSources=4, maxPerSource=2){
  const items = Array.isArray(feedData?.items) ? feedData.items : [];
  if (!items.length) return `<article><h3>Aucune actualité</h3><p>Le flux n’a pas encore été alimenté.</p></article>`;
  // Trier par date si dispo
  items.sort((a,b)=> new Date(b.date||0) - new Date(a.date||0));
  const by = groupBySource(items);
  const blocks = [];
  for (const [src, list] of Array.from(by.entries()).slice(0, maxSources)) {
    const chunk = list.slice(0, maxPerSource).map(it => {
      const date = it.date ? ` · <small>${fmtDateFR(it.date)}</small>` : "";
      const title = esc(it.title||"(sans titre)");
      const url = esc(it.url||"#");
      return `<li><a href="${url}" target="_blank" rel="noopener">${title}</a>${date}</li>`;
    }).join("");
    blocks.push(`<article><h3>${esc(src)}</h3><ul class="clean">${chunk}</ul></article>`);
  }
  return blocks.join("\n");
}

function injectEditorialDefaults(html){
  const repl = (k,v)=> html = html.replaceAll(`{{${k}}}`, v);
  repl("INNOV_TECH", "Décrire en 2–3 phrases l’innovation mise en avant (ex. pilotage des usages, stockage, agrivoltaïsme).");
  repl("INNOV_POINTS", "<li>Cas d’usage 1</li><li>Cas d’usage 2</li><li>Cas d’usage 3</li>");
  repl("CAS_INTRO", "Présentation brève d’une installation (site, puissance, objectifs, résultats mesurés).");
  repl("CAS_POINTS", "<li>Site : [Maison/PME] — Puissance : [9/36 kWc]</li><li>Prod. annuelle : [x] kWh — Autoconsommation : [x] %</li><li>Économie annuelle : [x] € — CO₂ évité : [x] t/an</li>");
  repl("CONSEIL_POINTS", "<li>Dimensionnement et programmation ECS</li><li>Pilotage IRVE/PAC</li><li>Suivi & maintenance</li>");
  return html;
}

async function main(){
  const [tpl, tarifsRaw, primesRaw, feedsRaw] = await Promise.allSettled([
    readFile(PATHS.template, "utf-8"),
    readFile(PATHS.tarifs, "utf-8"),
    readFile(PATHS.primes, "utf-8"),
    readFile(PATHS.feeds, "utf-8").catch(()=> "{}"),
  ]);

  let html = tpl.status==="fulfilled" ? tpl.value : "<!doctype html><title>Newsletter</title><body>{{EDITION_DATE}}{{NEWS_ITEMS}}</body>";

  const tarifs = tarifsRaw.status==="fulfilled" ? JSON.parse(tarifsRaw.value) : [];
  const primes = primesRaw.status==="fulfilled" ? JSON.parse(primesRaw.value) : [];
  const feeds  = feedsRaw.status==="fulfilled"  ? JSON.parse(feedsRaw.value)  : { items: [] };

  const today = fmtDateFR();
  html = html.replaceAll("{{EDITION_DATE}}", today);
  html = html.replaceAll("{{MAJ_TARIFS}}", today);
  html = html.replaceAll("{{MAJ_PRIME}}", today);
  html = html.replaceAll("{{YEAR}}", String(new Date().getFullYear()));
  html = html.replaceAll("{{TARIFS_TABLE_ROWS}}", buildTarifsRows(tarifs));
  html = html.replaceAll("{{PRIMES_TABLE_ROWS}}", buildPrimesRows(primes));
  html = html.replaceAll("{{NEWS_ITEMS}}", buildNewsItems(feeds, 4, 2));

  html = injectEditorialDefaults(html);

  await mkdir(dirname(PATHS.out), { recursive: true });
  await writeFile(PATHS.out, html, "utf-8");
  console.log("✅ Newsletter générée :", PATHS.out);
}
main().catch(e => { console.error(e); process.exit(1); });
