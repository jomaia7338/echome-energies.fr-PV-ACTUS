// scripts/check-sources.mjs
// Node >=18 (fetch natif). Aucun package requis.
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const INPUT = process.env.SOURCES_JSON || "data/outils_newsletters_pv.json";
const OUT_JSON = process.env.OUT_JSON || "reports/url_status.json";
const OUT_CSV  = process.env.OUT_CSV  || "reports/url_status.csv";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const USER_AGENT = "Echome-NewsChecker/1.0 (+https://echome-energies.fr)";

function timeoutFetch(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function checkOne(src) {
  const t0 = performance.now();
  const info = {
    id: src.id, name: src.name, url: src.url,
    category: src.category, region: src.region,
    status: null, ok: false, response_time_ms: null,
    final_url: null, redirects: null, error: null
  };
  try {
    const resp = await timeoutFetch(src.url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, "accept": "text/html,application/xhtml+xml" },
    });
    info.status = resp.status;
    info.ok = resp.ok || (resp.status >= 200 && resp.status < 400);
    info.final_url = resp.url;
    info.redirects = resp.redirected ? "yes" : "no";
  } catch (e) {
    info.error = String(e?.message || e);
  } finally {
    info.response_time_ms = Math.round(performance.now() - t0);
  }
  return info;
}

async function pMap(items, mapper, concurrency = 8) {
  const ret = [];
  let i = 0, active = 0;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (i >= items.length && active === 0) return resolve(ret);
      while (active < concurrency && i < items.length) {
        const cur = i++;
        active++;
        Promise.resolve(mapper(items[cur], cur))
          .then((res) => { ret[cur] = res; active--; next(); })
          .catch((err) => reject(err));
      }
    };
    next();
  });
}

function toCSV(rows) {
  const headers = ["id","name","url","category","region","status","ok","response_time_ms","final_url","redirects","error"];
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replaceAll('"','""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}

async function main() {
  const raw = await readFile(INPUT, "utf-8").catch(() => null);
  if (!raw) {
    console.error(`❌ Fichier introuvable : ${INPUT}`);
    process.exit(1);
  }
  let data;
  try { data = JSON.parse(raw); } catch(e) {
    console.error(`❌ JSON invalide : ${INPUT}`);
    process.exit(1);
  }
  const sources = Array.isArray(data.sources) ? data.sources : [];
  if (!sources.length) {
    console.error("❌ Aucune source dans 'sources'.");
    process.exit(1);
  }

  console.log(`▶️  Vérification de ${sources.length} URL (timeout ${TIMEOUT_MS} ms, parallélisme ${CONCURRENCY})…`);
  const results = await pMap(sources, checkOne, CONCURRENCY);
  const ok = results.filter(r => r.ok).length;
  const ko = results.length - ok;
  console.log(`✅ OK: ${ok}  |  ❌ KO: ${ko}`);

  // Écrit les rapports
  await writeFile(OUT_JSON, JSON.stringify({ checked_at: new Date().toISOString(), results }, null, 2), "utf-8");
  await writeFile(OUT_CSV, toCSV(results), "utf-8");

  // Expose des résultats pour l'étape suivante (issue/commentaire)
  const fails = results.filter(r => !r.ok).map(r => `- [${r.name}](${r.url}) → ${r.status || r.error || "ERREUR"}`).join("\n");
  const summary = `OK: ${ok} / KO: ${ko}\n\n${fails || "Tous les liens répondent correctement."}`;
  await writeFile("reports/summary.md", `# Vérification des sources\n\n${summary}\n`, "utf-8");

  // Code de sortie non bloquant (on laisse le job réussir même s'il y a des KO)
  // Si tu veux rendre le job "rouge" en cas de KO, dé-commente la ligne suivante :
  // if (ko > 0) process.exit(2);
}
await main();
