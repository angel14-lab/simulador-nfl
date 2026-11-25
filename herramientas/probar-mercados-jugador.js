// Punto 9 (jugadores): ¿los picks de recepciones y de yardas por tierra del QB aciertan lo que anuncian?
// Igual que calibrar-jugadores.js: línea = mediana de sus últimos 10 partidos, solo jugadores con rol
// (3 de los 4 últimos partidos del equipo y uso mínimo), factor de calibración ajustado con 2020-2022 y
// medido en 2023-2025. Entra solo si los picks de 65-80% aciertan al menos lo que anuncian (±1 punto).
// Uso: node probar-mercados-jugador.js <carpeta con pl_2019.csv … pl_2025.csv>
const fs = require('fs'), path = require('path');
const M = require('../modelo.js');
const carpeta = process.argv[2];
// col: columna de la estadística, uso: columna de uso, min: uso mínimo por partido, pos: posiciones, est: proyección.
const MERCADOS = {
  recepciones: { nombre: 'Recepciones', col: 10, uso: 9, min: 4, pos: ['WR', 'TE', 'RB'], est: 'atrapadas' },
  carreraQB: { nombre: 'Yardas por tierra del QB', col: 7, uso: 6, min: 4, pos: ['QB'], est: 'carrera' },
  // referencia: el mercado que ya está en la página, medido igual
  recepcionYardas: { nombre: '(referencia) Yardas por recepción', col: 11, uso: 9, min: 4, pos: ['WR', 'TE', 'RB'], est: 'recepcion' }
};
const filas = [];
for (let a = 2019; a <= 2025; a++) M.leerCSV(fs.readFileSync(path.join(carpeta, `pl_${a}.csv`), 'utf8')).forEach(r => {
  if (!['QB', 'WR', 'TE', 'RB'].includes(r.position) || r.season_type !== 'REG') return; const n = k => Number(r[k]) || 0;
  filas.push({ id: r.player_id, p: r.position, eq: M.ALIAS[r.team] || r.team, g: [a, +r.week, M.ALIAS[r.opponent_team] || r.opponent_team, n('attempts'), n('passing_yards'), n('passing_tds'), n('carries'), n('rushing_yards'), n('rushing_tds'), n('targets'), n('receptions'), n('receiving_yards'), n('receiving_tds')] });
});
filas.sort((x, y) => x.g[0] - y.g[0] || x.g[1] - y.g[1]);
const hist = {}, semEq = {}, casos = {}; Object.keys(MERCADOS).forEach(k => { casos[k] = []; });
for (const f of filas) {
  const h = hist[f.id] = hist[f.id] || [], t = f.g[0], w = f.g[1], se = semEq[t + f.eq] = semEq[t + f.eq] || new Set();
  const est = h.filter(g => g[0] === t);
  if (t >= 2020 && w >= 5 && est.length >= 3) {
    const ult = [...se].filter(x => x < w).sort((a, b) => b - a).slice(0, 4), jugo = ult.filter(x => est.some(g => g[1] === x)).length;
    const pr = jugo >= 3 ? M.proyectar({ p: f.p, j: h.slice(-10) }, t, null, f.g[2]) : null;
    if (pr) for (const k in MERCADOS) {
      const e = MERCADOS[k]; if (!e.pos.includes(f.p) || !pr[e.est]) continue;
      const uso = est.reduce((a, g) => a + g[e.uso], 0) / est.length; if (uso < e.min) continue;
      const ys = h.slice(-10).map(g => g[e.col]).sort((a, b) => a - b), linea = Math.floor(ys[Math.floor(ys.length / 2)]) + 0.5;
      casos[k].push({ t, q: M.probAlMenos(pr[e.est].m, pr[e.est].sd, Math.floor(linea) + 1), y: f.g[e.col] > linea ? 1 : 0 });
    }
  }
  h.push(f.g); se.add(w);
}
const ll = (lista, b) => lista.reduce((s, c) => { const q = Math.min(0.999, Math.max(0.001, 0.5 + (c.q - 0.5) * b)); return s - (c.y ? Math.log(q) : Math.log(1 - q)); }, 0);
const picks = (lista, b) => { let n = 0, ok = 0, p = 0; lista.forEach(c => { const q = 0.5 + (c.q - 0.5) * b, pr = Math.max(q, 1 - q); if (pr < 0.65 || pr > 0.80) return; n++; p += pr; ok += (c.y === 1) === (q >= 0.5) ? 1 : 0; }); return { n, acierto: ok / n, anunciado: p / n }; };
const salida = {};
for (const k in MERCADOS) {
  const entrena = casos[k].filter(c => c.t <= 2022), prueba = casos[k].filter(c => c.t >= 2023);
  let mejor = null; for (let b = 0.1; b <= 1.001; b += 0.05) { const v = ll(entrena, b); if (!mejor || v < mejor.v) mejor = { b: +b.toFixed(2), v }; }
  const pc = picks(prueba, mejor.b), sin = picks(prueba, 1), pe = picks(entrena, mejor.b);
  const entra = pc.n >= 100 && pc.acierto >= pc.anunciado - 0.01;
  salida[k] = { nombre: MERCADOS[k].nombre, casos: prueba.length, factor: mejor.b, prueba: pc, sinCalibrar: sin, entrena: pe, entra };
  const f = x => isNaN(x.acierto) ? 'sin picks' : `${x.n} picks · acertaron ${(x.acierto * 100).toFixed(1)}% · anunciaban ${(x.anunciado * 100).toFixed(1)}%`;
  console.log(`${MERCADOS[k].nombre}: factor ${mejor.b} (2020-2022) · 2023-2025 ${f(pc)} · sin calibrar ${f(sin)} → ${entra ? 'ENTRA' : 'DESCARTADO'}`);
}
if (process.env.GUARDAR) fs.writeFileSync(process.env.GUARDAR, JSON.stringify(salida));
