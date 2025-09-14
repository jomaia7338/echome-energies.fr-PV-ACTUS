// Node >=18 (fetch natif). Aucun package requis.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const INPUT = process.env.SOURCES_JSON || "data/outils_newsletters_pv.json";
const OUT_JSON = process.env.OUT_JSON || "reports/feeds.json";
const OUT_NDJSON = process.env.OUT_NDJSON || "reports/feeds.ndjson";
const OUT_SUMMARY = process.env.OUT_SUMMARY || "reports/feeds_summary.md";
const ITEMS_PER_SOURCE = Number(process.env.ITEMS_PER_SOURCE || 5);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const UA = "Echome-FeedsScraper/1.0 (+https://echome-energies.fr)";

function timeoutFetch(url, opt={}, ms=TIMEOUT_MS) {
  const c = new AbortController();
  const id = setTimeout(()=>c.abort(), ms);
  return fetch(url, { ...opt, signal: c.signal }).finally(()=>clearTimeout(id));
}

const isXml = (ct="") => /xml|rss|atom/i.test(ct);
const toAbs = (u, base) => {
  try { return new URL(u, base).href; } catch { return null; }
};

// --- Parsing RSS/Atom minimal (sans libs) ---
function parseXmlItems(xml, baseUrl) {
  // RSS: <item><title>, <link>, <pubDate>
  // Atom: <entry><title>, <link href>, <updated|published>
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml);
  if (!isAtom) {
    const itemRe = /<item\b[\s\S]*?<\/item>/gi;
    const titRe  = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
    const linkRe = /<link\b[^>]*>([\s\S]*?)<\/link>/i;
    const dateRe = /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i;
    const seen = new Set();
    let m;
    while ((m = itemRe.exec(xml)) && items.length < ITEMS_PER_SOURCE) {
      const chunk = m[0];
      const title = (chunk.match(titRe)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
      let link = (chunk.match(linkRe)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
      if (!link) {
        // RSS alternative: <guid isPermaLink="true">...</guid>
        const alt = chunk.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim();
        if (alt && /^https?:\/\//i.test(alt)) link = alt;
      }
      const date = chunk.match(dateRe)?.[1]?.trim() || null;
      if (title && (link = toAbs(link, baseUrl)) && !seen.has(link)) {
        seen.add(link);
        items.push({ title, url: link, date });
      }
    }
  } else {
    const entryRe = /<entry\b[\s\S]*?<\/entry>/gi;
    const titRe   = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
    const linkRe  = /<link\b[^>]*href=["']?([^"'>\s]+)["']?[^>]*\/?>/i;
    const dateRe  = /<(updated|published)\b[^>]*>([\s\S]*?)<\/\1>/i;
    const seen = new Set();
    let m;
    while ((m = entryRe.exec(xml)) && items.length < ITEMS_PER_SOURCE) {
      const chunk = m[0];
      const title = (chunk.match(titRe)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g,"").trim();
      const link  = toAbs(chunk.match(linkRe)?.[1] || "", baseUrl);
      const date  = chunk.match(dateRe)?.[2]?.trim() || null;
      if (title && link && !seen.has(link)) {
        seen.add(link);
        items.push({ title, url: link, date });
      }
    }
  }
  return items;
}

// --- Découverte de feed <link rel="alternate"> ---
function discoverFeeds(html, baseUrl) {
  const linkRe = /<link\s+[^>]*rel=["']?alternate["']?[^>]*>/gi;
  const hrefRe = /href=["']?([^"'>\s]+)["']?/i;
  const typeRe = /type=["']?([^"'>\s]+)["']?/i;
  const feeds = [];
  let m;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const type = tag.match(typeRe)?.[1] || "";
    if (/rss|atom|xml/i.test(type)) {
      const href = toAbs(tag.match(hrefRe)?.[1] || "", baseUrl);
      if (href) feeds.push(href);
    }
  }
  // Heuristiques si rien trouvé
  if (!feeds.length) {
    ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml"].forEach(suf => {
      const h = toAbs(suf, baseUrl);
      if (h) feeds.push(h);
    });
  }
  return [...new Set(feeds)];
}

// --- Fallback HTML : titres simples depuis la home ---
function parseHtmlTitles(html, baseUrl) {
  const titles = [];
  // <h1>/<h2> avec lien
  const hRe = /<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const aRe = /<a\b[^>]*href=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/a>/i;
  const striptags = s => s.replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();

  let m;
  while ((m = hRe.exec(html)) && titles.length < ITEMS_PER_SOURCE) {
    const seg = m[2];
    const am = seg.match(aRe);
    if (am) {
      const url = toAbs(am[1], baseUrl);
      const txt = striptags(am[2]);
      if (url && txt && !titles.find(t => t.url === url)) {
        titles.push({ title: txt, url });
      }
    }
  }
  // Si vide, fallback sur <a> du hero
  if (!titles.length) {
    const aAll = [...html.matchAll(/<a\b[^>]*href=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ href: toAbs(m[1], baseUrl), txt: m[2]?.replace(/<[^>]+>/g,"").trim() }))
      .filter(o => o.href && o.txt && o.txt.length > 4);
    for (const o of aAll) {
      if (titles.length >= ITEMS_PER_SOURCE) break;
      titles.push({ title: o.txt, url: o.href });
    }
  }
  return titles.slice(0, ITEMS_PER_SOURCE);
}

async function fetchText(url) {
  const r = await timeoutFetch(url, { headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml,application/xml;q=0.9" }});
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  return { text, ct, finalUrl: r.url, status: r.status, ok: r.ok };
}

async function scrapeSource(src) {
  const base = src.url;
  const out = { source_id: src.id, source_name: src.name, source_url: base, items: [], mode: null, status: null, error: null };
  try {
    // 1) Découvrir RSS/Atom
    const home = await fetchText(base);
    out.status = home.status;
    if (!home.ok) throw new Error(`HTTP ${home.status} sur home`);

    const feeds = discoverFeeds(home.text, home.finalUrl);
    for (const f of feeds) {
      try {
        const feed = await fetchText(f);
        if (!feed.ok) continue;
        if (isXml(feed.ct) || /<rss|<feed/i.test(feed.text)) {
          const items = parseXmlItems(feed.text, f);
          if (items.length) {
            out.items = items;
            out.mode = "rss";
            return out;
          }
        }
      } catch {}
    }

    // 2) Fallback HTML
    const items = parseHtmlTitles(home.text, home.finalUrl);
    out.items = items;
    out.mode = "html";
    return out;

  } catch (e) {
    out.error = String(e?.message || e);
    return out;
  }
}

async function pMap(items, mapper, concurrency=CONCURRENCY) {
  const ret = new Array(items.length);
  let i = 0, active = 0;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (i >= items.length && active === 0) return resolve(ret);
      while (active < concurrency && i < items.length) {
        const idx = i++;
        active++;
        Promise.resolve(mapper(items[idx], idx))
          .then(res => { ret[idx] = res; active--; next(); })
          .catch(err => reject(err));
      }
    };
    next();
  });
}

async function main() {
  const raw = await readFile(INPUT, "utf-8");
  const data = JSON.parse(raw);
  const sources = data.sources || [];
  if (!sources.length) throw new Error("Aucune source dans le JSON.");

  await mkdir(dirname(OUT_JSON), { recursive: true });

  const results = await pMap(sources, scrapeSource, CONCURRENCY);
  const scraped_at = new Date().toISOString();

  const flatItems = [];
  for (const r of results) {
    (r.items || []).forEach(it => flatItems.push({
      source_id: r.source_id,
      source_name: r.source_name,
      source_url: r.source_url,
      mode: r.mode,
      title: it.title,
      url: it.url,
      date: it.date || null,
      scraped_at
    }));
  }

  await writeFile(OUT_JSON, JSON.stringify({ scraped_at, count: flatItems.length, items: flatItems }, null, 2), "utf-8");
  await writeFile(OUT_NDJSON, flatItems.map(x => JSON.stringify(x)).join("\n") + "\n", "utf-8");

  // Summary
  const ok = results.filter(r => (r.items||[]).length).length;
  const ko = results.length - ok;
  const perMode = {
    rss: results.filter(r => r.mode === "rss").length,
    html: results.filter(r => r.mode === "html").length
  };
  const sample = flatItems.slice(0, 10).map(i => `- ${i.source_name}: ${i.title} → ${i.url}`).join("\n");
  const md = `# Synthèse scraping newsletters PV

- Sources: ${results.length}
- OK (≥1 item): ${ok} / KO: ${ko}
- Mode RSS/Atom: ${perMode.rss} | Fallback HTML: ${perMode.html}
- Total items: ${flatItems.length}
- Exemples:
${sample || "(aucun élément extrait)"}
`;
  await writeFile(OUT_SUMMARY, md, "utf-8");

  console.log(`✅ Scraping terminé — items: ${flatItems.length}`);
}

main().catch(err => {
  console.error("Erreur scraping:", err);
  process.exit(1); // échec du job si scraping KO
});
