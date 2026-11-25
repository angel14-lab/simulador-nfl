// Congela los picks de cada partido antes de que empiece y los califica cuando termina.
// Guarda datos/historial.json.  Uso: node registrar-picks.js   (después de actualizar-datos.js)
//
// Cada partido guarda todos sus picks y marca con «top» los que se muestran (los 10 mejores).
// La calificación es por partes: ganador, hándicap y total en cuanto hay marcador; touchdowns cuando
// se publican las estadísticas de equipo; jugadores cuando se publican las de jugadores.
const fs = require('fs'), path = require('path');
const M = require('../modelo.js'), P = require('../picks.js');
const datos = path.join(__dirname, '../datos'), archivo = path.join(datos, 'historial.json');
const leer = (n, defecto) => { try { return JSON.parse(fs.readFileSync(path.join(datos, n), 'utf8')); } catch (e) { return defecto; } };
const SIMULACIONES = 100000, VENTANA = 8 * 24 * 3600 * 1000, VERSION = 2;

const partidos = M.prepararPartidos(M.leerCSV(fs.readFileSync(path.join(datos, 'partidos.csv'), 'utf8')), 2010);
const estado = M.calificar(partidos), jug = leer('jugadores.json', null), indice = P.indexar(jug);
const lineas = (leer('lineas.json', {}) || {}).partidos || {};
const ctx = { jug, porEquipo: indice.porEquipo, semanas: indice.semanas, lesiones: leer('lesiones.json', null), titular: estado.titular, lineas };
const historial = leer('historial.json', { partidos: {} }), ahora = Date.now();
ctx.correccion = P.calcularCorreccion(historial.partidos); // corrección con el historial real (ver picks.js)
const ultima = partidos[partidos.length - 1].temporada, r3 = x => Math.round(x * 1000) / 1000;
let congelados = 0, completos = 0, parciales = 0, reconstruidos = 0;

// Estadísticas de un jugador en un partido: undefined si aún no están publicadas, null si no jugó.
const porId = {}; (jug ? jug.jugadores : []).forEach(j => { porId[j.id] = j; });
const publicadas = p => !!(jug && jug.temporada === p.temporada && [p.local, p.visita].every(e => indice.semanas[e] && indice.semanas[e][p.semana]));
const estadDe = p => id => {
  if (!publicadas(p)) return undefined;
  const g = porId[id] && porId[id].j.find(x => x[0] === p.temporada && x[1] === p.semana);
  return g ? { td: g[8] + g[12], tdPase: g[5], pase: g[4], carrera: g[7], recepcion: g[11], atrapadas: g[10] } : null;
};

// Pronóstico de un partido: puntos esperados mezclando modelo y mercado, 100 000 simulaciones.
function pronosticar(p, ini, reconstruir) {
  const q = P.conLineas(p, lineas), esp = P.mezclar(p.pred, q.linea, q.lineaTotal, P.MEZCLA);
  const sim = M.simular(esp.local, esp.visita, SIMULACIONES, M.semillaDe(p.id), p.tipo !== 'REG');
  const todos = P.picksDe(ctx, q, sim, esp, reconstruir), top = P.mejores(todos), riesgo = P.arriesgados(ctx, q, sim, esp, todos);
  const guardar = k => Object.assign({ t: k.tipo, eq: k.eq, q: k.quien, que: k.que, p: r3(k.prob), m: k.m }, k.resp ? { r: k.resp } : {}, k.cuotaReal ? { c: k.cuotaReal } : {}, k.linea && k.linea.estimada ? { est: 1 } : {}, k.p0 != null ? { p0: r3(k.p0) } : {});
  return {
    v: VERSION, temporada: p.temporada, semana: p.semana, visita: p.visita, local: p.local, inicio: new Date(ini).toISOString(),
    pV: r3(sim.pVisita), pL: r3(sim.pLocal), mV: Math.round(sim.mediaVisita * 10) / 10, mL: Math.round(sim.mediaLocal * 10) / 10,
    linea: q.linea, total: q.lineaTotal, simulaciones: SIMULACIONES, e: [esp.visita, esp.local], // con «e» y la semilla la página repite la misma simulación
    picks: todos.map(k => Object.assign(guardar(k), top.indexOf(k) >= 0 ? { top: 1 } : {})),
    riesgo: riesgo.map(guardar)
  };
}
// Marca lo que ya se puede saber. Los picks sin «ok» siguen pendientes; ok = null es anulado.
function calificar(reg, p) {
  const estad = estadDe(p);
  const todos = reg.picks.concat(reg.riesgo || []);
  todos.forEach(k => { if (k.ok === undefined) { const r = P.calificar(k.m, p, estad); if (r !== undefined) k.ok = r; } });
  reg.final = [p.ptsVisita, p.ptsLocal];
  reg.calificado = todos.every(k => k.ok !== undefined);
  if (reg.calificado) completos++; else parciales++;
}
// Solo se reconstruyen jornadas recientes: las que aún tienen su parte de lesiones guardado.
const reciente = p => ctx.lesiones && ctx.lesiones.temporada === p.temporada && ctx.lesiones.semanas && ctx.lesiones.semanas[p.semana];

partidos.filter(p => p.temporada === ultima).forEach(p => {
  const ini = P.inicio(p), reg = historial.partidos[p.id];
  if (!p.jugado && ini && ahora < ini - P.MARGEN_CONGELAR && ini - ahora < VENTANA) {
    historial.partidos[p.id] = pronosticar(p, ini, false); // todavía no empieza: se guarda el pronóstico vigente
    congelados++;
  } else if (p.jugado && reg && !reg.calificado) {
    calificar(reg, p);
  } else if (p.jugado && !reg && ini && reciente(p)) {
    // Se jugó sin quedar guardado: se rehace con lo que se sabía antes de esa jornada y se marca como rehecho.
    const nuevo = pronosticar(p, ini, true);
    nuevo.reconstruido = true; calificar(nuevo, p);
    historial.partidos[p.id] = nuevo; reconstruidos++;
  }
});
const nuevo = JSON.stringify(historial);
if (!fs.existsSync(archivo) || fs.readFileSync(archivo, 'utf8') !== nuevo) fs.writeFileSync(archivo, nuevo);
console.log(`Vigentes guardados: ${congelados} · calificados del todo: ${completos} · a medias (faltan estadísticas): ${parciales} · rehechos: ${reconstruidos} · en el historial: ${Object.keys(historial.partidos).length}`);
