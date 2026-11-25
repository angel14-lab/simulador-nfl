// Prueba los picks de partido contra resultados reales y guarda el resumen en datos/validacion-picks.json.
// Cada partido se predice solo con lo ocurrido antes; la línea del mercado es la de cierre.
// Por defecto mide SOLO 2023-2025: los parámetros (MEZCLA, MINIMO, MAXIMO, PARAMS) se eligieron con
// 2016-2022 (ajustar-fuera-de-muestra.js), así que este acierto es fuera de muestra.
// Uso: node validar-picks.js [desde] [hasta] [simulaciones]     MEZCLAS=0,0.85,1 para comparar pesos
const fs = require('fs'), path = require('path');
const M = require('../modelo.js'), P = require('../picks.js');
const desde = Number(process.argv[2]) || 2023, hasta = Number(process.argv[3]) || 2025, N = Number(process.argv[4]) || 4000;
const partidos = M.prepararPartidos(M.leerCSV(fs.readFileSync(path.join(__dirname, '../datos/partidos.csv'), 'utf8')), 2010);
M.calificar(partidos);
const ctx = { jug: null, porEquipo: {}, semanas: {}, lesiones: null, titular: {} };
const MEZCLAS = (process.env.MEZCLAS || String(P.MEZCLA)).split(',').map(Number);
const NOMBRE = { gana: 'Ganador', handicap: 'Hándicap alternativo', total: 'Total de puntos alternativo', tds: 'Touchdowns del partido', tdsEquipo: 'Touchdowns de un equipo' };
const juegos = partidos.filter(p => p.jugado && p.temporada >= desde && p.temporada <= hasta && p.linea != null && p.lineaTotal != null && p.tdLocal != null);
const suma = (o, k, ok, q) => { const c = o[k] = o[k] || { n: 0, ok: 0, p: 0 }; c.n++; c.ok += ok ? 1 : 0; c.p += q; };
let salida = null;
for (const w of MEZCLAS) {
  const r = { brier: 0, n: 0, cubos: {}, tipos: {}, top: {}, porTemp: {}, porPartido: [] };
  for (const p of juegos) {
    const e = P.mezclar(p.pred, p.linea, p.lineaTotal, w);
    const sim = M.simular(e.local, e.visita, N, M.semillaDe(p.id), p.tipo !== 'REG');
    const y = p.ptsLocal > p.ptsVisita ? 1 : p.ptsLocal < p.ptsVisita ? 0 : 0.5, q = sim.pLocal + sim.pEmpate / 2;
    r.brier += (q - y) ** 2; r.n++;
    const todos = P.picksDe(ctx, p, sim, e), top = P.mejores(todos);
    todos.forEach(k => { const ok = P.calificar(k.m, p, () => undefined); if (ok == null) return; suma(r.cubos, Math.min(19, Math.floor(k.prob * 20)) * 5, ok, k.prob); });
    let aciertos = 0, validos = 0;
    top.forEach(k => {
      const ok = P.calificar(k.m, p, () => undefined); if (ok == null) return;
      suma(r.top, 'todos', ok, k.prob); suma(r.tipos, k.m.m, ok, k.prob); suma(r.porTemp, p.temporada, ok, k.prob); validos++; aciertos += ok ? 1 : 0;
    });
    if (validos) r.porPartido.push(aciertos / validos);
  }
  const t = r.top.todos, pc = x => (x * 100).toFixed(1) + '%';
  console.log(`\nMezcla ${w}: ${r.n} partidos · Brier del ganador ${(r.brier / r.n).toFixed(4)} · picks mostrados ${t.n} (${(t.n / r.n).toFixed(1)} por partido) · acertaron ${pc(t.ok / t.n)} (anunciaban ${pc(t.p / t.n)})`);
  Object.keys(r.tipos).forEach(k => { const c = r.tipos[k]; console.log(`   ${(NOMBRE[k] || k).padEnd(28)} ${String(c.n).padStart(5)} · ${pc(c.ok / c.n)} (anunciaban ${pc(c.p / c.n)})`); });
  Object.keys(r.porTemp).forEach(k => { const c = r.porTemp[k]; console.log(`   ${k} ${String(c.n).padStart(5)} · ${pc(c.ok / c.n)}`); });
  const pp = r.porPartido.sort((a, b) => a - b); console.log(`   por partido: mediana ${pc(pp[Math.floor(pp.length / 2)])} · el 25% peor por debajo de ${pc(pp[Math.floor(pp.length / 4)])}`);
  if (w === P.MEZCLA) salida = {
    desde, hasta, ajustadoCon: '2016-2022', partidos: r.n, simulaciones: N, mezcla: w,
    mostrados: { n: t.n, acierto: t.ok / t.n, esperado: t.p / t.n },
    tipos: Object.keys(r.tipos).map(k => ({ tipo: NOMBRE[k] || k, n: r.tipos[k].n, acierto: r.tipos[k].ok / r.tipos[k].n, esperado: r.tipos[k].p / r.tipos[k].n })),
    temporadas: Object.keys(r.porTemp).map(k => ({ temporada: Number(k), n: r.porTemp[k].n, acierto: r.porTemp[k].ok / r.porTemp[k].n })),
    calibracion: Object.keys(r.cubos).map(Number).sort((a, b) => a - b).filter(b => b >= 50).map(b => ({ dicho: r.cubos[b].p / r.cubos[b].n, real: r.cubos[b].ok / r.cubos[b].n, n: r.cubos[b].n }))
  };
}
if (salida && desde === 2023 && hasta === 2025) fs.writeFileSync(path.join(__dirname, '../datos/validacion-picks.json'), JSON.stringify(salida));
