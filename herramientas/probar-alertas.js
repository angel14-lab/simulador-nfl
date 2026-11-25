// Tercera tanda: ¿qué hacer con los picks que tienen una señal de alerta? Para cada alerta se mira, en los
// picks de partido que muestra la página, si aciertan lo que anuncian. Con 2016-2022 se ajusta cuánto
// habría que bajar su probabilidad (q → 0.5 + (q − 0.5)·f); en 2023-2025 se comprueba qué regla funciona:
// dejarlos igual (solo ⚠), bajarles la probabilidad (y quitar los que caen del 65%) o quitarlos.
//   modelo: el modelo propio (sin la línea) y la línea de la casa dan más de 10 puntos de diferencia al pick
//   qb:     el titular de alguno de los dos equipos figura en duda o dudoso en el último parte
//   muestra: alguno de los dos equipos lleva menos de 4 partidos en la temporada
// Uso: node probar-alertas.js <carpeta con inj_AAAA.csv>
const fs = require('fs'), path = require('path');
const M = require('../modelo.js'), P = require('../picks.js');
const D = process.argv[2], SIMS = Number(process.env.SIMS || 4000);
const partidos = M.prepararPartidos(M.leerCSV(fs.readFileSync(path.join(__dirname, '../datos/partidos.csv'), 'utf8')), 2010);
M.calificar(partidos);
const ctx = { jug: null, porEquipo: {}, semanas: {}, lesiones: null, titular: {} };
// Parte de lesiones de quarterbacks: temporada|semana|equipo|gsis → estado.
const qbParte = {};
for (let a = 2016; a <= 2025; a++) M.leerCSV(fs.readFileSync(path.join(D, `inj_${a}.csv`), 'utf8')).forEach(r => {
  if (r.position === 'QB' && r.report_status) qbParte[a + '|' + Number(r.week) + '|' + (M.ALIAS[r.team] || r.team) + '|' + r.gsis_id] = r.report_status;
});
// Titular del partido anterior y partidos jugados en la temporada, sin mirar el futuro.
const previo = {}, jugados = {}, antesQB = {}, antesN = {};
partidos.forEach(p => {
  previo[p.id] = { qbL: antesQB[p.local], qbV: antesQB[p.visita], nL: antesN[p.temporada + p.local] || 0, nV: antesN[p.temporada + p.visita] || 0 };
  if (!p.jugado) return;
  if (p.qbLocalId) antesQB[p.local] = p.qbLocalId; if (p.qbVisitaId) antesQB[p.visita] = p.qbVisitaId;
  antesN[p.temporada + p.local] = (antesN[p.temporada + p.local] || 0) + 1; antesN[p.temporada + p.visita] = (antesN[p.temporada + p.visita] || 0) + 1;
});
// Probabilidad cruda de un pick en una simulación (sin calibrar), para comparar modelo propio y línea.
function cruda(s, m, p) {
  const frac = f => { let c = 0, x = 0; for (let i = 0; i < s.n; i++) { const v = f(i); if (v === null) continue; x++; if (v) c++; } return x ? c / x : 0; };
  const L = m.eq === p.local;
  switch (m.m) {
    case 'gana': return L ? s.pLocal : s.pVisita;
    case 'handicap': return frac(i => { const d = (L ? 1 : -1) * (s.local[i] - s.visita[i]) + m.linea; return d === 0 ? null : d > 0; });
    case 'total': return frac(i => s.local[i] + s.visita[i] > m.linea);
    case 'equipo': return frac(i => (L ? s.local[i] : s.visita[i]) > m.linea);
    case 'tdsEquipo': return frac(i => (L ? s.tdLocal[i] : s.tdVisita[i]) > m.linea);
    case 'mitadGana': return frac(i => { const d = s.mitadLocal[i] - s.mitadVisita[i]; return d === 0 ? null : (d > 0) === L; });
    case 'mitadHandicap': return frac(i => (L ? 1 : -1) * (s.mitadLocal[i] - s.mitadVisita[i]) + m.linea > 0);
    case 'mitadTotal': return frac(i => s.mitadLocal[i] + s.mitadVisita[i] > m.linea);
  }
  return null;
}
const casos = [];
for (const p of partidos) {
  if (!p.jugado || p.temporada < 2016 || p.temporada > 2025 || p.linea == null || p.lineaTotal == null || p.tdLocal == null) continue;
  const e = P.mezclar(p.pred, p.linea, p.lineaTotal, 1), s = M.simular(e.local, e.visita, SIMS, M.semillaDe(p.id), p.tipo !== 'REG');
  const top = P.mejores(P.picksDe(ctx, p, s, e)); if (!top.length) continue;
  const propio = M.simular(Math.max(3, p.pred.local), Math.max(3, p.pred.visita), SIMS, M.semillaDe(p.id), p.tipo !== 'REG');
  const pr = previo[p.id], estado = (eq, id) => (id ? qbParte[p.temporada + '|' + p.semana + '|' + eq + '|' + id] : '');
  const qb = ['Questionable', 'Doubtful'].includes(estado(p.local, pr.qbL)) || ['Questionable', 'Doubtful'].includes(estado(p.visita, pr.qbV));
  const muestra = pr.nL < 4 || pr.nV < 4;
  top.forEach(k => {
    const ok = P.calificar(k.m, p, () => undefined); if (ok == null) return;
    const a = cruda(s, k.m, p), b = cruda(propio, k.m, p);
    casos.push({ t: p.temporada, q: k.prob, y: ok ? 1 : 0, modelo: Math.abs(a - b) > 0.10, qb, muestra });
  });
}
const resumen = l => { const n = l.length, ok = l.reduce((x, c) => x + c.y, 0), q = l.reduce((x, c) => x + c.q, 0); return { n, acierto: ok / n, anunciado: q / n }; };
const ll = (l, f) => l.reduce((x, c) => { const q = 0.5 + (c.q - 0.5) * f; return x - (c.y ? Math.log(q) : Math.log(1 - q)); }, 0);
const pc = x => (x * 100).toFixed(1) + '%', txt = r => `${r.n} · ${pc(r.acierto)} anunciando ${pc(r.anunciado)}`;
const salida = {};
console.log('Todos los picks mostrados: 2016-2022 ' + txt(resumen(casos.filter(c => c.t <= 2022))) + ' | 2023-2025 ' + txt(resumen(casos.filter(c => c.t >= 2023))));
for (const al of ['modelo', 'qb', 'muestra']) {
  const tr = casos.filter(c => c.t <= 2022 && c[al]), te = casos.filter(c => c.t >= 2023 && c[al]);
  let f = 1, mejor = Infinity; for (let x = 0.3; x <= 1.001; x += 0.05) { const v = ll(tr, x); if (v < mejor) { mejor = v; f = +x.toFixed(2); } }
  const bajados = te.map(c => Object.assign({}, c, { q: 0.5 + (c.q - 0.5) * f })).filter(c => c.q >= P.MINIMO);
  const todoTe = casos.filter(c => c.t >= 2023), sinAl = todoTe.filter(c => !c[al]);
  const conBajados = sinAl.concat(bajados);
  salida[al] = { entrena: resumen(tr), prueba: resumen(te), factor: f, pruebaBajados: resumen(bajados), llPrueba: { igual: ll(te, 1), bajados: ll(te, f) },
    pagina: { igual: resumen(todoTe), quitando: resumen(sinAl), bajando: resumen(conBajados) } };
  console.log(`\n[${al}] 2016-2022 ${txt(resumen(tr))} → factor ${f}\n   2023-2025 con alerta: ${txt(resumen(te))}; bajando: ${txt(resumen(bajados))} (log-loss ${ll(te, 1).toFixed(1)} → ${ll(te, f).toFixed(1)})` +
    `\n   página 2023-2025: igual ${txt(resumen(todoTe))} | quitándolos ${txt(resumen(sinAl))} | bajándolos ${txt(resumen(conBajados))}`);
}
if (process.env.GUARDAR) fs.writeFileSync(process.env.GUARDAR, JSON.stringify(salida));
