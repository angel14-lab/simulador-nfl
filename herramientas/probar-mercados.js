// Punto 9 (partido): ¿los mercados candidatos aciertan lo que anuncian? Cada partido se simula como en la
// página (puntos esperados = línea y total del mercado, MEZCLA 1). Para cada mercado:
//   1. con 2016-2022 se ajusta una calibración (q → 0.5 + a + (q − 0.5)·b) sobre todas sus líneas;
//   2. en 2023-2025 se arma el pick que mostraría la página: la línea de medio punto más exigente que,
//      ya calibrada, se cumple el 70% o más (como el hándicap y el total); en ganador y primero en anotar,
//      el favorito si llega al 65%;
//   3. entra solo si esos picks (100 o más) aciertan al menos lo que anuncian (tolerancia 1 punto) y
//      todas sus líneas anunciadas entre 65% y 80% también.
// Uso: node probar-mercados.js <mitades.json (marcador al descanso y primero en anotar, de play-by-play)>
const fs = require('fs'), path = require('path');
const M = require('../modelo.js'), P = require('../picks.js');
const mitades = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), SIMS = Number(process.env.SIMS || 4000), PISO = 0.70, MIN = 0.65;
const partidos = M.prepararPartidos(M.leerCSV(fs.readFileSync(path.join(__dirname, '../datos/partidos.csv'), 'utf8')), 2010);
M.calificar(partidos);
const juegos = partidos.filter(p => p.jugado && p.temporada >= 2016 && p.temporada <= 2025 && p.linea != null && p.lineaTotal != null && p.tdLocal != null);
const frac = (sim, f) => { let c = 0, x = 0; for (let i = 0; i < sim.n; i++) { const v = f(i); if (v === null) continue; x++; if (v) c++; } return x ? c / x : 0; };
const MERC = {
  puntosEquipo: { nombre: 'Puntos de un equipo, más de X (línea alternativa)', escalera: true },
  tdsEquipo: { nombre: 'Touchdowns de un equipo, más de X (línea alternativa)', escalera: true },
  mitadGana: { nombre: 'Primera mitad: ganador (empate = nula)' },
  mitadHandicap: { nombre: 'Primera mitad: hándicap alternativo', escalera: true },
  mitadTotal: { nombre: 'Primera mitad: total, más de X (línea alternativa)', escalera: true },
  primero: { nombre: 'Equipo que anota primero' }
};
// Por mercado, una lista de «escaleras»: [{q, y}] de la línea menos a la más exigente (q decreciente).
const casos = {}; Object.keys(MERC).forEach(k => { casos[k] = []; });
function escalera(k, t, lineas) { // lineas: [{q, y}] ordenadas de menos a más exigente
  const util = lineas.filter(x => x.q > 0.5 && x.q < 0.97); if (util.length) casos[k].push({ t, lineas: util });
}
for (const p of juegos) {
  const e = P.mezclar(p.pred, p.linea, p.lineaTotal, 1), s = M.simular(e.local, e.visita, SIMS, M.semillaDe(p.id), p.tipo !== 'REG'), t = p.temporada;
  const subir = (valor, real, desde, hasta) => { const r = []; for (let l = desde; l <= hasta; l++) r.push({ l, q: frac(s, i => valor(i) > l), y: real > l ? 1 : 0 }); return r; };
  [[s.local, p.ptsLocal, s.tdLocal, p.tdLocal], [s.visita, p.ptsVisita, s.tdVisita, p.tdVisita]].forEach(([arr, real, tds, tdReal]) => {
    escalera('puntosEquipo', t, subir(i => arr[i], real, 0.5, 60.5));
    escalera('tdsEquipo', t, subir(i => tds[i], tdReal, 0.5, 7.5));
  });
  const m = mitades[p.id]; if (!m) continue;
  const gL = frac(s, i => (s.mitadLocal[i] === s.mitadVisita[i] ? null : s.mitadLocal[i] > s.mitadVisita[i]));
  if (m.h1L !== m.h1V) casos.mitadGana.push({ t, lineas: [{ q: Math.max(gL, 1 - gL), y: (gL >= 0.5) === (m.h1L > m.h1V) ? 1 : 0 }] });
  // Hándicap de la primera mitad para cada equipo: de −20.5 (más exigente) a +20.5; se ordena de menos a más exigente.
  [[s.mitadLocal, s.mitadVisita, m.h1L - m.h1V], [s.mitadVisita, s.mitadLocal, m.h1V - m.h1L]].forEach(([a, b, dif]) => {
    const r = []; for (let h = 20.5; h >= -20.5; h--) if (Math.abs(h) !== 0.5) r.push({ q: frac(s, i => a[i] - b[i] + h > 0), y: dif + h > 0 ? 1 : 0 });
    escalera('mitadHandicap', t, r);
  });
  escalera('mitadTotal', t, subir(i => s.mitadLocal[i] + s.mitadVisita[i], m.h1L + m.h1V, 0.5, 40.5));
  if (m.primero === 'L' || m.primero === 'V') { const qL = frac(s, i => (s.primero[i] ? s.primero[i] === 1 : null)); casos.primero.push({ t, lineas: [{ q: Math.max(qL, 1 - qL), y: (qL >= 0.5) === (m.primero === 'L') ? 1 : 0 }] }); }
}
const cal = (q, b) => Math.min(0.99, Math.max(0.01, 0.5 + b.a + (q - 0.5) * b.b)); // b = {a: corrimiento, b: pendiente}
const ll = (lista, b) => lista.reduce((s, c) => c.lineas.reduce((s2, x) => { const q = Math.min(0.999, Math.max(0.001, cal(x.q, b))); return s2 - (x.y ? Math.log(q) : Math.log(1 - q)); }, s), 0);
function medir(lista, b, escal) {
  const pk = { n: 0, ok: 0, p: 0 }, rango = { n: 0, ok: 0, p: 0 };
  lista.forEach(c => {
    c.lineas.forEach(x => { const q = cal(x.q, b); if (q >= MIN && q <= 0.80) { rango.n++; rango.ok += x.y; rango.p += q; } });
    // Pick: la línea más exigente que sigue en 70% o más (escaleras) o el favorito con 65% o más.
    let elegido = null; c.lineas.forEach(x => { const q = cal(x.q, b); if (q >= (escal ? PISO : MIN)) elegido = { q, y: x.y }; });
    if (elegido && elegido.q <= 0.80 + 1e-9) { pk.n++; pk.ok += elegido.y; pk.p += elegido.q; }
  });
  const r = o => ({ n: o.n, acierto: o.ok / o.n, anunciado: o.p / o.n });
  return { picks: r(pk), rango: r(rango) };
}
const salida = {};
const f = x => (!x.n ? 'sin picks' : `${x.n} · acertaron ${(x.acierto * 100).toFixed(1)}% · anunciaban ${(x.anunciado * 100).toFixed(1)}%`);
for (const k in MERC) {
  const entrena = casos[k].filter(c => c.t <= 2022), prueba = casos[k].filter(c => c.t >= 2023);
  let mejor = null; for (let a = -0.1; a <= 0.1001; a += 0.01) for (let b = 0.5; b <= 1.501; b += 0.05) { const c = { a: +a.toFixed(2), b: +b.toFixed(2) }, v = ll(entrena, c); if (!mejor || v < mejor.v) mejor = { b: c, v }; }
  const te = medir(prueba, mejor.b, MERC[k].escalera), sin = medir(prueba, { a: 0, b: 1 }, MERC[k].escalera);
  const bien = x => x.n >= 100 && x.acierto >= x.anunciado - 0.01, entra = bien(te.picks) && bien(te.rango);
  salida[k] = { nombre: MERC[k].nombre, factor: mejor.b, prueba: te, sinCalibrar: sin, entra };
  console.log(`${MERC[k].nombre} · corrimiento ${mejor.b.a} pendiente ${mejor.b.b} (ajustados con 2016-2022)\n   2023-2025 picks ${f(te.picks)} | todas las líneas de 65-80%: ${f(te.rango)}\n   sin calibrar: picks ${f(sin.picks)} | 65-80%: ${f(sin.rango)} → ${entra ? 'ENTRA' : 'DESCARTADO'}`);
}
if (process.env.GUARDAR) fs.writeFileSync(process.env.GUARDAR, JSON.stringify(salida));
