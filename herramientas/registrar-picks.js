// Congela los picks de cada partido antes de que empiece y los califica cuando termina.
// Guarda datos/historial.json.  Uso: node registrar-picks.js   (después de actualizar-datos.js)
const fs = require('fs'), path = require('path');
const M = require('../modelo.js'), P = require('../picks.js');
const datos = path.join(__dirname, '../datos'), archivo = path.join(datos, 'historial.json');
const leer = (n, defecto) => { try { return JSON.parse(fs.readFileSync(path.join(datos, n), 'utf8')); } catch (e) { return defecto; } };
const SIMULACIONES = 10000, VENTANA = 8 * 24 * 3600 * 1000, MAX_ANOTADORES = 8;

const partidos = M.prepararPartidos(M.leerCSV(fs.readFileSync(path.join(datos, 'partidos.csv'), 'utf8')), 2010);
const estado = M.calificar(partidos), jug = leer('jugadores.json', null), indice = P.indexar(jug);
const ctx = { jug, porEquipo: indice.porEquipo, semanas: indice.semanas, lesiones: leer('lesiones.json', null), titular: estado.titular };
const historial = leer('historial.json', { partidos: {} }), ahora = Date.now();
const ultima = partidos[partidos.length - 1].temporada, r3 = x => Math.round(x * 1000) / 1000;
let congelados = 0, calificados = 0;

// Estadísticas de un jugador en un partido concreto, sacadas de sus últimos partidos guardados.
const porId = {}; (jug ? jug.jugadores : []).forEach(j => { porId[j.id] = j; });
const estadDe = p => id => {
  const g = porId[id] && porId[id].j.find(x => x[0] === p.temporada && x[1] === p.semana);
  return g ? { td: g[8] + g[12], tdPase: g[5] } : null;
};
const hayEstadisticas = p => [p.local, p.visita].every(e => indice.semanas[e] && indice.semanas[e][p.semana]) && jug && jug.temporada === p.temporada;

partidos.filter(p => p.temporada === ultima).forEach(p => {
  const ini = P.inicio(p), reg = historial.partidos[p.id];
  if (!p.jugado && ini && ahora < ini - P.MARGEN_CONGELAR && ini - ahora < VENTANA) {
    // Todavía no empieza: se guarda (o se reemplaza) el pronóstico vigente.
    const esp = { local: Math.max(3, p.pred.local), visita: Math.max(3, p.pred.visita) };
    const sim = M.simular(esp.local, esp.visita, SIMULACIONES, M.semillaDe(p.id), p.tipo !== 'REG');
    const todos = P.picksDe(ctx, p, sim, esp), anotadores = todos.filter(k => k.tipo === 'td').slice(0, MAX_ANOTADORES);
    historial.partidos[p.id] = {
      temporada: p.temporada, semana: p.semana, visita: p.visita, local: p.local, inicio: new Date(ini).toISOString(),
      pV: r3(sim.pVisita), pL: r3(sim.pLocal), mV: Math.round(sim.mediaVisita * 10) / 10, mL: Math.round(sim.mediaLocal * 10) / 10,
      picks: todos.filter(k => k.tipo !== 'td').concat(anotadores).sort((a, b) => b.prob - a.prob)
        .map(k => ({ t: k.tipo, eq: k.eq, q: k.quien, que: k.que, p: r3(k.prob), m: k.m }))
    };
    congelados++;
  } else if (p.jugado && reg && !reg.calificado && hayEstadisticas(p)) {
    // Ya terminó y están publicadas las estadísticas: se marca cada pick como acertado, fallado o anulado.
    const estad = estadDe(p);
    reg.picks.forEach(k => { k.ok = P.calificar(k.m, p, estad); });
    reg.final = [p.ptsVisita, p.ptsLocal]; reg.calificado = true; calificados++;
  }
});
const nuevo = JSON.stringify(historial);
if (!fs.existsSync(archivo) || fs.readFileSync(archivo, 'utf8') !== nuevo) fs.writeFileSync(archivo, nuevo);
console.log(`Pronósticos vigentes guardados: ${congelados} · partidos calificados ahora: ${calificados} · en el historial: ${Object.keys(historial.partidos).length}`);
