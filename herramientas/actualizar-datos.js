// Baja los datos reales de nflverse y guarda la copia que usa el sitio:
//   datos/partidos.csv  partidos + eficiencia por jugada (EPA) + descartados por lesión de cada equipo
//   datos/lesiones.json parte de lesiones de las últimas jornadas, para mostrarlo en la página
// Uso: node actualizar-datos.js [carpeta con games.csv, st_AAAA.csv e inj_AAAA.csv ya descargados]
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
  const jugados = filas.filter(f => f.home_score !== '' && f.home_score !== 'NA');
  console.log(filas.length + ' partidos guardados; último jugado: ' + jugados[jugados.length - 1].game_id +
    '; con EPA: ' + filas.filter(f => f.home_epa).length + '; parte de lesiones: semanas ' + semanas.join(', '));
})().catch(e => { console.error(e); process.exit(1); });
