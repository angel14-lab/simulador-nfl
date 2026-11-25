// Ajuste fuera de muestra: los parámetros se eligen SOLO con 2016-2022 y el acierto se mide en 2023-2025.
//   node ajustar-fuera-de-muestra.js modelo   → PARAMS de modelo.js (búsqueda por coordenadas, Brier del ganador)
//   node ajustar-fuera-de-muestra.js mezcla   → peso del mercado (MEZCLA), Brier del ganador simulado
// Imprime lo mejor de entrenamiento y cómo le va a eso en prueba; no toca ningún archivo.
const fs = require('fs'), path = require('path');
const M = require('../modelo.js'), P = require('../picks.js');
const ENTRENA = [2016, 2022], PRUEBA = [2023, 2025];
const filas = M.leerCSV(fs.readFileSync(path.join(__dirname, '../datos/partidos.csv'), 'utf8'));
const cdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const dentro = (p, r) => p.temporada >= r[0] && p.temporada <= r[1];

// Brier de la probabilidad de victoria del modelo solo, con unos parámetros.
function brierModelo(Pm, rango) {
  const ps = M.prepararPartidos(filas, 2006); M.calificar(ps, Pm);
  let b = 0, n = 0;
  for (const p of ps) { if (!p.jugado || !dentro(p, rango)) continue; const y = p.ptsLocal > p.ptsVisita ? 1 : p.ptsLocal < p.ptsVisita ? 0 : 0.5; b += (cdf(p.pred.margen / 13.5) - y) ** 2; n++; }
  return b / n;
}
const modo = process.argv[2] || 'modelo';
if (modo === 'modelo') {
  // EPA → puntos: se reajusta con datos hasta 2022.
  const ps0 = M.prepararPartidos(filas, 2010); let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  ps0.forEach(p => { if (!p.jugado || p.temporada > ENTRENA[1] || p.epaLocal == null) return; [[p.epaLocal, p.ptsLocal], [p.epaVisita, p.ptsVisita]].forEach(([x, y]) => { n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }); });
  const epaB = (sxy - sx * sy / n) / (sxx - sx * sx / n), epaA = sy / n - epaB * sx / n;
  let mejor = Object.assign({}, M.PARAMS, { epaA: +epaA.toFixed(2), epaB: +epaB.toFixed(3) });
  console.log('EPA → puntos con datos hasta 2022:', mejor.epaA, '+', mejor.epaB, '× EPA');
  const OPC = { k: [0.02, 0.03, 0.04, 0.05], kQB: [0.03, 0.05, 0.07], kDef: [0.05, 0.07, 0.09], regresion: [0.25, 0.35, 0.45], regresionQB: [0, 0.1, 0.2],
    qbNuevo: [-3, -2, -1], tope: [14, 17, 24], local: [1.6, 2.2, 2.8], kLocal: [0, 0.002, 0.004], mezclaEPA: [0.15, 0.3, 0.45], descanso: [0, 0.8, 1.5],
    techo: [0, 1.5, 3], bajaAtaque: [0, 0.4, 0.8], bajaLinea: [0, 0.3, 0.6], bajaDefensa: [0, 0.2, 0.4] };
  let nota = brierModelo(mejor, ENTRENA);
  console.log('Brier entrenamiento con los parámetros actuales:', nota.toFixed(5), '· prueba:', brierModelo(Object.assign({}, M.PARAMS), PRUEBA).toFixed(5));
  for (let vuelta = 1; vuelta <= 2; vuelta++) {
    for (const clave of Object.keys(OPC)) {
      for (const v of OPC[clave]) { const c = Object.assign({}, mejor, { [clave]: v }), b = brierModelo(c, ENTRENA); if (b < nota - 1e-6) { nota = b; mejor = c; } }
    }
    console.log('vuelta', vuelta, '· Brier entrenamiento', nota.toFixed(5));
  }
  const elegidos = {}; Object.keys(OPC).concat(['epaA', 'epaB']).forEach(k => { elegidos[k] = mejor[k]; });
  console.log('ELEGIDOS', JSON.stringify(elegidos));
  console.log('Brier prueba 2023-2025 · actuales:', brierModelo(Object.assign({}, M.PARAMS), PRUEBA).toFixed(5), '· elegidos:', brierModelo(mejor, PRUEBA).toFixed(5));
}
if (modo === 'mezcla') {
  const ps = M.prepararPartidos(filas, 2010); M.calificar(ps);
  const juegos = ps.filter(p => p.jugado && p.linea != null && p.lineaTotal != null);
  for (const w of [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1]) {
    const r = {};
    for (const [nom, rango] of [['entrenamiento', ENTRENA], ['prueba', PRUEBA]]) {
      let b = 0, n = 0;
      juegos.filter(p => dentro(p, rango)).forEach(p => { const e = P.mezclar(p.pred, p.linea, p.lineaTotal, w), s = M.simular(e.local, e.visita, 2000, M.semillaDe(p.id), p.tipo !== 'REG');
        const y = p.ptsLocal > p.ptsVisita ? 1 : p.ptsLocal < p.ptsVisita ? 0 : 0.5; b += (s.pLocal + s.pEmpate / 2 - y) ** 2; n++; });
      r[nom] = (b / n).toFixed(5);
    }
    console.log('MEZCLA', w, '· Brier entrenamiento', r.entrenamiento, '· prueba', r.prueba);
  }
}
