// assets/tarifs.js — robust & basepath-safe (tarifs + primes)
(function(){
  function root(){
    try{
      const s = document.currentScript?.src || '';
      const u = new URL(s, location.href);
      return u.pathname.replace(/assets\/tarifs\.js.*$/,'');
    }catch(e){
      const p = location.pathname.split('/').filter(Boolean);
      return p.length ? '/' + p[0] + '/' : '/';
    }
  }
  async function getJSON(path, tries=3){
    const url = root() + path + '?t=' + Date.now();
    for(let i=0;i<tries;i++){
      try{
        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), 8000);
        const res = await fetch(url,{cache:'no-store', signal: ctrl.signal});
        clearTimeout(t);
        if(!res.ok) throw new Error('HTTP '+res.status);
        return await res.json();
      }catch(err){
        if(i === tries-1) throw err;
        await new Promise(r=>setTimeout(r, 600*(i+1)));
      }
    }
  }
  const FALLBACK_TARIFS = {
    version: "T3-2025",
    last_updated: new Date().toISOString().slice(0,10),
    edf_oa_surplus: [
      {range:"≤ 9 kWc",   segment:"particuliers",  eur_per_kwh:0.0400, example_surplus_kwh:1000},
      {range:"9–36 kWc",  segment:"petites pros", eur_per_kwh:0.0400, example_surplus_kwh:5000},
      {range:"36–100 kWc",segment:"PME/PMI",      eur_per_kwh:0.0886, example_surplus_kwh:20000}
    ],
    avg_autoconsommation_value_ttc_eur_per_kwh: 0.25
  };
  function euro(n){ return n.toLocaleString('fr-FR',{style:'currency',currency:'EUR'}); }

  async function renderTarifs(){
    const body = document.querySelector('#tarifs-table-body');
    if(!body) return;
    let data;
    try{
      data = await getJSON('data/tarifs.json', 3);
    }catch(e){
      console.warn('tarifs.json KO → fallback', e);
      data = FALLBACK_TARIFS;
      const meta = document.querySelector('#tarifs-meta');
      if(meta) meta.textContent = '⚠️ Données locales (fallback) — vérifiez /data/tarifs.json';
    }
    body.innerHTML = '';
    for(const row of data.edf_oa_surplus){
      const euros = Number(row.eur_per_kwh||0);
      const exkwh = Number(row.example_surplus_kwh||0);
      body.insertAdjacentHTML('beforeend',`
        <tr>
          <th scope="row">${row.range} (${row.segment})</th>
          <td><strong>${euros.toFixed(4).replace('.', ',')}</strong></td>
          <td>Surplus ${exkwh.toLocaleString('fr-FR')} kWh → <strong>${euro(exkwh*euros)}</strong>/an</td>
        </tr>`);
    }
    const caption = document.querySelector('#tarifs-caption');
    if(caption) caption.textContent = `Tarifs de rachat (EDF OA) — Surplus (${data.version||'à jour'})`;
    const meta = document.querySelector('#tarifs-meta');
    if(meta) meta.textContent = `✅ Données à jour — ${new Date(data.last_updated||Date.now()).toLocaleDateString('fr-FR')}`;
    const kpi = document.querySelector('#kpi-autoconso-value');
    if(kpi && data.avg_autoconsommation_value_ttc_eur_per_kwh){
      kpi.innerHTML = `💡 Un kWh autoconsommé vaut ~<strong>${Number(data.avg_autoconsommation_value_ttc_eur_per_kwh).toFixed(2).replace('.', ',')} €/kWh TTC</strong>`;
    }
  }

  async function renderPrimes(){
    const body = document.querySelector('#prime-table-body');
    const meta = document.querySelector('#prime-meta');
    if(!body) return;
    try{
      const data = await getJSON('data/primes.json', 3);
      body.innerHTML = '';
      for(const row of (data.prime_autoconsommation_eur_per_kwc||[])){
        body.insertAdjacentHTML('beforeend', `<tr><td>${row.range}</td><td>${Number(row.eur_per_kwc||0).toLocaleString('fr-FR')}</td></tr>`);
      }
      if(meta) meta.textContent = `✅ Données à jour — ${new Date(data.last_updated||Date.now()).toLocaleDateString('fr-FR',{year:'numeric',month:'long'})}`;
    }catch(e){
      console.warn('primes.json KO', e);
      if(meta) meta.textContent = '⚠️ Données locales (fallback) — vérifiez /data/primes.json';
    }
  }

  document.addEventListener('DOMContentLoaded', ()=>{ renderTarifs(); renderPrimes(); });
})();