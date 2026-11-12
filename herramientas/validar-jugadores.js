// Comprueba las proyecciones de jugadores contra lo que pasó de verdad y guarda datos/calibracion-jugadores.json.
// Cada predicción usa solo partidos anteriores.  Uso: node validar-jugadores.js [carpeta con pl_AAAA.csv]
const fs = require('fs'), path = require('path');
const M = require('../modelo.js');
const PUBLICADOS = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_';
const DESDE = 2022, EVALUAR = [2023, 2024, 2025], carpeta = process.argv[2];
const UMBRALES = { pase: [175, 200, 225, 250, 275, 300], carrera: [25, 40, 50, 60, 75, 100], recepcion: [25, 40, 50, 60, 75, 100], atrapadas: [2, 3, 4, 5, 6, 7] };
const REAL = { pase: 4, carrera: 7, recepcion: 11, atrapadas: 10 };
(async () => {
  const filas = [];
  for (let a = DESDE; a <= EVALUAR[EVALUAR.length - 1]; a++) {
    const texto = carpeta ? fs.readFileSync(path.join(carpeta, `pl_${a}.csv`), 'utf8') : await (await fetch(PUBLICADOS + a + '.csv')).text();
    M.leerCSV(texto).forEach(r => {
      if (!['QB', 'RB', 'WR', 'TE'].includes(r.position)) return;
      const n = k => Number(r[k]) || 0;
      filas.push({ id: r.player_id, p: r.position, reg: r.season_type === 'REG', partido: r.game_id, eq: M.ALIAS[r.team] || r.team,
        g: [a, Number(r.week), M.ALIAS[r.opponent_team] || r.opponent_team, n('attempts'), n('passing_yards'), n('passing_tds'), n('carries'), n('rushing_yards'), n('rushing_tds'),
          n('targets'), n('receptions'), n('receiving_yards'), n('receiving_tds')] });
    });
  }
  filas.sort((x, y) => x.g[0] - y.g[0] || x.g[1] - y.g[1]);
  const historia = {}, cubos = {}, total = { n: 0 };
  let datos = null, semana = '', pendientes = [];
  const anotar = (tipo, p, ok) => {
    const c = (cubos[tipo] = cubos[tipo] || [])[Math.min(9, Math.floor(p * 10))] = (cubos[tipo][Math.min(9, Math.floor(p * 10))] || { n: 0, p: 0, ok: 0 });
    c.n++; c.p += p; c.ok += ok ? 1 : 0; total.n++;
  };
  const cerrarSemana = () => { // suma a las defensas lo concedido en la semana ya evaluada
    const porPartido = {};
    pendientes.forEach(f => { const k = f.partido + '|' + f.eq, o = porPartido[k] = porPartido[k] || { riv: f.g[2], py: 0, ry: 0, td: 0 }; o.py += f.g[4]; o.ry += f.g[7]; o.td += f.g[8] + f.g[12]; });
    Object.values(porPartido).forEach(o => { const d = datos.defensas[o.riv] = datos.defensas[o.riv] || { py: 0, ry: 0, td: 0, g: 0 }; ['py', 'ry', 'td'].forEach(k => { d[k] += o[k]; datos.liga[k] += o[k]; }); d.g++; datos.liga.g++; });
    pendientes.forEach(f => { (historia[f.id] = historia[f.id] || { p: f.p, j: [] }).j.push(f.g); historia[f.id].p = f.p; });
    pendientes = [];
  };
  for (const f of filas) {
    const clave = f.g[0] + '|' + f.g[1];
    if (clave !== semana) {
      if (datos) cerrarSemana();
      if (!datos || datos.temporada !== f.g[0]) datos = { temporada: f.g[0], defensas: {}, liga: { py: 0, ry: 0, td: 0, g: 0 } };
      semana = clave;
    }
    pendientes.push(f);
    const h = historia[f.id];
    if (!EVALUAR.includes(f.g[0]) || !f.reg || f.g[1] < 4 || !h || h.j.filter(x => x[0] === f.g[0]).length < 3) continue;
    const pr = M.proyectar({ p: f.p, j: h.j.slice(-10) }, f.g[0], datos, f.g[2]);
    if (!pr) continue;
    Object.keys(UMBRALES).forEach(k => { if (pr[k]) UMBRALES[k].forEach(u => anotar(k, M.probAlMenos(pr[k].m, pr[k].sd, u), f.g[REAL[k]] >= u)); });
    if (pr.td != null) anotar('td', M.probPoisson(pr.td, 1), f.g[8] + f.g[12] >= 1);
    if (pr.tdPase != null) [1, 2, 3].forEach(u => anotar('tdPase', M.probPoisson(pr.tdPase, u), f.g[5] >= u));
  }
  const salida = { temporadas: EVALUAR, predicciones: total.n, tipos: {} };
  Object.keys(cubos).forEach(t => {
    salida.tipos[t] = cubos[t].map((c, i) => c ? { n: c.n, dicho: +(c.p / c.n).toFixed(3), real: +(c.ok / c.n).toFixed(3) } : null).filter(Boolean);
    console.log(t.padEnd(10), salida.tipos[t].map(c => `${c.n}:${c.dicho.toFixed(2)}/${c.real.toFixed(2)}`).join(' '));
  });
  fs.writeFileSync(path.join(__dirname, '../datos/calibracion-jugadores.json'), JSON.stringify(salida));
  console.log(total.n + ' predicciones evaluadas');
})().catch(e => { console.error(e); process.exit(1); });
