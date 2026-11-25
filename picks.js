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
  // Peso de la línea del mercado en los puntos esperados. Elegido solo con 2016-2022 (ajustar-fuera-de-muestra.js):
  // la línea sola (1.0) fue la mejor en esos años y también en 2023-2025, que no se usaron para elegir.
  // El modelo propio sigue calculándose y se usa cuando no hay línea del mercado.
  var MEZCLA = 1;
  var SEGURO = 0.70;  // probabilidad que se busca al elegir una línea alternativa
  var CALIBRA_JUGADOR = 0.75; // ajustado solo con 2020-2022; en 2023-2025 los de 65%+ acertaron 68.8% anunciando 68.8% (línea estimada)
  var CUOTA_MINIMA = 1.25; // con cuota real de la casa, no se propone nada que pague menos
  var MAXIMO = 0.80;  // por encima de esto la cuota justa baja de 1.25 y el pick deja de interesar
  var RECIENTE = 0.70; // un hito de yardas solo se propone si el jugador lo logró en esta parte de sus últimos partidos
  // Hitos de yardas que se proponen como pick, con la columna de los partidos del jugador donde está el dato real.
  var HITOS = {
    pase: { nombre: 'yardas de pase', col: 4, escala: [150, 175, 200, 225, 250, 275, 300], uso: 3, usoMin: 25, usoTexto: function (u) { return Math.round(u) + ' pases por partido'; } },
    carrera: { nombre: 'yardas por tierra', col: 7, escala: [25, 40, 50, 60, 75, 100], uso: 6, usoMin: 10, usoTexto: function (u) { return Math.round(u) + ' acarreos por partido'; } },
    recepcion: { nombre: 'yardas de recepción', col: 11, escala: [25, 40, 50, 60, 75, 100], uso: 9, usoMin: 4, usoTexto: function (u) { return u.toFixed(1) + ' objetivos por partido'; } }
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
    var entreno = {};
    ((sem && sem[eq]) || []).forEach(function (x) { estado[x.n] = x.e; if (x.pr) entreno[x.n] = x.pr + (x.d ? 'd' : ''); });
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
      if (pr) lista.push({ j: j, eq: eq, pr: pr, previos: previos.slice(-10), duda: estado[j.n] === 'Questionable', entreno: entreno[j.n] || '' });
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
    // Modelo calibrado (como con la línea estimada) y probabilidad de la casa sin su margen.
    var modelo = 0.5 + (M.probAlMenos(pr[k].m, pr[k].sd, Math.floor(real.l) + 1) - 0.5) * CALIBRA_JUGADOR, casa = null;
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
    /* Si ya se bajaron las líneas reales de la casa (el día del partido), los picks se eligen solo entre
       las líneas que la casa ofrece y con su cuota: de cada mercado, la línea más probable que todavía
       paga al menos 1.25. Si aún no se bajaron, se estiman con líneas de medio punto y se marcan así. */
    // Solo cuentan como líneas de la casa si de verdad se bajaron (la ficha puede existir vacía).
    var R = ctx.lineas && ctx.lineas[p.id] && ctx.lineas[p.id].partido && ctx.lineas[p.id].hs && Object.keys(ctx.lineas[p.id].hs).length ? ctx.lineas[p.id] : null;
    function mejorReal(candidatos) { // [{linea, prob, cuota}] → la más probable que paga lo mínimo
      var ok = candidatos.filter(function (c) { return c.cuota >= CUOTA_MINIMA && c.prob >= MINIMO; });
      return ok.sort(function (a, b) { return b.prob - a.prob; })[0] || null;
    }
    var real = R ? { estimada: false, casa: R.casaLineas || R.casa } : { estimada: true };

    // Ganador.
    var ef = sim.pLocal >= sim.pVisita ? p.local : p.visita, pg = Math.max(sim.pLocal, sim.pVisita);
    poner('partido', ef, NOMBRES[ef] || ef, 'gana el partido', pg, { m: 'gana', eq: ef }, R && R.ml[ef] ? { cuotaReal: R.ml[ef] } : null);

    var i, r, hl;
    if (R) {
      // Hándicap: las líneas alternativas que ofrece la casa para cada equipo.
      [p.local, p.visita].forEach(function (eq) {
        var lineas = R.hs[eq] || {}, cands = Object.keys(lineas).map(function (l) {
          var h = Number(l), c = M.cubrir(sim, eq === p.local ? h : -h), q = (eq === p.local ? c.local : c.visita) / (1 - c.nulo || 1);
          return { linea: h, prob: q, cuota: lineas[l] };
        }).filter(function (c) { return Math.abs(c.linea) !== 0.5; });
        var b = mejorReal(cands);
        if (b) poner('partido', eq, textoHandicap(eq, b.linea), 'hándicap', b.prob, { m: 'handicap', eq: eq, linea: b.linea }, { cuotaReal: b.cuota, linea: real });
      });
      // Total de puntos: solo «más de», entre las líneas alternativas de la casa.
      var bt = mejorReal(Object.keys(R.ts.mas || {}).map(function (l) {
        var t = M.totales(sim, Number(l)); return { linea: Number(l), prob: t.mas / (1 - t.nulo || 1), cuota: R.ts.mas[l] };
      }));
      if (bt) poner('total', null, 'Más de ' + bt.linea, 'puntos en el partido', bt.prob, { m: 'total', mas: true, linea: bt.linea }, { cuotaReal: bt.cuota, linea: real });
    } else {
      // Sin líneas de la casa todavía: la línea de medio punto más exigente que se cumple el 70% de las veces.
      var mejorL = null, mejorV = null, masT = null, lt, centroH = p.linea != null ? -p.linea : -Math.round(esp.local - esp.visita);
      for (i = -12; i <= 12; i++) {
        hl = Math.floor(centroH) + 0.5 + i; r = M.cubrir(sim, hl);
        if (r.local >= SEGURO && !mejorL) mejorL = { h: hl, q: r.local };
        if (r.visita >= SEGURO) mejorV = { h: -hl, q: r.visita };
      }
      [[p.local, mejorL], [p.visita, mejorV]].forEach(function (x) {
        if (x[1] && Math.abs(x[1].h) !== 0.5) poner('partido', x[0], textoHandicap(x[0], x[1].h), 'hándicap', x[1].q, { m: 'handicap', eq: x[0], linea: x[1].h }, { linea: real });
      });
      var centroT = p.lineaTotal != null ? p.lineaTotal : esp.local + esp.visita;
      for (i = -12; i <= 12; i++) { lt = Math.floor(centroT) + 0.5 + i; r = M.totales(sim, lt); if (r.mas >= SEGURO) masT = { l: lt, q: r.mas }; }
      if (masT) poner('total', null, 'Más de ' + masT.l, 'puntos en el partido', masT.q, { m: 'total', mas: true, linea: masT.l }, { linea: real });
    }
    /* Ya no se proponen: touchdowns del partido y de un equipo (las casas solo ofrecen la línea principal,
       donde la probabilidad ronda el 50%), ningún «menos» y los hitos propios de yardas («25+»), que las
       casas no suelen ofrecer. */

    // Jugadores: solo sobre la línea real de la casa, promediando el modelo con lo que dicen sus cuotas.
    /* Yardas de jugadores. Se proponen desde que el partido entra en la semana, con la información de ese
       momento, y se revisan cada 20 minutos hasta quedar fijos 10 minutos antes del inicio:
       · Línea: hasta que se bajan las líneas reales de la casa (24 horas antes) se usa una línea estimada,
         la mediana de sus últimos 10 partidos, que es como suelen fijarla las casas; después, la real, y
         si la casa no ofrece al jugador, su pick se cae.
       · Disponibilidad, según el último parte (2023-2025, jugadores con rol): sin estado y entrenando
         jugó el 93%; en duda, 47-81%; sin estado pero sin entrenar por lesión, 33%; dudoso o fuera, 0-8%.
         Por eso no reciben pick los que están en duda, dudosos, fuera o sin entrenar por lesión.
       · Rol fijo: 3 de los 4 últimos partidos del equipo y 25 pases, 10 acarreos o 4 objetivos por partido.
       · Probabilidad: el modelo calibrado (factor CALIBRA_JUGADOR, elegido con 2020-2022; en 2023-2025 los de
         65% o más acertaron 68.8% anunciando 68.8%). Esa calibración se validó contra una
         línea ESTIMADA (la mediana de sus últimos 10 partidos), no contra la de la casa. Con la línea real de
         la casa el modelo resultó sobreconfiado: 87 picks congelados de las semanas 10-11 anunciaban 56% y
         acertaron 42.5%, menos que lo que implicaba la casa (~51%). Por eso, con línea real, la probabilidad
         es el promedio del modelo calibrado y la de la casa sin margen; si no llega al mínimo, no hay pick. */
    var R2 = ctx.lineas && ctx.lineas[p.id], conLineas = !!(R2 && R2.confirmado && R2.jug);
    if (!p.jugado || reconstruir) {
      var hora = conLineas ? new Date(R2.confirmado) : null, antes = hora ? Math.round(((inicio(p) || hora) - hora) / 60000) : 0;
      var ENTRENO = { FP: 'entrenó completo', LP: 'entrenó limitado', NPd: 'descansó en el entrenamiento', FPd: 'entrenó completo', LPd: 'entrenó limitado' };
      [['v', p.visita], ['l', p.local]].forEach(function (x) {
        var semanasEq = Object.keys(ctx.semanas[x[1]] || {}).map(Number).filter(function (s) { return s < p.semana; }).sort(function (a, b) { return b - a; }).slice(0, 4);
        jugadoresDe(ctx, p, x[0], reconstruir).forEach(function (j) {
          if (j.duda || j.entreno === 'NP') return; // en duda o sin entrenar por lesión: puede no jugar
          var reales = conLineas ? R2.jug[normalizar(j.j.n)] : null;
          if (conLineas && !reales) return; // la casa no lo ofrece: no se apuesta por él
          var temp = j.j.j.filter(function (g) { return g[0] === p.temporada && g[1] < p.semana; });
          var jugo = semanasEq.filter(function (s) { return temp.some(function (g) { return g[1] === s; }); }).length;
          if (temp.length < 3 || jugo < 3) return;
          Object.keys(HITOS).forEach(function (k) {
            if (!j.pr[k] || (conLineas && !reales[k])) return;
            var uso = temp.reduce(function (a, g) { return a + g[HITOS[k].uso]; }, 0) / temp.length;
            if (uso < HITOS[k].usoMin) return;
            var linea, cuotas = null;
            if (conLineas) { linea = reales[k].l; cuotas = reales[k]; }
            else { var ys = j.previos.map(function (g) { return g[HITOS[k].col]; }).sort(function (a, b) { return a - b; }); linea = Math.floor(ys[Math.floor(ys.length / 2)]) + 0.5; }
            // Con línea real: promedio del modelo calibrado y la casa sin margen. Sin ella: solo el modelo calibrado.
            var q = conLineas ? probConCasa(j.pr, k, cuotas).mas : 0.5 + (M.probAlMenos(j.pr[k].m, j.pr[k].sd, Math.floor(linea) + 1) - 0.5) * CALIBRA_JUGADOR, arriba = q >= 0.5;
            var logrados = j.previos.filter(function (g) { return arriba ? g[HITOS[k].col] > linea : g[HITOS[k].col] < linea; }).length;
            var dispo = j.entreno ? ENTRENO[j.entreno] || 'sin restricciones en el parte' : 'no figura en el parte de lesiones';
            poner('jug', j.eq, j.j.n, (arriba ? 'más de ' : 'menos de ') + linea + ' ' + HITOS[k].nombre, Math.max(q, 1 - q), { m: 'yardas', id: j.j.id, est: k, linea: linea, mas: arriba },
              { cuotaReal: cuotas ? (arriba ? cuotas.mas : cuotas.menos) : null, linea: { estimada: !conLineas },
                resp: (conLineas ? 'línea de la casa, bajada ' + (antes >= 120 ? Math.round(antes / 60) + ' h' : antes + ' min') + ' antes del inicio' : 'línea estimada (mediana de sus últimos ' + j.previos.length + ')') +
                  ' · ' + dispo + ' · ' + HITOS[k].usoTexto(uso) + ' · jugó ' + jugo + ' de los 4 últimos · lo logró en ' + logrados + ' de sus últimos ' + j.previos.length });
          });
        });
      });
    }
    return lista.sort(function (a, b) { return b.prob - a.prob; });
  }
  /* Picks arriesgados: más probables que no (55% a 65%) pero con mejor cuota (1.55 o más).
     En la prueba de 2016-2025 (8 250 picks, ver herramientas/validar-riesgo.js) acertaron 58.2% anunciando
     57.2%, con cuota justa media de 1.75; ninguna temporada bajó del 54.6%. Con líneas reales de la casa
     se elige, en cada mercado, la línea que más devuelve (probabilidad × cuota); sin ellas, la línea más
     exigente que todavía se cumple el 55% de las veces. «principales» = la lista de picks de picksDe,
     de donde salen también los de jugadores confirmados. */
  var RIESGO_MIN = 0.55, RIESGO_MAX = 0.65, RIESGO_CUOTA = 1.55, RIESGO_CUANTOS = 3;
  function arriesgados(ctx, p, sim, esp, principales) {
    var R = ctx.lineas && ctx.lineas[p.id] && ctx.lineas[p.id].partido && ctx.lineas[p.id].hs && Object.keys(ctx.lineas[p.id].hs).length ? ctx.lineas[p.id] : null;
    var c = [], enRango = function (q) { return q >= RIESGO_MIN && q < RIESGO_MAX; };
    function elegir(cands) { // con cuota real: la que más devuelve; sin ella: la más exigente
      var ok = cands.filter(function (x) { return enRango(x.prob) && (!x.cuota || x.cuota >= RIESGO_CUOTA); });
      ok.sort(function (a, b) { return a.cuota && b.cuota ? b.prob * b.cuota - a.prob * a.cuota : a.prob - b.prob; });
      return ok[0] || null;
    }
    var ef = sim.pLocal >= sim.pVisita ? p.local : p.visita, pg = Math.max(sim.pLocal, sim.pVisita), cg = R && R.ml[ef];
    if (enRango(pg) && (!cg || cg >= RIESGO_CUOTA)) c.push({ tipo: 'partido', eq: ef, quien: NOMBRES[ef] || ef, que: 'gana el partido', prob: pg, m: { m: 'gana', eq: ef }, cuotaReal: cg || null });
    [p.local, p.visita].forEach(function (eq) {
      var lineas = R ? Object.keys(R.hs[eq] || {}).map(Number) : [], cands = [], h;
      if (!R) for (h = -20.5; h <= 20.5; h += 1) lineas.push(h);
      lineas.forEach(function (h) {
        if (Math.abs(h) === 0.5) return;
        var x = M.cubrir(sim, eq === p.local ? h : -h);
        cands.push({ linea: h, prob: (eq === p.local ? x.local : x.visita) / (1 - x.nulo || 1), cuota: R ? R.hs[eq][h] : null });
      });
      var b = elegir(cands);
      if (b) c.push({ tipo: 'partido', eq: eq, quien: textoHandicap(eq, b.linea), que: 'hándicap', prob: b.prob, m: { m: 'handicap', eq: eq, linea: b.linea }, cuotaReal: b.cuota, linea: { estimada: !R } });
    });
    var lt = R ? Object.keys(R.ts.mas || {}).map(Number) : [], ct = [], l;
    if (!R) for (l = 25.5; l <= 65.5; l += 1) lt.push(l);
    lt.forEach(function (l) { var t = M.totales(sim, l); ct.push({ linea: l, prob: t.mas / (1 - t.nulo || 1), cuota: R ? R.ts.mas[l] : null }); });
    var bt = elegir(ct);
    if (bt) c.push({ tipo: 'total', eq: null, quien: 'Más de ' + bt.linea, que: 'puntos en el partido', prob: bt.prob, m: { m: 'total', mas: true, linea: bt.linea }, cuotaReal: bt.cuota, linea: { estimada: !R } });
    (principales || []).forEach(function (k) { if (k.tipo === 'jug' && enRango(k.prob) && (!k.cuotaReal || k.cuotaReal >= RIESGO_CUOTA)) c.push(k); });
    c.sort(function (a, b) { return a.cuotaReal && b.cuotaReal ? b.prob * b.cuotaReal - a.prob * a.cuotaReal : b.prob - a.prob; });
    // Como mucho 2 de jugadores: así queda al menos uno del partido, menos ligado a los demás.
    var jug = 0;
    return c.filter(function (k) { return k.tipo !== 'jug' || ++jug <= 2; }).slice(0, RIESGO_CUANTOS);
  }

  // Acerca una probabilidad al 50% un 10%: 76% pasa a 73%.
  function moderar(q) { return 0.5 + (q - 0.5) * 0.9; }

  /* ¿Es un pick de los que se muestran? Sirve también para pronósticos guardados con reglas anteriores
     (que incluían mercados hoy descartados). Acepta picks de la página {tipo, que, prob, m}. */
  function apto(k) {
    var m = k.m || {};
    if (k.tipo === 'td' || m.m === 'td' || m.m === 'fg' || m.m === 'equipo') return false;
    if (m.m === 'tdPase' && m.mas === false) return false;
    if ((m.m === 'tds' || m.m === 'tdsEquipo' || m.m === 'total') && m.mas === false) return false; // «menos»: retirados
    if (k.principal) return false; // hándicap o total en la línea principal del mercado (pronósticos antiguos)
    if (k.cuotaReal) return k.prob >= MINIMO && k.cuotaReal >= CUOTA_MINIMA; // con cuota real manda lo que paga la casa
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

  return { NOMBRES: NOMBRES, MARGEN_CONGELAR: MARGEN_CONGELAR, MINIMO: MINIMO, SEGURO: SEGURO, MAXIMO: MAXIMO, arriesgados: arriesgados, RIESGO_MIN: RIESGO_MIN, RIESGO_MAX: RIESGO_MAX, RIESGO_CUOTA: RIESGO_CUOTA, CUOTA_MINIMA: CUOTA_MINIMA, CUANTOS: CUANTOS, MEZCLA: MEZCLA, apto: apto, mejores: mejores, conLineas: conLineas, normalizar: normalizar, indexar: indexar, parte: parte, jugadoresDe: jugadoresDe, probJugador: probJugador,
    lineaEquipo: lineaEquipo, masDe: masDe, masQue: masQue, CUENTAS: CUENTAS, lineaJusta: lineaJusta, mezclar: mezclar, probConCasa: probConCasa, picksDe: picksDe, inicio: inicio, calificar: calificar, textoHandicap: textoHandicap };
});
