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
  var MINIMO = 0.58;  // por debajo de esto un pick es casi una moneda al aire y no se muestra como pick
  var SEGURO = 0.70;  // probabilidad que se busca al elegir una línea alternativa
  var MAXIMO = 0.80;  // por encima de esto la cuota justa baja de 1.25 y el pick deja de interesar
  var RECIENTE = 0.70; // un hito de yardas solo se propone si el jugador lo logró en esta parte de sus últimos partidos
  // Hitos de yardas que se proponen como pick, con la columna de los partidos del jugador donde está el dato real.
  var HITOS = {
    pase: { nombre: 'yardas de pase', col: 4, escala: [150, 175, 200, 225, 250, 275, 300] },
    carrera: { nombre: 'yardas por tierra', col: 7, escala: [25, 40, 50, 60, 75, 100] },
    recepcion: { nombre: 'yardas de recepción', col: 11, escala: [25, 40, 50, 60, 75, 100] }
  };

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
      if (pr) lista.push({ j: j, eq: eq, pr: pr, previos: previos.slice(-10), duda: estado[j.n] === 'Questionable' });
    });
    function valor(x) { return (x.pr.pase ? 1000 : 0) + (x.pr.carrera ? x.pr.carrera.m : 0) + (x.pr.recepcion ? x.pr.recepcion.m : 0); }
    return lista.sort(function (a, b) { return valor(b) - valor(a); });
  }
  function probJugador(pr, k, umbral) {
    if (pr[k] == null) return null;
    if (k === 'td' && umbral === 1) { // por encima del 45% el modelo exagera: los que «casi seguro anotan» anotan la mitad de las veces
      var q = M.probPoisson(pr[k], 1);
      return q > 0.45 ? 0.45 + (q - 0.45) * 0.7 : q;
    }
    if (k === 'tdPase' && umbral >= 3) return M.probPoisson(pr[k], umbral) * M.JUG.tercerTdPase; // tres o más pases de TD salen menos de lo que dice Poisson
    return POISSON[k] ? M.probPoisson(pr[k], umbral) : M.probAlMenos(pr[k].m, pr[k].sd, umbral);
  }
  // Línea a la que más y menos quedan cerca del 50%: la que debería ofrecer una casa para ese jugador.
  function lineaJusta(e) {
    var a = 0, b = e.m * 4 + 10, i, x;
    for (i = 0; i < 40; i++) { x = (a + b) / 2; if (M.probAlMenos(e.m, e.sd, x) > 0.5) a = x; else b = x; }
    return Math.max(0.5, Math.round(a) - 0.5);
  }
  // Fracción de simulaciones en las que una cuenta (touchdowns, goles de campo) supera la línea.
  function masQue(sim, valor, linea) {
    var c = 0, i;
    for (i = 0; i < sim.n; i++) if (valor(i) > linea) c++;
    return c / sim.n;
  }
  var CUENTAS = {
    tds: function (sim) { return function (i) { return sim.tdLocal[i] + sim.tdVisita[i]; }; },
    tdsLocal: function (sim) { return function (i) { return sim.tdLocal[i]; }; },
    tdsVisita: function (sim) { return function (i) { return sim.tdVisita[i]; }; },
    fg: function (sim) { return function (i) { return sim.golesCampo[i]; }; }
  };
  // De una lista de líneas, la más pareja (la principal de la casa) con su probabilidad de «más de».
  function lineaPrincipal(sim, cuenta, lineas) {
    var mejor = null;
    lineas.forEach(function (l) { var q = masQue(sim, cuenta, l); if (!mejor || Math.abs(q - 0.5) < Math.abs(mejor.q - 0.5)) mejor = { l: l, q: q }; });
    return mejor;
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
    var lt = lineaPrincipal(sim, CUENTAS.tds(sim), [3.5, 4.5, 5.5, 6.5, 7.5]), lg = lineaPrincipal(sim, CUENTAS.fg(sim), [2.5, 3.5, 4.5]);
    poner('anot', null, (lt.q >= 0.5 ? 'Más de ' : 'Menos de ') + lt.l, 'touchdowns en el partido', Math.max(lt.q, 1 - lt.q), { m: 'tds', mas: lt.q >= 0.5, linea: lt.l });
    poner('anot', null, (lg.q >= 0.5 ? 'Más de ' : 'Menos de ') + lg.l, 'goles de campo en el partido', Math.max(lg.q, 1 - lg.q), { m: 'fg', mas: lg.q >= 0.5, linea: lg.l });
    [['v', p.visita], ['l', p.local]].forEach(function (x) {
      var le = lineaPrincipal(sim, x[0] === 'l' ? CUENTAS.tdsLocal(sim) : CUENTAS.tdsVisita(sim), [1.5, 2.5, 3.5]);
      poner('anot', x[1], x[1] + (le.q >= 0.5 ? ' más de ' : ' menos de ') + le.l, 'touchdowns del equipo', Math.max(le.q, 1 - le.q), { m: 'tdsEquipo', eq: x[1], mas: le.q >= 0.5, linea: le.l });
      var l = lineaEquipo(p, x[0], esp), q = masDe(sim, x[0], l);
      poner('total', x[1], x[1] + (q >= 0.5 ? ' más de ' : ' menos de ') + l, 'puntos del equipo', Math.max(q, 1 - q), { m: 'equipo', eq: x[1], mas: q >= 0.5, linea: l });
      jugadoresDe(ctx, p, x[0], reconstruir).forEach(function (j) {
        if (j.pr.td != null) poner('td', j.eq, j.j.n, 'anota touchdown', probJugador(j.pr, 'td', 1), { m: 'td', id: j.j.id }, { duda: j.duda, dos: probJugador(j.pr, 'td', 2) });
        /* Yardas: el hito más exigente que el modelo da al 70% o más, y solo si el jugador ya lo viene
           logrando en la mayoría de sus últimos partidos. En la validación (2023-2026) estos picks
           acertaron 78% en pase, 75% por tierra y 75% en recepción. */
        Object.keys(HITOS).forEach(function (k) {
          if (!j.pr[k]) return;
          var hito = null, logrados;
          HITOS[k].escala.forEach(function (u) { var q = M.probAlMenos(j.pr[k].m, j.pr[k].sd, u); if (q >= SEGURO) hito = { u: u, q: q }; });
          if (!hito) return;
          logrados = j.previos.filter(function (g) { return g[HITOS[k].col] >= hito.u; }).length;
          if (logrados / j.previos.length < RECIENTE) return;
          poner('jug', j.eq, j.j.n, hito.u + '+ ' + HITOS[k].nombre, hito.q, { m: 'yardas', id: j.j.id, est: k, linea: hito.u },
            { duda: j.duda, resp: 'lo logró en ' + logrados + ' de sus últimos ' + j.previos.length });
        });
      });
    });
    /* Picks «seguros»: en los mercados con líneas alternativas se busca la línea más exigente que
       todavía se cumple al menos el 70% de las veces. */
    var i, r, mejorL = null, mejorV = null, masT = null, menosT = null, centroH = p.linea != null ? -p.linea : -Math.round(esp.local - esp.visita), hl, lt2;
    for (i = -10; i <= 10; i++) {
      hl = Math.floor(centroH) + 0.5 + i; r = M.cubrir(sim, hl);
      if (r.local >= SEGURO && !mejorL) mejorL = { h: hl, q: r.local };            // el primero es el más exigente para el local
      if (r.visita >= SEGURO) mejorV = { h: -hl, q: r.visita };                     // el último es el más exigente para la visita
    }
    function alterno(eq, x) {
      if (x && Math.abs(x.h) !== 0.5 && !(p.linea != null && lista.some(function (k) { return k.m.m === 'handicap' && k.m.eq === eq && k.m.linea === x.h; })))
        poner('partido', eq, textoHandicap(eq, x.h), 'hándicap alternativo', x.q, { m: 'handicap', eq: eq, linea: x.h });
    }
    alterno(p.local, mejorL); alterno(p.visita, mejorV);
    var centroT = p.lineaTotal != null ? p.lineaTotal : esp.local + esp.visita;
    for (i = -10; i <= 10; i++) {
      lt2 = Math.floor(centroT) + 0.5 + i; r = M.totales(sim, lt2);
      if (r.mas >= SEGURO) masT = { l: lt2, q: r.mas };
      if (r.menos >= SEGURO && !menosT) menosT = { l: lt2, q: r.menos };
    }
    if (masT && masT.l !== p.lineaTotal) poner('total', null, 'Más de ' + masT.l, 'puntos en el partido (línea alternativa)', masT.q, { m: 'total', mas: true, linea: masT.l });
    if (menosT && menosT.l !== p.lineaTotal) poner('total', null, 'Menos de ' + menosT.l, 'puntos en el partido (línea alternativa)', menosT.q, { m: 'total', mas: false, linea: menosT.l });
    function escalera(cuenta, lineas, hacer) {
      var mas = null, menos = null;
      lineas.forEach(function (l) { var q = masQue(sim, cuenta, l); if (q >= SEGURO) mas = { l: l, q: q }; if (1 - q >= SEGURO && !menos) menos = { l: l, q: 1 - q }; });
      if (mas) hacer(true, mas); if (menos) hacer(false, menos);
    }
    function yaEsta(m) { return lista.some(function (k) { return k.m.m === m.m && k.m.eq === m.eq && k.m.linea === m.linea && k.m.mas === m.mas; }); }
    escalera(CUENTAS.tds(sim), [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], function (mas, x) {
      var m = { m: 'tds', mas: mas, linea: x.l };
      if (!yaEsta(m)) poner('anot', null, (mas ? 'Más de ' : 'Menos de ') + x.l, 'touchdowns en el partido', x.q, m);
    });
    [['l', p.local], ['v', p.visita]].forEach(function (x) {
      escalera(x[0] === 'l' ? CUENTAS.tdsLocal(sim) : CUENTAS.tdsVisita(sim), [1.5, 2.5, 3.5], function (mas, y) {
        var m = { m: 'tdsEquipo', eq: x[1], mas: mas, linea: y.l };
        if (!yaEsta(m)) poner('anot', x[1], x[1] + (mas ? ' más de ' : ' menos de ') + y.l, 'touchdowns del equipo', y.q, m);
      });
      jugadoresDe(ctx, p, x[0], reconstruir).forEach(function (j) {
        var uno = j.pr.tdPase != null ? probJugador(j.pr, 'tdPase', 1) : 0, conTd = j.previos.filter(function (g) { return g[5] >= 1; }).length;
        if (uno >= SEGURO && conTd / j.previos.length >= RECIENTE) poner('jug', j.eq, j.j.n, 'más de 0.5 pases de touchdown', uno, { m: 'tdPase', id: j.j.id, mas: true, linea: 0.5 },
          { duda: j.duda, resp: 'lo logró en ' + conTd + ' de sus últimos ' + j.previos.length });
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
    if (m.m === 'tds') return p.tdLocal == null || p.tdVisita == null ? null : (p.tdLocal + p.tdVisita > m.linea) === m.mas;
    if (m.m === 'tdsEquipo') { x = m.eq === p.local ? p.tdLocal : p.tdVisita; return x == null ? null : (x > m.linea) === m.mas; }
    if (m.m === 'fg') return p.golesCampo == null ? null : (p.golesCampo > m.linea) === m.mas;
    e = estad(m.id);
    if (!e) return null;
    if (m.m === 'td') return e.td >= 1;
    if (m.m === 'yardas') return e[m.est] >= m.linea;
    if (m.m === 'tdPase') return (e.tdPase > m.linea) === m.mas;
    return null;
  }

  return { NOMBRES: NOMBRES, MARGEN_CONGELAR: MARGEN_CONGELAR, MINIMO: MINIMO, SEGURO: SEGURO, MAXIMO: MAXIMO, indexar: indexar, parte: parte, jugadoresDe: jugadoresDe, probJugador: probJugador,
    lineaEquipo: lineaEquipo, masDe: masDe, masQue: masQue, CUENTAS: CUENTAS, lineaJusta: lineaJusta, picksDe: picksDe, inicio: inicio, calificar: calificar, textoHandicap: textoHandicap };
});
