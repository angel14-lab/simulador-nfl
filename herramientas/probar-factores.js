// Prueba si un factor aporta algo que la línea del mercado no tenga. Para cada factor:
//   1. con 2016-2022 se ajusta (mínimos cuadrados) cuánto mueve el resultado respecto a la línea:
//      diferencia real − hándicap del mercado, y puntos reales − total del mercado;
//   2. en 2023-2025 se aplica ese ajuste a la línea y se repiten los picks (100% mercado, como la página);
//   3. entra solo si en 2023-2025 baja el error y no baja el acierto de los picks mostrados.
// Uso: node probar-factores.js <carpeta con games.csv, st_AAAA.csv, inj_AAAA.csv, pl_AAAA.csv, snap/snap_AAAA.csv> [factor…]
const fs = require('fs'), path = require('path');
const M = require('../modelo.js'), P = require('../picks.js');
const D = process.argv[2], PEDIDOS = process.argv.slice(3);
const ENTRENA = [2016, 2022], PRUEBA = [2023, 2025], SIMS = Number(process.env.SIMS || 3000);
const A = t => M.ALIAS[t] || t, leer = f => M.leerCSV(fs.readFileSync(path.join(D, f), 'utf8'));
const num = v => (v === '' || v === 'NA' || v == null ? null : Number(v));

// ---------- datos base ----------
const partidos = M.prepararPartidos(M.leerCSV(fs.readFileSync(path.join(__dirname, '../datos/partidos.csv'), 'utf8')), 2010);
M.calificar(partidos);
const crudo = {}; leer('games.csv').forEach(g => { crudo[g.game_id] = g; });
const juegos = partidos.filter(p => p.jugado && p.temporada >= 2016 && p.temporada <= 2025 && p.linea != null && p.lineaTotal != null && p.tdLocal != null);

// Estadísticas de equipo por partido (para ritmo y eficiencia), en orden cronológico.
const equipoPartido = {}; // game_id|equipo → {jugadas, carreras, epaC, epaP, pases}
for (let a = 2015; a <= 2025; a++) leer(`st_${a}.csv`).forEach(r => {
  const n = k => Number(r[k]) || 0, pases = n('attempts') + n('sacks_suffered');
  equipoPartido[r.game_id + '|' + A(r.team)] = { jugadas: pases + n('carries'), carreras: n('carries'), pases, epaC: n('rushing_epa'), epaP: n('passing_epa'), yardas: n('passing_yards') + n('rushing_yards') };
});
const ordenados = partidos.filter(p => p.jugado && p.temporada >= 2015).slice();

// ---------- historia por equipo, sin mirar el futuro ----------
// Para cada partido se guardan los valores de cada equipo calculados con sus 8 partidos anteriores.
const previo = {}; // game_id → {local: {...}, visita: {...}}
(function () {
  const hist = {}, liga = [];
  const resumen = (lista, rival) => {
    const u = lista.slice(-8); if (u.length < 3) return null;
    const s = k => u.reduce((x, g) => x + g[k], 0);
    return { jugadas: s('jugadas') / u.length, propCarrera: s('carreras') / s('jugadas'), oC: s('epaC') / Math.max(1, s('carreras')), oP: s('epaP') / Math.max(1, s('pases')),
      dC: s('epaCc') / Math.max(1, s('carrerasC')), dP: s('epaPc') / Math.max(1, s('pasesC')) };
  };
  for (const p of ordenados) {
    previo[p.id] = { local: resumen(hist[p.local] || []), visita: resumen(hist[p.visita] || []) };
    const l = equipoPartido[p.id + '|' + p.local], v = equipoPartido[p.id + '|' + p.visita];
    if (l && v) {
      (hist[p.local] = hist[p.local] || []).push(Object.assign({}, l, { epaCc: v.epaC, carrerasC: v.carreras, epaPc: v.epaP, pasesC: v.pases }));
      (hist[p.visita] = hist[p.visita] || []).push(Object.assign({}, v, { epaCc: l.epaC, carrerasC: l.carreras, epaPc: l.epaP, pasesC: l.pases }));
      liga.push(l.jugadas, v.jugadas);
    }
  }
})();

// ---------- lesiones ponderadas por importancia ----------
const norm = s => P.normalizar(s || '');
let pesoBajas = null;
function cargarBajas() {
  if (pesoBajas) return pesoBajas;
  // Parte por (temporada, semana, equipo): descartados y dudosos.
  const parte = {};
  for (let a = 2016; a <= 2025; a++) leer(`inj_${a}.csv`).forEach(r => {
    if (r.report_status !== 'Out' && r.report_status !== 'Doubtful') return;
    (parte[a + '|' + Number(r.week) + '|' + A(r.team)] = parte[a + '|' + Number(r.week) + '|' + A(r.team)] || []).push({ id: r.gsis_id, n: norm(r.full_name), pos: r.position });
  });
  // Yardas por jugador y partido (RB/WR/TE) y snaps por jugador y partido (línea y defensa).
  const yardas = {}, snaps = {};
  for (let a = 2015; a <= 2025; a++) leer(`pl_${a}.csv`).forEach(r => {
    if (!['RB', 'WR', 'TE'].includes(r.position)) return;
    yardas[r.game_id + '|' + r.player_id] = (Number(r.rushing_yards) || 0) + (Number(r.receiving_yards) || 0);
  });
  for (let a = 2016; a <= 2025; a++) leer(`snap/snap_${a}.csv`).forEach(r => {
    snaps[r.game_id + '|' + norm(r.player)] = { o: Number(r.offense_pct) || 0, d: Number(r.defense_pct) || 0 };
  });
  const OL = ['T', 'G', 'C', 'OT', 'OG', 'OL'], ATQ = ['RB', 'WR', 'TE', 'FB'];
  const partidosEquipo = {}; ordenados.forEach(p => { [p.local, p.visita].forEach(e => { (partidosEquipo[e] = partidosEquipo[e] || []).push(p); }); });
  pesoBajas = {};
  ordenados.forEach(p => {
    if (p.temporada < 2016) return;
    const r = {};
    [['l', p.local], ['v', p.visita]].forEach(([lado, eq]) => {
      const antes = partidosEquipo[eq].filter(x => x.fecha < p.fecha).slice(-8), bajas = parte[p.temporada + '|' + p.semana + '|' + eq] || [];
      let atq = 0, lin = 0, def = 0;
      bajas.forEach(b => {
        if (b.pos === 'QB' || ['K', 'P', 'LS'].includes(b.pos)) return;
        if (ATQ.includes(b.pos)) { // parte de las yardas del equipo en sus últimos partidos
          let suyas = 0, total = 0;
          antes.forEach(x => { const t = equipoPartido[x.id + '|' + eq]; if (!t) return; total += t.yardas; suyas += yardas[x.id + '|' + b.id] || 0; });
          if (total) atq += suyas / total;
        } else { // parte media de las jugadas en sus últimos partidos (0 si no jugó)
          let s = 0; antes.forEach(x => { const sn = snaps[x.id + '|' + b.n]; if (sn) s += OL.includes(b.pos) ? sn.o : sn.d; });
          if (antes.length) { if (OL.includes(b.pos)) lin += s / antes.length; else def += s / antes.length; }
        }
      });
      r[lado] = { atq, lin, def };
    });
    pesoBajas[p.id] = r;
  });
  return pesoBajas;
}

// ---------- calendario ----------
const HUSO = { ARI: -7, ATL: -5, BAL: -5, BUF: -5, CAR: -5, CHI: -6, CIN: -5, CLE: -5, DAL: -6, DEN: -7, DET: -5, GB: -6, HOU: -6, IND: -5, JAX: -5, KC: -6, LA: -8, LAC: -8,
  LV: -8, MIA: -5, MIN: -6, NE: -5, NO: -6, NYG: -5, NYJ: -5, PHI: -5, PIT: -5, SEA: -8, SF: -8, TB: -5, TEN: -6, WAS: -5 };
const semanasJugadas = {}; partidos.forEach(p => { [p.local, p.visita].forEach(e => { semanasJugadas[p.temporada + '|' + e + '|' + p.semana] = 1; }); });

// ---------- factores ----------
// Cada uno devuelve {m: [...], t: [...]}: rasgos para la diferencia (local − visita) y para el total. null = sin dato.
const FACTORES = {
  bajasConteo: { punto: 8, nombre: 'Lesiones contadas por posición (como hoy en modelo.js)', f: p => {
    const l = p.bajasLocal || { at: 0, li: 0, de: 0 }, v = p.bajasVisita || { at: 0, li: 0, de: 0 };
    return { m: [l.at - v.at, l.li - v.li, l.de - v.de], t: [l.at + v.at, l.li + v.li, l.de + v.de] }; } },
  bajasPeso: { punto: 8, nombre: 'Lesiones ponderadas por importancia (yardas y snaps)', f: p => {
    const b = cargarBajas()[p.id]; if (!b) return null;
    return { m: [b.l.atq - b.v.atq, b.l.lin - b.v.lin, b.l.def - b.v.def], t: [b.l.atq + b.v.atq, b.l.lin + b.v.lin, b.l.def + b.v.def] }; } },
  ritmo: { punto: 10, nombre: 'Estilo y ritmo (jugadas por partido, proporción de carreras)', f: p => {
    const r = previo[p.id]; if (!r || !r.local || !r.visita) return null;
    return { m: [], t: [r.local.jugadas + r.visita.jugadas - 126, r.local.propCarrera + r.visita.propCarrera - 0.88] }; } },
  choque: { punto: 10, nombre: 'Choque de fuerzas (eficiencia por jugada en carrera y pase)', f: p => {
    const r = previo[p.id]; if (!r || !r.local || !r.visita) return null; const L = r.local, V = r.visita;
    const cL = L.oC + V.dC, pL = L.oP + V.dP, cV = V.oC + L.dC, pV = V.oP + L.dP;
    return { m: [cL - cV, pL - pV, L.oC * V.dC - V.oC * L.dC], t: [cL + cV, pL + pV] }; } },
  calendario: { punto: 10, nombre: 'Calendario (semana corta, viaje y husos, antes de la semana libre)', f: p => {
    const g = crudo[p.id]; if (!g) return null;
    const rl = num(g.home_rest), rv = num(g.away_rest), corta = x => (x != null && x <= 5 ? 1 : 0);
    const husos = p.neutral ? 0 : Math.abs((HUSO[p.local] || 0) - (HUSO[p.visita] || 0));
    const libre = e => (p.tipo === 'REG' && !semanasJugadas[p.temporada + '|' + e + '|' + (p.semana + 1)] && p.semana < 18 ? 1 : 0);
    return { m: [corta(rl) - corta(rv), husos, libre(p.local) - libre(p.visita), (rl || 7) - (rv || 7)], t: [] }; } },
  divisional: { punto: 10, nombre: 'Partido divisional (más cerrado)', f: p => {
    const g = crudo[p.id]; if (!g) return null; const d = g.div_game === '1' ? 1 : 0;
    return { m: [d * p.linea], t: [d] }; } },
  clima: { punto: 10, nombre: 'Clima (viento y frío)', f: p => {
    const g = crudo[p.id]; if (!g) return null; const dentro = /dome|closed/.test(g.roof || '');
    const w = dentro ? 0 : num(g.wind) || 0, t = dentro ? 65 : (num(g.temp) == null ? 65 : num(g.temp));
    return { m: [], t: [Math.max(0, w - 10), t < 32 ? 1 : 0] }; } },
  qb: { punto: 10, nombre: 'Quarterback suplente o debutante', f: p => {
    if (!qbHist) prepararQB();
    const q = qbHist[p.id]; if (!q) return null;
    return { m: [q.l.nuevo - q.v.nuevo, q.l.novato - q.v.novato], t: [q.l.nuevo + q.v.nuevo] }; } }
};
let qbHist = null;
function prepararQB() { // titular distinto al del partido anterior del equipo, y titular con menos de 3 partidos como titular
  qbHist = {}; const ultimo = {}, salidas = {};
  partidos.filter(p => p.jugado).forEach(p => {
    const r = {};
    [['l', p.local, p.qbLocalId], ['v', p.visita, p.qbVisitaId]].forEach(([lado, eq, id]) => {
      r[lado] = { nuevo: id && ultimo[eq] && ultimo[eq] !== id ? 1 : 0, novato: id && (salidas[id] || 0) < 3 ? 1 : 0 };
    });
    qbHist[p.id] = r;
    [[p.local, p.qbLocalId], [p.visita, p.qbVisitaId]].forEach(([eq, id]) => { if (id) { ultimo[eq] = id; salidas[id] = (salidas[id] || 0) + 1; } });
  });
}

// ---------- ajuste y prueba ----------
function mco(X, y) { // mínimos cuadrados con un poco de ridge, sin intercepto (la línea ya centra)
  const k = X[0].length, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  X.forEach((x, i) => { for (let a = 0; a < k; a++) { b[a] += x[a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += x[a] * x[c]; } });
  for (let a = 0; a < k; a++) A[a][a] += 1e-6 * X.length;
  for (let i = 0; i < k; i++) { let m = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let r = 0; r < k; r++) { if (r === i || !A[i][i]) continue; const f = A[r][i] / A[i][i]; for (let c = i; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
  return b.map((v, i) => (A[i][i] ? v / A[i][i] : 0));
}
const ctx0 = { jug: null, porEquipo: {}, semanas: {}, lesiones: null, titular: {} };
function picks(rango, ajuste) { // acierto de los picks mostrados con la línea ajustada
  let n = 0, ok = 0, pr = 0;
  juegos.filter(p => p.temporada >= rango[0] && p.temporada <= rango[1]).forEach(p => {
    const a = ajuste ? ajuste(p) : { m: 0, t: 0 }, q = Object.assign({}, p, { linea: p.linea + a.m, lineaTotal: p.lineaTotal + a.t });
    const e = P.mezclar(p.pred, q.linea, q.lineaTotal, 1), s = M.simular(e.local, e.visita, SIMS, M.semillaDe(p.id), p.tipo !== 'REG');
    P.mejores(P.picksDe(ctx0, q, s, e)).forEach(k => { const r = P.calificar(k.m, p, () => undefined); if (r == null) return; n++; ok += r ? 1 : 0; pr += k.prob; });
  });
  return { n, acierto: ok / n, anunciado: pr / n };
}
const base = { entrena: picks(ENTRENA), prueba: picks(PRUEBA) };
console.log(`Sin factores (solo la línea): 2023-2025 ${base.prueba.n} picks · acertaron ${(base.prueba.acierto * 100).toFixed(2)}% · anunciaban ${(base.prueba.anunciado * 100).toFixed(2)}%`);
const salida = { base, factores: {} };
for (const clave of (PEDIDOS.length ? PEDIDOS : Object.keys(FACTORES))) {
  const F = FACTORES[clave], filas = juegos.map(p => ({ p, x: F.f(p) })).filter(r => r.x);
  const res = {};
  for (const tipo of ['m', 't']) {
    if (!filas.length || !filas[0].x[tipo].length) continue;
    const y = r => (tipo === 'm' ? r.p.ptsLocal - r.p.ptsVisita - r.p.linea : r.p.ptsLocal + r.p.ptsVisita - r.p.lineaTotal);
    const tr = filas.filter(r => r.p.temporada <= ENTRENA[1]), te = filas.filter(r => r.p.temporada >= PRUEBA[0]);
    const beta = mco(tr.map(r => r.x[tipo]), tr.map(y));
    const ecm = (lista, b) => lista.reduce((s, r) => { const pred = b ? r.x[tipo].reduce((a, v, i) => a + v * b[i], 0) : 0; return s + (y(r) - pred) ** 2; }, 0) / lista.length;
    res[tipo] = { beta, ecmBase: ecm(te), ecmFactor: ecm(te, beta), ecmEntrenaBase: ecm(tr), ecmEntrena: ecm(tr, beta) };
  }
  const porId = {}; filas.forEach(r => { porId[r.p.id] = r.x; });
  const ajuste = p => { const x = porId[p.id]; if (!x) return { m: 0, t: 0 }; const s = (t) => (res[t] ? x[t].reduce((a, v, i) => a + v * res[t].beta[i], 0) : 0); return { m: s('m'), t: s('t') }; };
  const pr = picks(PRUEBA, ajuste), mejoraECM = ['m', 't'].filter(t => res[t]).every(t => res[t].ecmFactor < res[t].ecmBase);
  const entra = mejoraECM && pr.acierto > base.prueba.acierto;
  salida.factores[clave] = { punto: F.punto, nombre: F.nombre, juegos: filas.length, res, prueba: pr, entra };
  console.log(`\n[${F.punto}] ${F.nombre} · ${filas.length} partidos con dato`);
  ['m', 't'].filter(t => res[t]).forEach(t => console.log(`   ${t === 'm' ? 'diferencia' : 'total     '} coef ${res[t].beta.map(b => b.toFixed(3)).join(', ')} · error² 2023-2025: ${res[t].ecmBase.toFixed(2)} → ${res[t].ecmFactor.toFixed(2)} (entrenamiento ${res[t].ecmEntrenaBase.toFixed(2)} → ${res[t].ecmEntrena.toFixed(2)})`));
  console.log(`   picks 2023-2025: ${pr.n} · acertaron ${(pr.acierto * 100).toFixed(2)}% (antes ${(base.prueba.acierto * 100).toFixed(2)}%) · anunciaban ${(pr.anunciado * 100).toFixed(2)}% → ${entra ? 'ENTRA' : 'DESCARTADO'}`);
}
if (process.env.GUARDAR) fs.writeFileSync(process.env.GUARDAR, JSON.stringify(salida));
