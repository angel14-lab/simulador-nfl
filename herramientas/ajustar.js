// Ajusta y valida el modelo contra resultados reales.  Uso: node ajustar.js [ruta games.csv] [--buscar]
const fs = require('fs'), path = require('path');
const M = require('../modelo.js');
const ruta = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '../datos/partidos.csv');
const filas = M.leerCSV(fs.readFileSync(ruta, 'utf8'));
const cdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }

function evaluar(P, desde = 2016, hasta = 2025) {
  const ps = M.prepararPartidos(filas, 2006); M.calificar(ps, P);
  let n = 0, mae = 0, maeT = 0, ok = 0, brier = 0, sq = 0, mMae = 0, mOk = 0, mN = 0, mMaeT = 0, nSin = 0;
  for (const p of ps) {
    if (!p.jugado || p.temporada < desde || p.temporada > hasta) continue;
    const m = p.ptsLocal - p.ptsVisita, e = p.pred.margen; n++;
    mae += Math.abs(m - e); sq += (m - e) ** 2; maeT += Math.abs(p.ptsLocal + p.ptsVisita - p.pred.total);
    const pr = cdf(e / 13.5), r = m > 0 ? 1 : m < 0 ? 0 : 0.5;
    brier += (pr - r) ** 2; if (m !== 0) { nSin++; if ((e > 0) === (m > 0)) ok++; }
    if (p.linea != null) { mN++; mMae += Math.abs(m - p.linea); if (m !== 0 && (p.linea > 0) === (m > 0)) mOk++; if (p.lineaTotal != null) mMaeT += Math.abs(p.ptsLocal + p.ptsVisita - p.lineaTotal); }
  }
  return { n, mae: mae / n, rmse: Math.sqrt(sq / n), maeTotal: maeT / n, acierto: ok / nSin, brier: brier / n, mercadoMae: mMae / mN, mercadoAcierto: mOk / mN, mercadoMaeTotal: mMaeT / mN };
}

if (process.argv.includes('--buscar')) {
  let mejor = null;
  for (const k of [0.035, 0.045, 0.055, 0.065, 0.08]) for (const regresion of [0.25, 0.35, 0.45]) for (const tope of [17, 24, 99])
    for (const kLocal of [0, 0.004]) for (const local of [1.8, 2.4]) {
      const P = { ...M.PARAMS, k, regresion, tope, kLocal, local }, r = evaluar(P, 2012, 2025);
      const nota = r.brier;
      if (!mejor || nota < mejor.nota) { mejor = { nota, P, r }; console.log(JSON.stringify({ k, regresion, tope, kLocal, local }), r.mae.toFixed(3), r.brier.toFixed(4), r.acierto.toFixed(4)); }
    }
} else console.log(evaluar(M.PARAMS));
module.exports = { evaluar };
