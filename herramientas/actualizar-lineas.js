// Baja las líneas reales de las casas de apuestas con The Odds API y guarda datos/lineas.json.
// Necesita la clave en la variable ODDS_API_KEY; sin ella no hace nada.
// Gasto aproximado por ejecución: 2 créditos (hándicap y total de toda la jornada) + 5 por cada
// partido que empieza en las próximas 40 horas (líneas de jugadores).
const fs = require('fs'), path = require('path');
const M = require('../modelo.js'), P = require('../picks.js');
const CLAVE = process.env.ODDS_API_KEY, BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com';
const DEPORTE = '/v4/sports/americanfootball_nfl', archivo = path.join(__dirname, '../datos/lineas.json');
const CASAS = ['betano', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers']; // orden de preferencia
const DE_JUGADOR = { player_pass_yds: 'pase', player_rush_yds: 'carrera', player_reception_yds: 'recepcion', player_pass_tds: 'tdPase', player_anytime_td: 'td' };
const HORAS_JUGADORES = 40, HORA = 3600 * 1000;
if (!CLAVE) { console.log('Sin ODDS_API_KEY: no se bajan líneas.'); process.exit(0); }

const codigo = {}; Object.keys(P.NOMBRES).forEach(c => { codigo[P.NOMBRES[c]] = c; });
async function pedir(ruta, parametros) {
  const url = BASE + ruta + '?' + new URLSearchParams(Object.assign({ apiKey: CLAVE, regions: 'us', oddsFormat: 'decimal' }, parametros));
  const r = await fetch(url);
  if (!r.ok) throw new Error(ruta + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200));
  console.log(ruta, '· créditos restantes:', r.headers.get('x-requests-remaining'));
  return r.json();
}
// De todas las casas que traen un mercado, la preferida.
function mercado(evento, clave) {
  const con = (evento.bookmakers || []).filter(b => (b.markets || []).some(m => m.key === clave && (m.outcomes || []).length));
  if (!con.length) return null;
  const casa = CASAS.map(k => con.find(b => b.key === k)).find(Boolean) || con[0];
  return { casa: casa.title, resultados: casa.markets.find(m => m.key === clave).outcomes };
}

(async () => {
  const partidos = M.prepararPartidos(M.leerCSV(fs.readFileSync(path.join(__dirname, '../datos/partidos.csv'), 'utf8')), 2010);
  const ahora = Date.now(), pendientes = partidos.filter(p => !p.jugado && P.inicio(p) && P.inicio(p) > ahora);
  let previo = {}; try { previo = JSON.parse(fs.readFileSync(archivo, 'utf8')).partidos || {}; } catch (e) { /* primera vez */ }
  const salida = {}; pendientes.forEach(p => { if (previo[p.id]) salida[p.id] = previo[p.id]; }); // se conserva lo ya bajado de partidos que no han empezado
  const eventos = await pedir(DEPORTE + '/odds', { markets: 'spreads,totals' });
  let conJugadores = 0;
  for (const ev of eventos) {
    const local = codigo[ev.home_team], visita = codigo[ev.away_team], inicio = Date.parse(ev.commence_time);
    const p = pendientes.find(x => x.local === local && x.visita === visita && Math.abs(P.inicio(x) - inicio) < 36 * HORA);
    if (!p) continue;
    const reg = salida[p.id] = salida[p.id] || { jug: {} }, h = mercado(ev, 'spreads'), t = mercado(ev, 'totals');
    reg.actualizado = new Date().toISOString();
    if (h) { const o = h.resultados.find(x => x.name === ev.home_team); if (o && o.point != null) { reg.h = o.point; reg.casa = h.casa; } }
    if (t) { const o = t.resultados.find(x => x.name === 'Over'); if (o && o.point != null) { reg.t = o.point; reg.casa = reg.casa || t.casa; } }
    if (inicio - ahora > HORAS_JUGADORES * HORA) continue;
    // Líneas de jugadores: una petición por partido, solo cuando está cerca de empezar.
    const det = await pedir(DEPORTE + '/events/' + ev.id + '/odds', { markets: Object.keys(DE_JUGADOR).join(',') });
    reg.jug = {};
    Object.keys(DE_JUGADOR).forEach(clave => {
      const m = mercado(det, clave); if (!m) return;
      reg.casaJugadores = m.casa;
      m.resultados.forEach(o => {
        if (!o.description) return;
        const j = reg.jug[P.normalizar(o.description)] = reg.jug[P.normalizar(o.description)] || {}, e = DE_JUGADOR[clave];
        if (e === 'td') { if (o.name === 'Yes') j.td = { si: o.price }; return; }
        if (o.point == null) return;
        j[e] = j[e] || { l: o.point }; j[e][o.name === 'Over' ? 'mas' : 'menos'] = o.price;
      });
    });
    conJugadores++;
  }
  fs.writeFileSync(archivo, JSON.stringify({ actualizado: new Date().toISOString(), partidos: salida }));
  console.log(`Líneas guardadas: ${Object.keys(salida).length} partidos, ${conJugadores} con jugadores actualizados ahora.`);
})().catch(e => { console.error('No se pudieron bajar las líneas:', e.message); process.exit(1); });
