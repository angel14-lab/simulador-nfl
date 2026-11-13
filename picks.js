/* Picks de un partido y su calificación. Lo usan la página (window.PicksNFL) y
   herramientas/registrar-picks.js, para que lo que se congela sea lo mismo que se muestra. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./modelo.js'));
  else raiz.PicksNFL = fabrica(raiz.ModeloNFL);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  var NOMBRES = {
    ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears',
    CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
    HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs', LA: 'Los Angeles Rams', LAC: 'Los Angeles Chargers',
    LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
    NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers',
    TEN: 'Tennessee Titans', WAS: 'Washington Commanders'
  };
  var POISSON = { td: 1, tdPase: 1 };
  var MARGEN_CONGELAR = 10 * 60 * 1000; // los picks dejan de moverse 10 minutos antes del inicio

  function signo(x) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toString(); }
  function textoHandicap(equipo, h) { return equipo + ' ' + (h === 0 ? 'PK' : signo(h)); }

  // Agrupa los jugadores por equipo y anota en qué semanas jugó cada equipo.
  function indexar(jug) {
    var porEquipo = {}, semanas = {};
    if (jug) jug.jugadores.forEach(function (j) {
      (porEquipo[j.e] = porEquipo[j.e] || []).push(j);
      var s = semanas[j.e] = semanas[j.e] || {};
      j.j.forEach(function (g) { if (g[0] === jug.temporada) s[g[1]] = 1; });
    });
    return { porEquipo: porEquipo, semanas: semanas };
  }
  function parte(lesiones, p) { return lesiones && lesiones.temporada === p.temporada && lesiones.semanas ? lesiones.semanas[p.semana] || null : null; }

  /* Jugadores con proyección para un partido. ctx: {jug, porEquipo, semanas, lesiones, titular}
     Con reconstruir = true sirve para un partido ya jugado: usa solo lo ocurrido antes de esa jornada
     (sin ajuste por la defensa rival, que ya incluiría el propio partido). */
  function jugadoresDe(ctx, p, lado, reconstruir) {
    if (!ctx.jug || p.temporada !== ctx.jug.temporada || (p.jugado && !reconstruir)) return [];
    function antes(g) { return !p.jugado || g[0] < p.temporada || (g[0] === p.temporada && g[1] < p.semana); }
    var eq = lado === 'l' ? p.local : p.visita, rival = lado === 'l' ? p.visita : p.local, sem = parte(ctx.lesiones, p), estado = {};
    ((sem && sem[eq]) || []).forEach(function (x) { estado[x.n] = x.e; });
    var semanas = Object.keys(ctx.semanas[eq] || {}).map(Number).filter(function (s) { return !p.jugado || s < p.semana; }).sort(function (a, b) { return a - b; });
    var limite = semanas.length > 1 ? semanas[semanas.length - 2] : 0;
    var titular = (lado === 'l' ? p.qbLocalId : p.qbVisitaId) || (ctx.titular[eq] || {}).id;
    var lista = [];
    (ctx.porEquipo[eq] || []).forEach(function (j) {
      var previos = p.jugado ? j.j.filter(antes) : j.j, ult = previos[previos.length - 1];
      if (!ult) return;
      if (j.p === 'QB' ? j.id !== titular : (ult[0] !== ctx.jug.temporada || ult[1] < limite)) return; // suplentes y ausentes recientes
      if (estado[j.n] === 'Out' || estado[j.n] === 'Doubtful') return;
      var pr = M.proyectar({ p: j.p, j: previos }, ctx.jug.temporada, p.jugado ? null : ctx.jug, rival);
      if (pr) lista.push({ j: j, eq: eq, pr: pr, duda: estado[j.n] === 'Questionable' });
    });
    function valor(x) { return (x.pr.pase ? 1000 : 0) + (x.pr.carrera ? x.pr.carrera.m : 0) + (x.pr.recepcion ? x.pr.recepcion.m : 0); }
    return lista.sort(function (a, b) { return valor(b) - valor(a); });
  }
  function probJugador(pr, k, umbral) {
    if (pr[k] == null) return null;
    return POISSON[k] ? M.probPoisson(pr[k], umbral) : M.probAlMenos(pr[k].m, pr[k].sd, umbral);
  }
  // Línea de puntos de un equipo que suele ofrecer la casa: la que se deduce del hándicap y del total.
  function lineaEquipo(p, lado, esp) {
    var x = p.linea != null && p.lineaTotal != null ? (p.lineaTotal + (lado === 'l' ? 1 : -1) * p.linea) / 2 : (lado === 'l' ? esp.local : esp.visita);
    return Math.floor(x) + 0.5;
  }
  function masDe(sim, lado, linea) {
    var a = lado === 'l' ? sim.local : sim.visita, c = 0, i;
    for (i = 0; i < sim.n; i++) if (a[i] > linea) c++;
    return c / sim.n;
  }

  /* Picks en los mercados habituales de una casa de apuestas, de más a menos probable.
     Cada uno lleva «m», la descripción exacta del mercado, para poder calificarlo al terminar el partido. */
  function picksDe(ctx, p, sim, esp, reconstruir) {
    var lista = [];
    function poner(tipo, eq, quien, que, prob, m, extra) {
      var k = { tipo: tipo, eq: eq, quien: quien, que: que, prob: prob, m: m };
      if (extra) Object.keys(extra).forEach(function (x) { k[x] = extra[x]; });
      lista.push(k);
    }
    var ef = sim.pLocal >= sim.pVisita ? p.local : p.visita;
    poner('partido', ef, NOMBRES[ef] || ef, 'gana el partido', Math.max(sim.pLocal, sim.pVisita), { m: 'gana', eq: ef });
    if (p.linea != null) {
      var c = M.cubrir(sim, -p.linea), lc = c.local >= c.visita, eh = lc ? p.local : p.visita, h = lc ? -p.linea : p.linea;
      poner('partido', eh, textoHandicap(eh, h), 'hándicap', Math.max(c.local, c.visita) / (1 - c.nulo || 1), { m: 'handicap', eq: eh, linea: h });
    }
    if (p.lineaTotal != null) {
      var t = M.totales(sim, p.lineaTotal), mas = t.mas >= t.menos;
      poner('total', null, (mas ? 'Más de ' : 'Menos de ') + p.lineaTotal, 'puntos en el partido', Math.max(t.mas, t.menos) / (1 - t.nulo || 1), { m: 'total', mas: mas, linea: p.lineaTotal });
    }
    [['v', p.visita], ['l', p.local]].forEach(function (x) {
      var l = lineaEquipo(p, x[0], esp), q = masDe(sim, x[0], l);
      poner('total', x[1], x[1] + (q >= 0.5 ? ' más de ' : ' menos de ') + l, 'puntos del equipo', Math.max(q, 1 - q), { m: 'equipo', eq: x[1], mas: q >= 0.5, linea: l });
      jugadoresDe(ctx, p, x[0], reconstruir).forEach(function (j) {
        if (j.pr.td != null) poner('td', j.eq, j.j.n, 'anota touchdown', M.probPoisson(j.pr.td, 1), { m: 'td', id: j.j.id }, { duda: j.duda, dos: M.probPoisson(j.pr.td, 2) });
        if (j.pr.tdPase != null) {
          var dos = M.probPoisson(j.pr.tdPase, 2);
          poner('qb', j.eq, j.j.n, (dos >= 0.5 ? 'más de' : 'menos de') + ' 1.5 pases de touchdown', Math.max(dos, 1 - dos), { m: 'tdPase', id: j.j.id, mas: dos >= 0.5, linea: 1.5 }, { duda: j.duda });
        }
      });
    });
    return lista.sort(function (a, b) { return b.prob - a.prob; });
  }

  // Hora de inicio en milisegundos. La hora de los datos está en horario del Este de EE. UU.
  function inicio(p) {
    if (!p.fecha || !p.hora) return null;
    var comoUTC = Date.parse(p.fecha + 'T' + p.hora + ':00Z');
    if (isNaN(comoUTC)) return null;
    var partes = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(comoUTC)).forEach(function (x) { partes[x.type] = x.value; });
    var enNY = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute));
    return comoUTC + (comoUTC - enNY);
  }

  /* ¿Se cumplió el pick? true, false, o null si se anula (empate con la línea, o el jugador no jugó).
     estad(id) devuelve {td, tdPase} del jugador en ese partido, o null si no jugó. */
  function calificar(m, p, estad) {
    var d = p.ptsLocal - p.ptsVisita, x, e;
    if (m.m === 'gana') return d === 0 ? null : (d > 0 ? p.local : p.visita) === m.eq;
    if (m.m === 'handicap') { x = (m.eq === p.local ? d : -d) + m.linea; return x === 0 ? null : x > 0; }
    if (m.m === 'total') { x = p.ptsLocal + p.ptsVisita - m.linea; return x === 0 ? null : (x > 0) === m.mas; }
    if (m.m === 'equipo') { x = (m.eq === p.local ? p.ptsLocal : p.ptsVisita) - m.linea; return x === 0 ? null : (x > 0) === m.mas; }
    e = estad(m.id);
    if (!e) return null;
    if (m.m === 'td') return e.td >= 1;
    if (m.m === 'tdPase') return (e.tdPase > m.linea) === m.mas;
    return null;
  }

  return { NOMBRES: NOMBRES, MARGEN_CONGELAR: MARGEN_CONGELAR, indexar: indexar, parte: parte, jugadoresDe: jugadoresDe, probJugador: probJugador,
    lineaEquipo: lineaEquipo, masDe: masDe, picksDe: picksDe, inicio: inicio, calificar: calificar, textoHandicap: textoHandicap };
});
