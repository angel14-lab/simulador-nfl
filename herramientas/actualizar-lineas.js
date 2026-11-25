// Baja las líneas y cuotas reales de una casa de apuestas con The Odds API y guarda datos/lineas.json.
// Necesita la clave en ODDS_API_KEY; sin ella no hace nada.
//
// Dos peticiones por partido, 3 créditos cada una (1 por mercado), unos 96 por semana:
//   1. en las 4 horas previas: ganador, hándicaps alternativos y totales alternativos;
//   2. en las 24 horas previas (ya publicado el parte final de lesiones, que sale el día anterior):
//      yardas de pase, carrera y recepción.
// La lista de partidos (/events) no gasta créditos.
const fs = require('fs'), path = require('path');
const P = require('../picks.js');
const CLAVE = process.env.ODDS_API_KEY, BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com';
const DEPORTE = '/v4/sports/americanfootball_nfl', archivo = path.join(__dirname, '../datos/lineas.json');
const CASAS = ['betano', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers']; // orden de preferencia
const PARTIDO = ['h2h', 'alternate_spreads', 'alternate_totals'];
const JUGADOR = ['player_pass_yds', 'player_rush_yds', 'player_reception_yds'];
const DE_JUGADOR = { player_pass_yds: 'pase', player_rush_yds: 'carrera', player_reception_yds: 'recepcion' };
// Líneas de jugadores: en las 24 horas previas al inicio (CONF_DESDE en minutos).
const CONF_DESDE = Number(process.env.CONF_DESDE || 24 * 60), CONF_HASTA = 10, MINUTO = 60 * 1000;
const HORAS = Number(process.env.HORAS || 4), HORA = 3600 * 1000; // mercados del partido: en las 4 horas previas, con las noticias del día
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
  let bajados = 0, confirmados = 0, creditos = 0;
  for (const ev of eventos) {
    const local = codigo[ev.home_team], visita = codigo[ev.away_team], inicio = Date.parse(ev.commence_time);
    if (!local || !visita || inicio < ahora) continue;
    const fecha = new Date(inicio - 5 * HORA).toISOString().slice(0, 10); // fecha en la costa este, como la usa nflverse
    const id = Object.keys(previo).find(k => previo[k].ev === ev.id) || ('ev:' + ev.id);
    vigentes.add(id);
    if (previo[id]) salida[id] = previo[id];
    const reg = salida[id] = salida[id] || { ev: ev.id, local, visita, fecha, ml: {}, hs: {}, ts: { mas: {}, menos: {} }, jug: {} };
    const faltan = (inicio - ahora) / MINUTO;
    // 1. Mercados del partido: una vez, el día del partido.
    if (faltan <= HORAS * 60 && !reg.partido) {
      const det = await pedir(DEPORTE + '/events/' + ev.id + '/odds', { regions: 'us', oddsFormat: 'decimal', markets: PARTIDO.join(',') });
      reg.ml = {}; reg.hs = {}; reg.ts = { mas: {}, menos: {} };
      let casa = casaCon(det, 'h2h');
      if (casa) { reg.casa = casa.title; resultados(casa, 'h2h').forEach(o => { if (codigo[o.name]) reg.ml[codigo[o.name]] = o.price; }); }
      casa = casaCon(det, 'alternate_spreads');
      if (casa) { reg.casaLineas = casa.title; resultados(casa, 'alternate_spreads').forEach(o => { const e = codigo[o.name]; if (e && o.point != null) (reg.hs[e] = reg.hs[e] || {})[o.point] = o.price; }); }
      casa = casaCon(det, 'alternate_totals');
      if (casa) resultados(casa, 'alternate_totals').forEach(o => { if (o.point != null) reg.ts[o.name === 'Over' ? 'mas' : 'menos'][o.point] = o.price; });
      // Línea principal de ese momento: la del hándicap y la del total donde los dos lados pagan casi lo mismo.
      // Con ella se calculan los puntos esperados, así recoge las noticias de última hora que mueven el mercado.
      const principal = (a, b) => { let m = null; Object.keys(a || {}).forEach(l => { const o = b(l); if (o && (!m || Math.abs(a[l] - o) < m.d)) m = { l: Number(l), d: Math.abs(a[l] - o) }; }); return m && m.l; };
      reg.h = principal(reg.hs[local], l => reg.hs[visita] && reg.hs[visita][-Number(l)]);
      reg.t = principal(reg.ts.mas, l => reg.ts.menos[l]);
      reg.partido = reg.actualizado = new Date().toISOString(); bajados++; creditos += PARTIDO.length;
    }
    // 2. Jugadores: una vez, cerca del inicio. Si la casa ya no ofrece la línea de un jugador, no juega.
    if (faltan <= CONF_DESDE && faltan >= CONF_HASTA && !reg.confirmado) {
      const det = await pedir(DEPORTE + '/events/' + ev.id + '/odds', { regions: 'us', oddsFormat: 'decimal', markets: JUGADOR.join(',') });
      reg.jug = {};
      JUGADOR.forEach(clave => {
        const c = casaCon(det, clave); if (!c) return;
        reg.casaJugadores = c.title;
        resultados(c, clave).forEach(o => {
          if (!o.description || o.point == null) return;
          const j = reg.jug[P.normalizar(o.description)] = reg.jug[P.normalizar(o.description)] || {}, e = DE_JUGADOR[clave];
          j[e] = j[e] || { l: o.point }; j[e][o.name === 'Over' ? 'mas' : 'menos'] = o.price;
        });
      });
      reg.confirmado = new Date().toISOString(); confirmados++; creditos += JUGADOR.length;
    }
  }
  // Se asocia cada evento con su partido de nflverse por equipos y fecha.
  const partidos = require('../modelo.js').prepararPartidos(require('../modelo.js').leerCSV(fs.readFileSync(path.join(__dirname, '../datos/partidos.csv'), 'utf8')), 2010);
  const final = {};
  Object.keys(salida).forEach(k => {
    const r = salida[k], p = partidos.find(x => x.local === r.local && x.visita === r.visita && Math.abs(Date.parse(x.fecha) - Date.parse(r.fecha)) <= 2 * 24 * HORA);
    final[p ? p.id : k] = r;
  });
  fs.writeFileSync(archivo, JSON.stringify({ actualizado: new Date().toISOString(), partidos: final }));
  console.log(`Partidos con líneas: ${Object.keys(final).length} · mercados de partido bajados: ${bajados} · líneas de jugadores bajadas: ${confirmados} · ${creditos} créditos`);
})().catch(e => { console.error('No se pudieron bajar las líneas:', e.message); process.exit(1); });
