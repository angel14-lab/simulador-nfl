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
  var MINIMO = 0.65;  // por debajo, la validación muestra picks que aciertan menos de lo que anuncian
  var CUANTOS = 10;   // picks que se muestran por partido
  var MEZCLA = 0.85;  // peso de la línea del mercado al calcular los puntos esperados (validar-picks.js)
  var SEGURO = 0.70;  // probabilidad que se busca al elegir una línea alternativa
  var MAXIMO = 0.80;  // por encima de esto la cuota justa baja de 1.25 y el pick deja de interesar
  var RECIENTE = 0.70; // un hito de yardas solo se propone si el jugador lo logró en esta parte de sus últimos partidos
  // Hitos de yardas que se proponen como pick, con la columna de los partidos del jugador donde está el dato real.
  var HITOS = {
    pase: { nombre: 'yardas de pase', col: 4, escala: [150, 175, 200, 225, 250, 275, 300] },
    carrera: { nombre: 'yardas por tierra', col: 7, escala: [25, 40, 50, 60, 75, 100] },
    recepcion: { nombre: 'yardas de recepción', col: 11, escala: [25, 40, 50, 60, 75, 100] }
  };

  // Nombre de jugador sin acentos, signos ni sufijos (Jr., III), para casar fuentes distintas.
  function normalizar(n) {
    return String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/ (jr|sr|ii|iii|iv|v)$/, '').replace(/ +/g, ' ').trim();
  }
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
  /* Probabilidad de «más de» sobre la línea real de una casa. La línea principal de una casa ya recoge
     información que el modelo no tiene (rol del jugador, plan de juego, noticias), así que no se usa
     el modelo solo: se promedia con la probabilidad que implican las cuotas, quitándoles el margen. */
  function probConCasa(pr, k, real) {
    var modelo = probJugador(pr, k, Math.floor(real.l) + 1), casa = null;
    if (real.mas > 1 && real.menos > 1) casa = (1 / real.mas) / (1 / real.mas + 1 / real.menos);
    return { mas: casa == null ? modelo : (modelo + casa) / 2, modelo: modelo, casa: casa };
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

  /* Los picks de un partido: solo mercados que la validación (herramientas/validar-picks.js, 2016-2025)
     respalda cuando su probabilidad está entre 65% y 80%:
       · ganador del partido,
       · hándicap y total de puntos con línea alternativa,
       · touchdowns del partido y de cada equipo,
       · yardas de jugadores (sobre la línea real de una casa, o un hito que el jugador ya viene logrando),
       · más de 0.5 pases de touchdown del quarterback, si ya lo viene logrando.
     Se descartaron por no acertar lo que anunciaban: hándicap, total y puntos de equipo en la línea
     principal del mercado (46-52%), goles de campo (55-69%, inestable), anotador de touchdown y
     «menos de 1.5 pases de touchdown». Cada pick lleva «m», la descripción exacta del mercado, para
     poder calificarlo al terminar. */
  function picksDe(ctx, p, sim, esp, reconstruir) {
    var lista = [];
    function poner(tipo, eq, quien, que, prob, m, extra) {
      var k = { tipo: tipo, eq: eq, quien: quien, que: que, prob: prob, m: m };
      if (extra) Object.keys(extra).forEach(function (x) { k[x] = extra[x]; });
      lista.push(k);
    }
    // Ganador.
    var ef = sim.pLocal >= sim.pVisita ? p.local : p.visita;
    poner('partido', ef, NOMBRES[ef] || ef, 'gana el partido', Math.max(sim.pLocal, sim.pVisita), { m: 'gana', eq: ef });

    // Hándicap alternativo: para cada equipo, la línea más exigente que aún se cumple el 70% de las veces.
    var i, r, mejorL = null, mejorV = null, masT = null, menosT = null, hl, lt;
    var centroH = p.linea != null ? -p.linea : -Math.round(esp.local - esp.visita);
    for (i = -12; i <= 12; i++) {
      hl = Math.floor(centroH) + 0.5 + i; r = M.cubrir(sim, hl);
      if (r.local >= SEGURO && !mejorL) mejorL = { h: hl, q: r.local };
      if (r.visita >= SEGURO) mejorV = { h: -hl, q: r.visita };
    }
    [[p.local, mejorL], [p.visita, mejorV]].forEach(function (x) {
      if (x[1] && Math.abs(x[1].h) !== 0.5) // ±0.5 es lo mismo que «gana el partido»
        poner('partido', x[0], textoHandicap(x[0], x[1].h), 'hándicap', x[1].q, { m: 'handicap', eq: x[0], linea: x[1].h });
    });
    // Total de puntos alternativo, por arriba y por abajo.
    var centroT = p.lineaTotal != null ? p.lineaTotal : esp.local + esp.visita;
    for (i = -12; i <= 12; i++) {
      lt = Math.floor(centroT) + 0.5 + i; r = M.totales(sim, lt);
      if (r.mas >= SEGURO) masT = { l: lt, q: r.mas };
      if (r.menos >= SEGURO && !menosT) menosT = { l: lt, q: r.menos };
    }
    if (masT) poner('total', null, 'Más de ' + masT.l, 'puntos en el partido', masT.q, { m: 'total', mas: true, linea: masT.l });
    if (menosT) poner('total', null, 'Menos de ' + menosT.l, 'puntos en el partido', menosT.q, { m: 'total', mas: false, linea: menosT.l });

    // Touchdowns del partido y de cada equipo, con la misma regla del 70%.
    function escalera(cuenta, lineas, hacer) {
      var mas = null, menos = null;
      lineas.forEach(function (l) { var q = masQue(sim, cuenta, l); if (q >= SEGURO) mas = { l: l, q: q }; if (1 - q >= SEGURO && !menos) menos = { l: l, q: 1 - q }; });
      if (mas) hacer(true, mas);
      // Los «menos touchdowns» no se proponen: en la prueba no acertaban más que el resto y basta un
      // partido abierto para fallarlos (la mitad de los equipos anota 3 o más touchdowns).
      void menos;
    }
    escalera(CUENTAS.tds(sim), [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], function (mas, x) {
      // Los «menos touchdowns» del partido aciertan unos 2.5 puntos menos de lo que dice la simulación: se moderan.
      poner('anot', null, (mas ? 'Más de ' : 'Menos de ') + x.l, 'touchdowns en el partido', mas ? x.q : moderar(x.q), { m: 'tds', mas: mas, linea: x.l });
    });
    [['l', p.local], ['v', p.visita]].forEach(function (x) {
      escalera(x[0] === 'l' ? CUENTAS.tdsLocal(sim) : CUENTAS.tdsVisita(sim), [1.5, 2.5, 3.5], function (mas, y) {
        poner('anot', x[1], x[1] + (mas ? ' más de ' : ' menos de ') + y.l, 'touchdowns del equipo', y.q, { m: 'tdsEquipo', eq: x[1], mas: mas, linea: y.l });
      });
    });

    // Jugadores.
    var hayReales = !!(ctx.lineas && ctx.lineas[p.id] && ctx.lineas[p.id].jug && Object.keys(ctx.lineas[p.id].jug).length);
    var casa = hayReales ? ctx.lineas[p.id].casaJugadores || 'la casa' : '';
    [['v', p.visita], ['l', p.local]].forEach(function (x) {
      jugadoresDe(ctx, p, x[0], reconstruir).forEach(function (j) {
        var reales = hayReales ? ctx.lineas[p.id].jug[normalizar(j.j.n)] : null;
        Object.keys(HITOS).forEach(function (k) {
          if (!j.pr[k]) return;
          var hito = null, logrados;
          if (reales && reales[k]) {
            // Línea real de una casa: el pick se hace sobre ella, promediando el modelo con lo que dicen sus cuotas.
            var real = reales[k], mas = probConCasa(j.pr, k, real).mas, arriba = mas >= 0.5;
            logrados = j.previos.filter(function (g) { return arriba ? g[HITOS[k].col] > real.l : g[HITOS[k].col] < real.l; }).length;
            poner('jug', j.eq, j.j.n, (arriba ? 'más de ' : 'menos de ') + real.l + ' ' + HITOS[k].nombre, Math.max(mas, 1 - mas), { m: 'yardas', id: j.j.id, est: k, linea: real.l, mas: arriba },
              { duda: j.duda, cuotaReal: arriba ? real.mas : real.menos, resp: 'línea de ' + casa + ' · lo logró en ' + logrados + ' de ' + j.previos.length });
            return;
          }
          if (hayReales) return; // la casa ya publicó líneas de este partido y no ofrece esta: no se inventa un hito
          // Hito más exigente al 70% que además el jugador logró en al menos el 70% de sus últimos partidos
          // (validado 2023-2026: 78% pase, 75% tierra, 75% recepción).
          HITOS[k].escala.forEach(function (u) { var q = M.probAlMenos(j.pr[k].m, j.pr[k].sd, u); if (q >= SEGURO) hito = { u: u, q: q }; });
          if (!hito) return;
          logrados = j.previos.filter(function (g) { return g[HITOS[k].col] >= hito.u; }).length;
          if (logrados / j.previos.length < RECIENTE) return;
          poner('jug', j.eq, j.j.n, hito.u + '+ ' + HITOS[k].nombre, hito.q, { m: 'yardas', id: j.j.id, est: k, linea: hito.u },
            { duda: j.duda, resp: 'lo logró en ' + logrados + ' de ' + j.previos.length });
        });
        // Más de 0.5 pases de touchdown: aciertan unos 2.5 puntos menos de lo que dice el modelo, se moderan.
        var uno = j.pr.tdPase != null ? moderar(probJugador(j.pr, 'tdPase', 1)) : 0, conTd = j.previos.filter(function (g) { return g[5] >= 1; }).length;
        if (uno >= MINIMO && conTd / j.previos.length >= RECIENTE) poner('jug', j.eq, j.j.n, 'más de 0.5 pases de touchdown', uno, { m: 'tdPase', id: j.j.id, mas: true, linea: 0.5 },
          { duda: j.duda, resp: 'lo logró en ' + conTd + ' de ' + j.previos.length });
      });
    });
    return lista.sort(function (a, b) { return b.prob - a.prob; });
  }
  // Acerca una probabilidad al 50% un 10%: 76% pasa a 73%.
  function moderar(q) { return 0.5 + (q - 0.5) * 0.9; }

  /* ¿Es un pick de los que se muestran? Sirve también para pronósticos guardados con reglas anteriores
     (que incluían mercados hoy descartados). Acepta picks de la página {tipo, que, prob, m}. */
  function apto(k) {
    var m = k.m || {};
    if (k.tipo === 'td' || m.m === 'td' || m.m === 'fg' || m.m === 'equipo') return false;
    if (m.m === 'tdPase' && m.mas === false) return false;
    if ((m.m === 'tds' || m.m === 'tdsEquipo') && m.mas === false) return false; // «menos touchdowns»: retirado
    if (k.principal) return false; // hándicap o total en la línea principal del mercado (pronósticos antiguos)
    return k.prob >= MINIMO && k.prob <= MAXIMO;
  }
  // Los mejores picks de un partido: aptos, del más al menos probable, como máximo «n».
  function mejores(lista, n) {
    return lista.filter(apto).sort(function (a, b) { return b.prob - a.prob; }).slice(0, n || CUANTOS);
  }

  /* Línea del mercado de un partido: la de una casa bajada con The Odds API si la hay (más reciente),
     si no la de nflverse. Devuelve una copia del partido con esas líneas. */
  function conLineas(p, reales) {
    var r = reales && reales[p.id], q = Object.assign({}, p);
    if (r && r.h != null) q.linea = -r.h;      // la casa da el hándicap del local (negativo = favorito)
    if (r && r.t != null) q.lineaTotal = r.t;
    return q;
  }

  /* Puntos esperados de cada equipo mezclando el modelo con la línea del mercado (hándicap a favor
     del local y total). peso = parte que se le da al mercado; ver herramientas/validar-picks.js. */
  function mezclar(pred, linea, total, peso) {
    if (linea == null || total == null) return { local: Math.max(3, pred.local), visita: Math.max(3, pred.visita) };
    var l = (1 - peso) * pred.local + peso * (total + linea) / 2, v = (1 - peso) * pred.visita + peso * (total - linea) / 2;
    return { local: Math.max(3, l), visita: Math.max(3, v) };
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

  /* ¿Se cumplió el pick? true, false, null si se anula (empate con la línea, o el jugador no jugó),
     o undefined si todavía faltan datos para saberlo. estad(id) devuelve las estadísticas del jugador
     en ese partido, null si no jugó, o undefined si aún no están publicadas. */
  function calificar(m, p, estad) {
    var d = p.ptsLocal - p.ptsVisita, x, e;
    if (m.m === 'gana') return d === 0 ? null : (d > 0 ? p.local : p.visita) === m.eq;
    if (m.m === 'handicap') { x = (m.eq === p.local ? d : -d) + m.linea; return x === 0 ? null : x > 0; }
    if (m.m === 'total') { x = p.ptsLocal + p.ptsVisita - m.linea; return x === 0 ? null : (x > 0) === m.mas; }
    if (m.m === 'equipo') { x = (m.eq === p.local ? p.ptsLocal : p.ptsVisita) - m.linea; return x === 0 ? null : (x > 0) === m.mas; }
    if (m.m === 'tds') return p.tdLocal == null || p.tdVisita == null ? undefined : (p.tdLocal + p.tdVisita > m.linea) === m.mas;
    if (m.m === 'tdsEquipo') { x = m.eq === p.local ? p.tdLocal : p.tdVisita; return x == null ? undefined : (x > m.linea) === m.mas; }
    if (m.m === 'fg') return p.golesCampo == null ? undefined : (p.golesCampo > m.linea) === m.mas;
    e = estad(m.id);
    if (e === undefined) return undefined; // estadísticas de jugadores todavía sin publicar
    if (!e) return null;                   // publicadas, pero el jugador no jugó: se anula
    if (m.m === 'td') return e.td >= 1;
    if (m.m === 'yardas') return m.mas === false ? e[m.est] < m.linea : e[m.est] >= m.linea;
    if (m.m === 'tdPase') return (e.tdPase > m.linea) === m.mas;
    return null;
  }

  return { NOMBRES: NOMBRES, MARGEN_CONGELAR: MARGEN_CONGELAR, MINIMO: MINIMO, SEGURO: SEGURO, MAXIMO: MAXIMO, CUANTOS: CUANTOS, MEZCLA: MEZCLA, apto: apto, mejores: mejores, conLineas: conLineas, normalizar: normalizar, indexar: indexar, parte: parte, jugadoresDe: jugadoresDe, probJugador: probJugador,
    lineaEquipo: lineaEquipo, masDe: masDe, masQue: masQue, CUENTAS: CUENTAS, lineaJusta: lineaJusta, mezclar: mezclar, probConCasa: probConCasa, picksDe: picksDe, inicio: inicio, calificar: calificar, textoHandicap: textoHandicap };
});
