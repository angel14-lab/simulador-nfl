// Baja las líneas y cuotas reales de una casa de apuestas con The Odds API y guarda datos/lineas.json.
// Necesita la clave en ODDS_API_KEY; sin ella no hace nada.
//
// Para cada partido que empieza en las próximas HORAS horas y aún no se bajó, una sola petición con:
//   ganador (h2h), hándicaps alternativos, totales alternativos y yardas de pase, carrera y recepción.
// Cuesta 1 crédito por mercado: 6 por partido, unos 96 por semana (el plan gratuito da 500 al mes).
// La lista de partidos (/events) no gasta créditos.
const fs = require('fs'), path = require('path');
const P = require('../picks.js');
const CLAVE = process.env.ODDS_API_KEY, BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com';
const DEPORTE = '/v4/sports/americanfootball_nfl', archivo = path.join(__dirname, '../datos/lineas.json');
const CASAS = ['betano', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers']; // orden de preferencia
const MERCADOS = ['h2h', 'alternate_spreads', 'alternate_totals', 'player_pass_yds', 'player_rush_yds', 'player_reception_yds'];
const DE_JUGADOR = { player_pass_yds: 'pase', player_rush_yds: 'carrera', player_reception_yds: 'recepcion' };
const HORAS = Number(process.env.HORAS || 16), HORA = 3600 * 1000;
if (!CLAVE) { console.log('Sin ODDS_API_KEY: no se bajan líneas.'); process.exit(0); }

const codigo = {}; Object.keys(P.NOMBRES).forEach(c => { codigo[P.NOMBRES[c]] = c; });
async function pedir(ruta, parametros) {
  const url = BASE + ruta + '?' + new URLSearchParams(Object.assign({ apiKey: CLAVE }, parametros));
  const r = await fetch(url);
  if (!r.ok) throw new Error(ruta + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200));
  if (r.headers.get('x-requests-remaining')) console.log(ruta, '· créditos restantes:', r.headers.get('x-requests-remaining'));
  return r.json();
}
// La casa preferida que trae un mercado.
function casaCon(evento, clave) {
  const con = (evento.bookmakers || []).filter(b => (b.markets || []).some(m => m.key === clave && (m.outcomes || []).length));
  return con.length ? CASAS.map(k => con.find(b => b.key === k)).find(Boolean) || con[0] : null;
}
const resultados = (casa, clave) => casa.markets.find(m => m.key === clave).outcomes;

(async () => {
  let previo = {}; try { previo = JSON.parse(fs.readFileSync(archivo, 'utf8')).partidos || {}; } catch (e) { /* primera vez */ }
  const ahora = Date.now(), eventos = await pedir(DEPORTE + '/events', {});
  const salida = {}, vigentes = new Set();
  let bajados = 0;
  for (const ev of eventos) {
    const local = codigo[ev.home_team], visita = codigo[ev.away_team], inicio = Date.parse(ev.commence_time);
    if (!local || !visita || inicio < ahora) continue;
    const fecha = new Date(inicio - 5 * HORA).toISOString().slice(0, 10); // fecha en la costa este, como la usa nflverse
    const id = Object.keys(previo).find(k => previo[k].ev === ev.id) || ('ev:' + ev.id);
    vigentes.add(id);
    if (previo[id]) salida[id] = previo[id];
    if (inicio - ahora > HORAS * HORA || (previo[id] && previo[id].completo)) continue;
    const det = await pedir(DEPORTE + '/events/' + ev.id + '/odds', { regions: 'us', oddsFormat: 'decimal', markets: MERCADOS.join(',') });
    const reg = { ev: ev.id, local, visita, fecha, actualizado: new Date().toISOString(), completo: true, ml: {}, hs: {}, ts: { mas: {}, menos: {} }, jug: {} };
    let casa = casaCon(det, 'h2h');
    if (casa) { reg.casa = casa.title; resultados(casa, 'h2h').forEach(o => { if (codigo[o.name]) reg.ml[codigo[o.name]] = o.price; }); }
    casa = casaCon(det, 'alternate_spreads');
    if (casa) { reg.casaLineas = casa.title; resultados(casa, 'alternate_spreads').forEach(o => { const e = codigo[o.name]; if (e && o.point != null) (reg.hs[e] = reg.hs[e] || {})[o.point] = o.price; }); }
    casa = casaCon(det, 'alternate_totals');
    if (casa) resultados(casa, 'alternate_totals').forEach(o => { if (o.point != null) reg.ts[o.name === 'Over' ? 'mas' : 'menos'][o.point] = o.price; });
    Object.keys(DE_JUGADOR).forEach(clave => {
      const c = casaCon(det, clave); if (!c) return;
      reg.casaJugadores = c.title;
      resultados(c, clave).forEach(o => {
        if (!o.description || o.point == null) return;
        const j = reg.jug[P.normalizar(o.description)] = reg.jug[P.normalizar(o.description)] || {}, e = DE_JUGADOR[clave];
        j[e] = j[e] || { l: o.point }; j[e][o.name === 'Over' ? 'mas' : 'menos'] = o.price;
      });
    });
    salida[id] = reg; bajados++;
  }
  // Se asocia cada evento con su partido de nflverse por equipos y fecha.
  const partidos = require('../modelo.js').prepararPartidos(require('../modelo.js').leerCSV(fs.readFileSync(path.join(__dirname, '../datos/partidos.csv'), 'utf8')), 2010);
  const final = {};
  Object.keys(salida).forEach(k => {
    const r = salida[k], p = partidos.find(x => x.local === r.local && x.visita === r.visita && Math.abs(Date.parse(x.fecha) - Date.parse(r.fecha)) <= 2 * 24 * HORA);
    final[p ? p.id : k] = r;
  });
  fs.writeFileSync(archivo, JSON.stringify({ actualizado: new Date().toISOString(), partidos: final }));
  console.log(`Partidos con líneas: ${Object.keys(final).length} · bajados ahora: ${bajados} (${bajados * MERCADOS.length} créditos)`);
})().catch(e => { console.error('No se pudieron bajar las líneas:', e.message); process.exit(1); });
