// Baja los datos reales de nflverse y guarda la copia que usa el sitio:
//   datos/partidos.csv  partidos + eficiencia por jugada (EPA) + descartados por lesión de cada equipo
//   datos/lesiones.json parte de lesiones de las últimas jornadas, para mostrarlo en la página
//   datos/jugadores.json últimos partidos de cada jugador de ataque, defensas rivales y estadísticas de equipo
// Uso: node actualizar-datos.js [carpeta con games.csv, st_AAAA.csv, inj_AAAA.csv y pl_AAAA.csv ya descargados]
const fs = require('fs'), path = require('path');
const M = require('../modelo.js');
const PARTIDOS = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const PUBLICADOS = 'https://github.com/nflverse/nflverse-data/releases/download/';
const COLUMNAS = ['game_id', 'season', 'game_type', 'week', 'gameday', 'gametime', 'away_team', 'away_score', 'home_team', 'home_score',
  'location', 'overtime', 'away_moneyline', 'home_moneyline', 'spread_line', 'total_line', 'away_qb_name', 'home_qb_name', 'stadium',
  'away_qb_id', 'home_qb_id', 'away_rest', 'home_rest', 'roof', 'away_epa', 'home_epa', 'away_bajas', 'home_bajas'];
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

(async () => {
  const filas = M.leerCSV(await leer('games.csv', PARTIDOS)).filter(f => Number(f.season) >= DESDE);
  if (filas.length < 4000) throw new Error('games.csv incompleto');
  const ultima = Math.max(...filas.map(f => Number(f.season)));
  const epa = {}, bajas = {}, parte = {};
  for (let a = DESDE; a <= ultima; a++) {
    const viejo = a < ultima; // la temporada en curso puede no tener archivos todavía
    M.leerCSV(await leer(`st_${a}.csv`, `${PUBLICADOS}stats_team/stats_team_week_${a}.csv`, !viejo)).forEach(r => {
      if (r.passing_epa === '' || r.passing_epa === 'NA') return;
      epa[r.game_id + '|' + alias(r.team)] = ((Number(r.passing_epa) || 0) + (Number(r.rushing_epa) || 0)).toFixed(2);
    });
    M.leerCSV(await leer(`inj_${a}.csv`, `${PUBLICADOS}injuries/injuries_${a}.csv`, !viejo)).forEach(r => {
      if (!r.report_status) return;
      const equipo = alias(r.team), semana = Number(r.week);
      if (a === ultima) ((parte[semana] = parte[semana] || {})[equipo] = parte[semana][equipo] || [])
        .push({ n: r.full_name, p: r.position, e: r.report_status, l: r.report_primary_injury });
      if ((r.report_status !== 'Out' && r.report_status !== 'Doubtful') || NO_CUENTA.includes(r.position)) return;
      const b = bajas[a + '|' + semana + '|' + equipo] = bajas[a + '|' + semana + '|' + equipo] || [0, 0, 0];
      b[ATAQUE.includes(r.position) ? 0 : LINEA.includes(r.position) ? 1 : 2]++;
    });
  }
  filas.forEach(f => {
    const cuenta = e => (bajas[f.season + '|' + Number(f.week) + '|' + alias(e)] || [0, 0, 0]).join('|');
    f.away_epa = epa[f.game_id + '|' + alias(f.away_team)] || ''; f.home_epa = epa[f.game_id + '|' + alias(f.home_team)] || '';
    f.away_bajas = cuenta(f.away_team); f.home_bajas = cuenta(f.home_team);
  });
  const celda = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const salida = [COLUMNAS.join(',')].concat(filas.map(f => COLUMNAS.map(c => celda(f[c] === 'NA' ? '' : f[c] || '')).join(','))).join('\n') + '\n';
  const datos = path.join(__dirname, '../datos');
  fs.writeFileSync(path.join(datos, 'partidos.csv'), salida);
  // Solo las tres últimas jornadas con parte: es lo que la página puede necesitar mostrar.
  const semanas = Object.keys(parte).map(Number).sort((x, y) => y - x).slice(0, 3), reciente = {};
  semanas.forEach(s => { reciente[s] = parte[s]; });
  fs.writeFileSync(path.join(datos, 'lesiones.json'), JSON.stringify({ temporada: ultima, semanas: reciente }));
  await guardarJugadores(ultima, datos);
  const jugados = filas.filter(f => f.home_score !== '' && f.home_score !== 'NA');
  console.log(filas.length + ' partidos guardados; último jugado: ' + jugados[jugados.length - 1].game_id +
    '; con EPA: ' + filas.filter(f => f.home_epa).length + '; parte de lesiones: semanas ' + semanas.join(', '));
})().catch(e => { console.error(e); process.exit(1); });
