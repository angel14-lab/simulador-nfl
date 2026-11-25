// Baja los datos reales de nflverse y guarda la copia que usa el sitio:
//   datos/partidos.csv  partidos + eficiencia por jugada (EPA) + descartados por lesión de cada equipo
//   datos/lesiones.json parte de lesiones de las últimas jornadas, para mostrarlo en la página
//   datos/jugadores.json últimos partidos de cada jugador de ataque, defensas rivales y estadísticas de equipo
//   datos/mitades.csv   marcador al descanso de cada partido (de play-by-play), para calificar los picks de primera mitad
// Uso: node actualizar-datos.js [carpeta con games.csv, st_AAAA.csv, inj_AAAA.csv y pl_AAAA.csv ya descargados]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const M = require('../modelo.js');
const PARTIDOS = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PUBLICADOS = 'https://github.com/nflverse/nflverse-data/releases/download/';
const COLUMNAS = ['game_id', 'season', 'game_type', 'week', 'gameday', 'gametime', 'away_team', 'away_score', 'home_team', 'home_score',
  'location', 'overtime', 'away_moneyline', 'home_moneyline', 'spread_line', 'total_line', 'away_qb_name', 'home_qb_name', 'stadium',
  'away_qb_id', 'home_qb_id', 'away_rest', 'home_rest', 'roof', 'away_epa', 'home_epa', 'away_bajas', 'home_bajas', 'away_td', 'home_td', 'fg', 'away_h1', 'home_h1'];
const DESDE = 2010, carpeta = process.argv[2];
const ATAQUE = ['WR', 'RB', 'TE'], LINEA = ['T', 'G', 'C', 'OT', 'OG', 'OL'], NO_CUENTA = ['QB', 'K', 'P', 'LS', 'FB'];
const alias = t => M.ALIAS[t] || t;

async function leer(local, url, opcional) {
  try {
    if (carpeta) return fs.readFileSync(path.join(carpeta, local), 'utf8');
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' → ' + r.status);
    return await r.text();
  } catch (e) { if (opcional) { console.log('Sin ' + local + ' (' + e.message + ')'); return ''; } throw e; }
}

// Últimos partidos de cada jugador (para proyectar yardas y touchdowns), lo que concede cada defensa
// y las estadísticas de temporada de cada equipo.
async function guardarJugadores(ultima, datos) {
  const n = (r, k) => Number(r[k]) || 0, porJugador = {}, defensas = {}, liga = { py: 0, ry: 0, td: 0, g: 0 }, porPartido = {};
  for (const a of [ultima - 1, ultima]) {
    M.leerCSV(await leer(`pl_${a}.csv`, `${PUBLICADOS}stats_player/stats_player_week_${a}.csv`, a === ultima)).forEach(r => {
      if (!['QB', 'RB', 'WR', 'TE'].includes(r.position)) return;
      const eq = alias(r.team), riv = alias(r.opponent_team);
      const j = porJugador[r.player_id] = porJugador[r.player_id] || { id: r.player_id, n: r.player_display_name, p: r.position, e: eq, j: [] };
      j.e = eq; j.p = r.position; j.u = [a, Number(r.week)];
      j.j.push([a, Number(r.week), riv, n(r, 'attempts'), n(r, 'passing_yards'), n(r, 'passing_tds'), n(r, 'carries'), n(r, 'rushing_yards'), n(r, 'rushing_tds'),
        n(r, 'targets'), n(r, 'receptions'), n(r, 'receiving_yards'), n(r, 'receiving_tds')]);
      if (a === ultima) {
        const g = porPartido[r.game_id + '|' + eq] = porPartido[r.game_id + '|' + eq] || { riv, py: 0, ry: 0, td: 0 };
        g.py += n(r, 'passing_yards'); g.ry += n(r, 'rushing_yards'); g.td += n(r, 'rushing_tds') + n(r, 'receiving_tds');
      }
    });
  }
  Object.values(porPartido).forEach(g => {
    const d = defensas[g.riv] = defensas[g.riv] || { py: 0, ry: 0, td: 0, g: 0 };
    ['py', 'ry', 'td'].forEach(k => { d[k] += g[k]; liga[k] += g[k]; }); d.g++; liga.g++;
  });
  const jugadores = Object.values(porJugador).filter(j => j.u[0] === ultima).map(j => {
    j.j.sort((x, y) => x[0] - y[0] || x[1] - y[1]); j.j = j.j.slice(-10);
    const media = f => j.j.reduce((s, x) => s + f(x), 0) / j.j.length;
    j.vale = media(x => x[3]) >= 15 || media(x => x[7] + x[11]) >= 12;
    return j;
  }).filter(j => j.vale).map(j => ({ id: j.id, n: j.n, p: j.p, e: j.e, j: j.j }));
  // Estadísticas de equipo de la temporada en curso.
  const filasEq = M.leerCSV(await leer(`st_${ultima}.csv`, `${PUBLICADOS}stats_team/stats_team_week_${ultima}.csv`, true)), equipos = {}, porJuego = {};
  filasEq.forEach(r => { (porJuego[r.game_id] = porJuego[r.game_id] || []).push(r); });
  filasEq.forEach(r => {
    const rival = (porJuego[r.game_id] || []).find(x => x !== r), e = equipos[alias(r.team)] = equipos[alias(r.team)] || { g: 0, pase: 0, carrera: 0, perdidas: 0, capturasSufridas: 0, paseC: 0, carreraC: 0, robos: 0, capturas: 0 };
    e.g++; e.pase += n(r, 'passing_yards'); e.carrera += n(r, 'rushing_yards'); e.capturasSufridas += n(r, 'sacks_suffered');
    e.perdidas += n(r, 'passing_interceptions') + n(r, 'sack_fumbles_lost') + n(r, 'rushing_fumbles_lost') + n(r, 'receiving_fumbles_lost');
    e.capturas += n(r, 'def_sacks'); e.robos += n(r, 'def_interceptions') + n(r, 'fumble_recovery_opp');
    if (rival) { e.paseC += n(rival, 'passing_yards'); e.carreraC += n(rival, 'rushing_yards'); }
  });
  fs.writeFileSync(path.join(datos, 'jugadores.json'), JSON.stringify({ temporada: ultima, jugadores, defensas, liga, equipos }));
  console.log(jugadores.length + ' jugadores guardados');
}

/* Marcador al descanso. Lo de temporadas pasadas ya está en datos/mitades.csv; si a algún partido jugado le
   falta, se baja el play-by-play de esa temporada y se toma el mayor marcador de cada equipo en los cuartos 1 y 2. */
function partirCSV(linea) {
  const r = []; let c = '', q = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (q) { if (ch === '"') { if (linea[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; } else c += ch;
  }
  r.push(c); return r;
}
async function mitades(filas, datos) {
  const archivo = path.join(datos, 'mitades.csv'), h1 = {};
  if (fs.existsSync(archivo)) M.leerCSV(fs.readFileSync(archivo, 'utf8')).forEach(r => { h1[r.game_id] = [r.away_h1, r.home_h1]; });
  const faltan = [...new Set(filas.filter(f => Number(f.season) >= 2016 && f.home_score !== '' && f.home_score !== 'NA' && !h1[f.game_id]).map(f => Number(f.season)))];
  for (const a of faltan) {
    try {
      const gz = carpeta ? fs.readFileSync(path.join(carpeta, `pbp_${a}.csv.gz`)) : Buffer.from(await (await fetch(`${PUBLICADOS}pbp/play_by_play_${a}.csv.gz`)).arrayBuffer());
      const lineas = zlib.gunzipSync(gz).toString('utf8').split('\n'), cab = partirCSV(lineas[0]);
      const ix = k => cab.indexOf(k), id = ix('game_id'), qt = ix('qtr'), hs = ix('total_home_score'), as = ix('total_away_score'), nuevo = {};
      for (let i = 1; i < lineas.length; i++) {
        if (!lineas[i]) continue;
        const f = partirCSV(lineas[i]), q = Number(f[qt]), h = Number(f[hs]), v = Number(f[as]);
        if (!f[id] || q > 2 || isNaN(h) || isNaN(v)) continue;
        const g = nuevo[f[id]] = nuevo[f[id]] || [0, 0]; g[0] = Math.max(g[0], v); g[1] = Math.max(g[1], h);
      }
      // Solo partidos terminados (el play-by-play puede traer uno a medias).
      filas.forEach(f => { if (Number(f.season) === a && f.home_score !== '' && f.home_score !== 'NA' && nuevo[f.game_id]) h1[f.game_id] = nuevo[f.game_id].map(String); });
    } catch (e) { console.log('Sin play-by-play ' + a + ' (' + e.message + ')'); }
  }
  fs.writeFileSync(archivo, ['game_id,away_h1,home_h1'].concat(Object.keys(h1).sort().map(k => k + ',' + h1[k].join(','))).join('\n') + '\n');
  return h1;
}

(async () => {
  const filas = M.leerCSV(await leer('games.csv', PARTIDOS)).filter(f => Number(f.season) >= DESDE);
  if (filas.length < 4000) throw new Error('games.csv incompleto');
  const ultima = Math.max(...filas.map(f => Number(f.season)));
  const epa = {}, bajas = {}, parte = {}, tds = {}, goles = {}, modificado = {};
  for (let a = DESDE; a <= ultima; a++) {
    const viejo = a < ultima; // la temporada en curso puede no tener archivos todavía
    M.leerCSV(await leer(`st_${a}.csv`, `${PUBLICADOS}stats_team/stats_team_week_${a}.csv`, !viejo)).forEach(r => {
      const n = k => Number(r[k]) || 0; // touchdowns y goles de campo reales, para calificar esos mercados
      tds[r.game_id + '|' + alias(r.team)] = n('passing_tds') + n('rushing_tds') + n('special_teams_tds') + n('def_tds') + n('fumble_recovery_tds');
      goles[r.game_id] = (goles[r.game_id] || 0) + n('fg_made');
      if (r.passing_epa === '' || r.passing_epa === 'NA') return;
      epa[r.game_id + '|' + alias(r.team)] = ((Number(r.passing_epa) || 0) + (Number(r.rushing_epa) || 0)).toFixed(2);
    });
    M.leerCSV(await leer(`inj_${a}.csv`, `${PUBLICADOS}injuries/injuries_${a}.csv`, !viejo)).forEach(r => {
      if (!r.report_status && !r.practice_status) return;
      const equipo = alias(r.team), semana = Number(r.week);
      if (a === ultima && r.date_modified && r.date_modified > (modificado[semana] || '')) modificado[semana] = r.date_modified;
      // Parte de la temporada en curso: estado de juego (desde el día anterior) y último entrenamiento
      // (desde mitad de semana: NP no entrenó, LP limitado, FP completo; d = día de descanso, no lesión).
      const pr = /Did Not/i.test(r.practice_status) ? 'NP' : /Limited/i.test(r.practice_status) ? 'LP' : /Full/i.test(r.practice_status) ? 'FP' : '';
      if (a === ultima) ((parte[semana] = parte[semana] || {})[equipo] = parte[semana][equipo] || [])
        .push(Object.assign({ n: r.full_name, p: r.position, e: r.report_status || '', l: r.report_primary_injury || r.practice_primary_injury || '' }, pr ? { pr } : {},
          /^Not injury related/i.test(r.practice_primary_injury || r.report_primary_injury || '') ? { d: 1 } : {}));
      if (!r.report_status) return;
      if ((r.report_status !== 'Out' && r.report_status !== 'Doubtful') || NO_CUENTA.includes(r.position)) return;
      const b = bajas[a + '|' + semana + '|' + equipo] = bajas[a + '|' + semana + '|' + equipo] || [0, 0, 0];
      b[ATAQUE.includes(r.position) ? 0 : LINEA.includes(r.position) ? 1 : 2]++;
    });
  }
  const datos = path.join(__dirname, '../datos'), h1 = await mitades(filas, datos);
  filas.forEach(f => {
    if (h1[f.game_id]) { f.away_h1 = h1[f.game_id][0]; f.home_h1 = h1[f.game_id][1]; }
    const cuenta = e => (bajas[f.season + '|' + Number(f.week) + '|' + alias(e)] || [0, 0, 0]).join('|');
    f.away_epa = epa[f.game_id + '|' + alias(f.away_team)] || ''; f.home_epa = epa[f.game_id + '|' + alias(f.home_team)] || '';
    f.away_bajas = cuenta(f.away_team); f.home_bajas = cuenta(f.home_team);
    const tv = tds[f.game_id + '|' + alias(f.away_team)], tl = tds[f.game_id + '|' + alias(f.home_team)];
    f.away_td = tv == null ? '' : String(tv); f.home_td = tl == null ? '' : String(tl); f.fg = tv == null || tl == null ? '' : String(goles[f.game_id] || 0);
  });
  const celda = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const salida = [COLUMNAS.join(',')].concat(filas.map(f => COLUMNAS.map(c => celda(f[c] === 'NA' ? '' : f[c] || '')).join(','))).join('\n') + '\n';
  fs.writeFileSync(path.join(datos, 'partidos.csv'), salida);
  // Solo las tres últimas jornadas con parte: es lo que la página puede necesitar mostrar.
  const semanas = Object.keys(parte).map(Number).sort((x, y) => y - x).slice(0, 3), reciente = {};
  semanas.forEach(s => { reciente[s] = parte[s]; });
  fs.writeFileSync(path.join(datos, 'lesiones.json'), JSON.stringify({ temporada: ultima, semanas: reciente, modificado: modificado, bajado: new Date().toISOString() }));
  await guardarJugadores(ultima, datos);
  const jugados = filas.filter(f => f.home_score !== '' && f.home_score !== 'NA');
  console.log(filas.length + ' partidos guardados; último jugado: ' + jugados[jugados.length - 1].game_id +
    '; con EPA: ' + filas.filter(f => f.home_epa).length + '; parte de lesiones: semanas ' + semanas.join(', '));
})().catch(e => { console.error(e); process.exit(1); });
