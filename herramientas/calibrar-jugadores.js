// Calibración de los picks de yardas, fuera de muestra: el factor se ajusta con 2020-2022 y se mide en
// 2023-2025. Línea de prueba = mediana de los últimos 10 partidos del jugador (no la de la casa).
// Solo jugadores con rol (3 de los 4 últimos partidos del equipo y uso mínimo).
// Uso: node calibrar-jugadores.js [carpeta con pl_2019.csv … pl_2025.csv]   (sin carpeta, los baja)
const fs = require('fs'), path = require('path');
const M = require('../modelo.js');
const carpeta = process.argv[2], URL = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_';
const EST = { pase: { col: 4, uso: 3, min: 25 }, carrera: { col: 7, uso: 6, min: 10 }, recepcion: { col: 11, uso: 9, min: 4 } };
(async () => {
  const filas = [];
  for (let a = 2019; a <= 2025; a++) {
    const texto = carpeta ? fs.readFileSync(path.join(carpeta, `pl_${a}.csv`), 'utf8') : await (await fetch(URL + a + '.csv')).text();
    M.leerCSV(texto).forEach(r => {
      if (!['QB', 'WR', 'TE', 'RB'].includes(r.position) || r.season_type !== 'REG') return; const n = k => Number(r[k]) || 0;
      filas.push({ id: r.player_id, p: r.position, eq: M.ALIAS[r.team] || r.team, g: [a, +r.week, M.ALIAS[r.opponent_team] || r.opponent_team, n('attempts'), n('passing_yards'), n('passing_tds'), n('carries'), n('rushing_yards'), n('rushing_tds'), n('targets'), n('receptions'), n('receiving_yards'), n('receiving_tds')] });
    });
  }
  filas.sort((x, y) => x.g[0] - y.g[0] || x.g[1] - y.g[1]);
  const hist = {}, semEq = {}, casos = [];
  for (const f of filas) {
    const h = hist[f.id] = hist[f.id] || [], t = f.g[0], w = f.g[1], se = semEq[t + f.eq] = semEq[t + f.eq] || new Set();
    const est = h.filter(g => g[0] === t);
    if (t >= 2020 && w >= 5 && est.length >= 3) {
      const ult = [...se].filter(x => x < w).sort((a, b) => b - a).slice(0, 4), jugo = ult.filter(x => est.some(g => g[1] === x)).length;
      const pr = M.proyectar({ p: f.p, j: h.slice(-10) }, t, null, f.g[2]);
      if (pr && jugo >= 3) for (const k in EST) {
        if (!pr[k]) continue; const e = EST[k], uso = est.reduce((a, g) => a + g[e.uso], 0) / est.length; if (uso < e.min) continue;
        const ys = h.slice(-10).map(g => g[e.col]).sort((a, b) => a - b), linea = Math.floor(ys[Math.floor(ys.length / 2)]) + 0.5;
        casos.push({ t, q: M.probAlMenos(pr[k].m, pr[k].sd, Math.floor(linea) + 1), y: f.g[e.col] > linea ? 1 : 0 });
      }
    }
    h.push(f.g); se.add(w);
  }
  const ll = (lista, b) => lista.reduce((s, c) => { const q = Math.min(0.999, Math.max(0.001, 0.5 + (c.q - 0.5) * b)); return s - (c.y ? Math.log(q) : Math.log(1 - q)); }, 0);
  const entrena = casos.filter(c => c.t <= 2022), prueba = casos.filter(c => c.t >= 2023);
  let mejor = null; for (let b = 0.3; b <= 1.001; b += 0.05) { const v = ll(entrena, b); if (!mejor || v < mejor.v) mejor = { b: +b.toFixed(2), v }; }
  const picks = (lista, b) => { let n = 0, ok = 0, p = 0; lista.forEach(c => { const q = 0.5 + (c.q - 0.5) * b, pr = Math.max(q, 1 - q); if (pr < 0.65) return; n++; p += pr; ok += (c.y === 1) === (q >= 0.5) ? 1 : 0; }); return { n, acierto: ok / n, esperado: p / n }; };
  const r = { factor: mejor.b, ajustadoCon: '2020-2022', prueba: '2023-2025', linea: 'mediana de sus últimos 10 partidos', picks65: picks(prueba, mejor.b), sinCalibrar: picks(prueba, 1) };
  console.log(JSON.stringify(r));
})().catch(e => { console.error(e); process.exit(1); });
