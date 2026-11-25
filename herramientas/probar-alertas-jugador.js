// Tercera tanda, jugadores: ¿los picks con alerta aciertan lo que anuncian? Igual que calibrar-jugadores.js
// (línea = mediana de sus últimos 10, rol fijo), con la calibración de la página. Alertas:
//   muestra: el jugador lleva menos de 4 partidos en la temporada (la página exige 3)
//   qb:      el titular de su equipo figura en duda o dudoso en el parte de esa semana
// Factor ajustado con 2020-2022, prueba en 2023-2025.
// Uso: node probar-alertas-jugador.js <carpeta con pl_2019.csv … pl_2025.csv e inj_2020.csv … inj_2025.csv>
const fs = require('fs'), path = require('path');
const M = require('../modelo.js');
const D = process.argv[2];
const EST = { pase: { col: 4, uso: 3, min: 25, cal: 0.75 }, carrera: { col: 7, uso: 6, min: 10, cal: 0.75 }, recepcion: { col: 11, uso: 9, min: 4, cal: 0.75 }, atrapadas: { col: 10, uso: 9, min: 4, cal: 0.85 } };
const qbParte = {};
for (let a = 2020; a <= 2025; a++) M.leerCSV(fs.readFileSync(path.join(D, `inj_${a}.csv`), 'utf8')).forEach(r => {
  if (r.position === 'QB' && r.report_status) qbParte[a + '|' + Number(r.week) + '|' + (M.ALIAS[r.team] || r.team) + '|' + r.gsis_id] = r.report_status;
});
const filas = [], titularPorPartido = {};
for (let a = 2019; a <= 2025; a++) M.leerCSV(fs.readFileSync(path.join(D, `pl_${a}.csv`), 'utf8')).forEach(r => {
  if (!['QB', 'WR', 'TE', 'RB'].includes(r.position) || r.season_type !== 'REG') return; const n = k => Number(r[k]) || 0;
  const eq = M.ALIAS[r.team] || r.team, clave = a + '|' + r.week + '|' + eq;
  if (r.position === 'QB' && (!titularPorPartido[clave] || n('attempts') > titularPorPartido[clave].n)) titularPorPartido[clave] = { id: r.player_id, n: n('attempts') };
  filas.push({ id: r.player_id, p: r.position, eq, g: [a, +r.week, M.ALIAS[r.opponent_team] || r.opponent_team, n('attempts'), n('passing_yards'), n('passing_tds'), n('carries'), n('rushing_yards'), n('rushing_tds'), n('targets'), n('receptions'), n('receiving_yards'), n('receiving_tds')] });
});
filas.sort((x, y) => x.g[0] - y.g[0] || x.g[1] - y.g[1]);
const hist = {}, semEq = {}, casos = [];
for (const f of filas) {
  const h = hist[f.id] = hist[f.id] || [], t = f.g[0], w = f.g[1], se = semEq[t + f.eq] = semEq[t + f.eq] || new Set();
  const est = h.filter(g => g[0] === t);
  if (t >= 2020 && w >= 2 && est.length >= 3) {
    const ult = [...se].filter(x => x < w).sort((a, b) => b - a), jugo = ult.slice(0, 4).filter(x => est.some(g => g[1] === x)).length;
    const pr = jugo >= 3 ? M.proyectar({ p: f.p, j: h.slice(-10) }, t, null, f.g[2]) : null;
    // Titular del último partido del equipo y su estado en el parte de esta semana.
    const tit = ult.length ? titularPorPartido[t + '|' + ult[0] + '|' + f.eq] : null, st = tit ? qbParte[t + '|' + w + '|' + f.eq + '|' + tit.id] : '';
    const qb = f.p !== 'QB' && (st === 'Questionable' || st === 'Doubtful');
    if (pr) for (const k in EST) {
      const e = EST[k]; if (!pr[k]) continue;
      const uso = est.reduce((a, g) => a + g[e.uso], 0) / est.length; if (uso < e.min) continue;
      const ys = h.slice(-10).map(g => g[e.col]).sort((a, b) => a - b), linea = Math.floor(ys[Math.floor(ys.length / 2)]) + 0.5;
      const q = 0.5 + (M.probAlMenos(pr[k].m, pr[k].sd, Math.floor(linea) + 1) - 0.5) * e.cal, prob = Math.max(q, 1 - q);
      if (prob < 0.65 || prob > 0.80) continue;
      casos.push({ t, k, q: prob, y: (f.g[e.col] > linea) === (q >= 0.5) ? 1 : 0, muestra: est.length < 4, qb });
    }
  }
  h.push(f.g); se.add(w);
}
const resumen = l => { const n = l.length, ok = l.reduce((x, c) => x + c.y, 0), q = l.reduce((x, c) => x + c.q, 0); return { n, acierto: ok / n, anunciado: q / n }; };
const ll = (l, f) => l.reduce((x, c) => { const q = 0.5 + (c.q - 0.5) * f; return x - (c.y ? Math.log(q) : Math.log(1 - q)); }, 0);
const pc = x => (x * 100).toFixed(1) + '%', txt = r => (r.n ? `${r.n} · ${pc(r.acierto)} anunciando ${pc(r.anunciado)}` : 'sin casos');
console.log('Todos (65-80%): 2020-2022 ' + txt(resumen(casos.filter(c => c.t <= 2022))) + ' | 2023-2025 ' + txt(resumen(casos.filter(c => c.t >= 2023))));
const salida = {};
for (const al of ['muestra', 'qb']) {
  const tr = casos.filter(c => c.t <= 2022 && c[al]), te = casos.filter(c => c.t >= 2023 && c[al]);
  let f = 1, mejor = Infinity; for (let x = 0.3; x <= 1.001; x += 0.05) { const v = ll(tr, x); if (v < mejor) { mejor = v; f = +x.toFixed(2); } }
  const bajados = te.map(c => Object.assign({}, c, { q: 0.5 + (c.q - 0.5) * f })).filter(c => c.q >= 0.65);
  salida[al] = { entrena: resumen(tr), prueba: resumen(te), factor: f, bajados: resumen(bajados) };
  console.log(`[${al}] 2020-2022 ${txt(resumen(tr))} → factor ${f} | 2023-2025 ${txt(resumen(te))} | bajándolos ${txt(resumen(bajados))} | sin alerta 2023-2025 ${txt(resumen(casos.filter(c => c.t >= 2023 && !c[al])))}`);
}
if (process.env.GUARDAR) fs.writeFileSync(process.env.GUARDAR, JSON.stringify(salida));
