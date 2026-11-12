/* Interfaz del simulador NFL. El cálculo vive en modelo.js. */
(function () {
  'use strict';
  var M = window.ModeloNFL;
  var URL_VIVO = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
  var PRIMERA_TEMPORADA_VISIBLE = 2016;

  var EQ = {
    ARI: ['Arizona Cardinals', '#97233F'], ATL: ['Atlanta Falcons', '#A71930'], BAL: ['Baltimore Ravens', '#241773'], BUF: ['Buffalo Bills', '#00338D'],
    CAR: ['Carolina Panthers', '#0085CA'], CHI: ['Chicago Bears', '#0B162A'], CIN: ['Cincinnati Bengals', '#D9480F'], CLE: ['Cleveland Browns', '#4A2A0A'],
    DAL: ['Dallas Cowboys', '#003594'], DEN: ['Denver Broncos', '#D9480F'], DET: ['Detroit Lions', '#0076B6'], GB: ['Green Bay Packers', '#203731'],
    HOU: ['Houston Texans', '#03202F'], IND: ['Indianapolis Colts', '#002C5F'], JAX: ['Jacksonville Jaguars', '#006778'], KC: ['Kansas City Chiefs', '#C8102E'],
    LA: ['Los Angeles Rams', '#003594'], LAC: ['Los Angeles Chargers', '#0073B0'], LV: ['Las Vegas Raiders', '#1B1B1B'], MIA: ['Miami Dolphins', '#007C85'],
    MIN: ['Minnesota Vikings', '#4F2683'], NE: ['New England Patriots', '#002244'], NO: ['New Orleans Saints', '#2B2622'], NYG: ['New York Giants', '#0B2265'],
    NYJ: ['New York Jets', '#125740'], PHI: ['Philadelphia Eagles', '#004C54'], PIT: ['Pittsburgh Steelers', '#1F1F1F'], SEA: ['Seattle Seahawks', '#002244'],
    SF: ['San Francisco 49ers', '#AA0000'], TB: ['Tampa Bay Buccaneers', '#B20A0A'], TEN: ['Tennessee Titans', '#0C2340'], WAS: ['Washington Commanders', '#5A1414']
  };
  var RONDAS = { WC: 'Comodines', DIV: 'Ronda divisional', CON: 'Finales de conferencia', SB: 'Super Bowl' };
  var ESTAD = {
    pase: { nombre: 'yardas de pase', corto: 'Pase', escala: [200, 225, 250, 275, 300] },
    carrera: { nombre: 'yardas por tierra', corto: 'Tierra', escala: [40, 50, 60, 75, 100] },
    recepcion: { nombre: 'yardas de recepción', corto: 'Recepción', escala: [40, 50, 60, 75, 100] },
    atrapadas: { nombre: 'recepciones', corto: 'Atrapadas', escala: [3, 4, 5, 6, 7] },
    tdPase: { nombre: 'pases de touchdown', corto: 'TD de pase', escala: [2, 3], poisson: true },
    td: { nombre: 'touchdowns anotados', corto: 'Anota TD', escala: [1], poisson: true }
  };
  var PICK_MINIMO = 0.65; // un hito de jugador solo se propone si su probabilidad llega a esto

  var E = { partidos: [], estado: null, vista: 'jornada', temporada: null, semana: null, origen: '', cache: {}, libre: null, precision: null,
    lesiones: null, jug: null, jugPorEquipo: {}, semanasEquipo: {}, calib: null, ajustes: {}, filtro: 'todos', resumen: {} };
  var $ = function (id) { return document.getElementById(id); };
  var vista = $('vista');

  // ---------- utilidades ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(p, d) { return (p * 100).toFixed(d == null ? 1 : d) + '%'; }
  function n1(x) { return x.toFixed(1); }
  function signo(x) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toString(); }
  function signo1(x) { var t = Math.abs(x).toFixed(1); return (t === '0.0' ? '' : x > 0 ? '+' : '−') + t; }
  function cuota(p) { return p > 0.0005 ? (1 / p).toFixed(2) : '—'; }
  function nombre(t) { return EQ[t] ? EQ[t][0] : t; }
  function escudo(t, grande) { return '<span class="escudo' + (grande ? ' grande' : '') + '" style="background:' + (EQ[t] ? EQ[t][1] : '#444') + '">' + t + '</span>'; }
  function fecha(p) {
    var d = new Date(p.fecha + 'T12:00:00');
    return d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }) + (p.hora ? ' · ' + p.hora + ' ET' : '');
  }
  function medio(x) { return Math.round(x * 2) / 2; }
  function textoHandicap(equipo, h) { return equipo + ' ' + (h === 0 ? 'PK' : signo(h)); }
  function favorito(p, margen) {
    var m = medio(margen);
    return m === 0 ? 'Parejo' : m > 0 ? textoHandicap(p.local, -m) : textoHandicap(p.visita, m);
  }
  function abreviar(n) { var p = String(n).split(' '); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : n; }
  function apellido(n) { return String(n || '—').split(' ').slice(1).join(' ') || n || '—'; }

  // ---------- datos ----------
  function traer(url, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(url, { signal: ctl.signal, cache: 'no-store' }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.text();
    });
  }
  function cargar() {
    // En vivo: marcadores, líneas y quarterbacks al minuto. Copia del sitio: además eficiencia, lesiones y jugadores.
    var nada = function () { return null; }, json = function (u) { return traer(u, 15000).then(JSON.parse).catch(nada); };
    return Promise.all([
      traer(URL_VIVO, 9000).catch(nada), traer('datos/partidos.csv', 15000).catch(nada),
      json('datos/lesiones.json'), json('datos/jugadores.json'), json('datos/calibracion-jugadores.json')
    ]).then(function (r) {
      if (!r[0] && !r[1]) throw new Error('sin conexión con los datos');
      var copia = r[1] ? M.leerCSV(r[1]) : null;
      E.origen = r[0] ? 'en vivo desde nflverse' : 'copia guardada en el sitio';
      E.lesiones = r[2]; E.jug = r[3]; E.calib = r[4];
      E.partidos = M.prepararPartidos(r[0] ? M.leerCSV(r[0]) : copia, 2010, r[0] ? copia : null);
      if (!E.partidos.length) throw new Error('sin partidos');
      E.estado = M.calificar(E.partidos);
      if (E.jug) E.jug.jugadores.forEach(function (j) {
        (E.jugPorEquipo[j.e] = E.jugPorEquipo[j.e] || []).push(j);
        var s = E.semanasEquipo[j.e] = E.semanasEquipo[j.e] || {};
        j.j.forEach(function (g) { if (g[2] && g[0] === E.jug.temporada) s[g[1]] = 1; });
      });
      var jugados = E.partidos.filter(function (p) { return p.jugado; });
      var ultimo = jugados[jugados.length - 1];
      E.ultima = E.partidos[E.partidos.length - 1].temporada;
      E.temporada = E.ultima;
      var pendiente = E.partidos.filter(function (p) { return p.temporada === E.temporada && !p.jugado; })[0];
      E.semana = pendiente ? pendiente.semana : ultimo.semana;
      $('estado-datos').textContent = jugados.length.toLocaleString('es') + ' partidos reales · último: ' +
        ultimo.visita + ' ' + ultimo.ptsVisita + '–' + ultimo.ptsLocal + ' ' + ultimo.local + ' (' + ultimo.fecha + ') · ' + E.origen;
    });
  }

  // ---------- expectativa y simulación ----------
  function fuente() { return $('fuente').value; }
  function nsims() { return Number($('nsims').value); }
  // Ajuste manual del usuario (noticias, clima): puntos extra por equipo y viento en km/h.
  function ajustar(e, a) {
    a = a || {};
    var viento = Math.max(0, (Number(a.viento) || 0) / 1.609 - 10) * M.PARAMS.viento;
    e.local += (Number(a.local) || 0) - viento / 2; e.visita += (Number(a.visita) || 0) - viento / 2;
    e.local = Math.max(3, e.local); e.visita = Math.max(3, e.visita);
    e.margen = e.local - e.visita; e.total = e.local + e.visita; e.viento = viento;
    return e;
  }
  function expectativa(p) {
    var f = fuente(), m = p.pred, a = E.ajustes[p.id];
    if (f === 'modelo' || p.linea == null || p.lineaTotal == null) return ajustar({ local: m.local, visita: m.visita, fuente: 'modelo' }, a);
    var ml = (p.lineaTotal + p.linea) / 2, mv = (p.lineaTotal - p.linea) / 2;
    if (f === 'mezcla') { ml = (ml + m.local) / 2; mv = (mv + m.visita) / 2; }
    return ajustar({ local: ml, visita: mv, fuente: f }, a);
  }
  function qb(p, lado) { return lado === 'l' ? (p.qbLocal || p.qbLocalSupuesto || '') : (p.qbVisita || p.qbVisitaSupuesto || ''); }
  function simPartido(p) {
    var e = expectativa(p), clave = [p.id, e.fuente, nsims(), n1(e.local), n1(e.visita)].join('|');
    if (!E.cache[clave]) E.cache[clave] = M.simular(e.local, e.visita, nsims(), M.semillaDe(p.id), p.tipo !== 'REG');
    return { esp: e, sim: E.cache[clave] };
  }

  // ---------- datos de temporada de cada equipo ----------
  function resumenEquipo(t) {
    if (E.resumen[t]) return E.resumen[t];
    var r = { g: 0, p: 0, e: 0, pf: 0, pc: 0, n: 0, hg: 0, hp: 0, he: 0, mas: 0, menos: 0, forma: [] };
    E.partidos.forEach(function (p) {
      if (p.temporada !== E.ultima || !p.jugado || (p.local !== t && p.visita !== t)) return;
      var casa = p.local === t, propios = casa ? p.ptsLocal : p.ptsVisita, rival = casa ? p.ptsVisita : p.ptsLocal, d = propios - rival;
      r.n++; r.pf += propios; r.pc += rival; r[d > 0 ? 'g' : d < 0 ? 'p' : 'e']++;
      if (p.linea != null) { var c = (casa ? 1 : -1) * (p.ptsLocal - p.ptsVisita - p.linea); r[c > 0 ? 'hg' : c < 0 ? 'hp' : 'he']++; }
      if (p.lineaTotal != null) { var tt = p.ptsLocal + p.ptsVisita - p.lineaTotal; if (tt > 0) r.mas++; else if (tt < 0) r.menos++; }
      r.forma.push({ r: d > 0 ? 'G' : d < 0 ? 'P' : 'E', t: (casa ? 'vs ' : 'en ') + (casa ? p.visita : p.local) + ' ' + propios + '–' + rival });
    });
    r.marca = r.g + '-' + r.p + (r.e ? '-' + r.e : '');
    r.handicap = r.hg + '-' + r.hp + (r.he ? '-' + r.he : '');
    return (E.resumen[t] = r);
  }
  function enfrentamientos(a, b) {
    return E.partidos.filter(function (p) { return p.jugado && ((p.local === a && p.visita === b) || (p.local === b && p.visita === a)); }).slice(-5).reverse();
  }

  // ---------- jugadores y picks ----------
  function parte(p) { var L = E.lesiones; return L && L.temporada === p.temporada && L.semanas ? L.semanas[p.semana] || null : null; }
  // Jugadores con proyección para un partido por jugar de la temporada en curso.
  function jugadoresDe(p, lado) {
    if (!E.jug || p.jugado || p.temporada !== E.jug.temporada) return [];
    var eq = lado === 'l' ? p.local : p.visita, rival = lado === 'l' ? p.visita : p.local, sem = parte(p), estado = {};
    ((sem && sem[eq]) || []).forEach(function (x) { estado[x.n] = x.e; });
    var semanas = Object.keys(E.semanasEquipo[eq] || {}).map(Number).sort(function (a, b) { return a - b; });
    var limite = semanas.length > 1 ? semanas[semanas.length - 2] : 0;
    var titular = (lado === 'l' ? p.qbLocalId : p.qbVisitaId) || (E.estado.titular[eq] || {}).id;
    var lista = [];
    (E.jugPorEquipo[eq] || []).forEach(function (j) {
      var ult = j.j[j.j.length - 1];
      if (j.p === 'QB' ? j.id !== titular : (ult[0] !== E.jug.temporada || ult[1] < limite)) return; // suplentes y ausentes recientes
      if (estado[j.n] === 'Out' || estado[j.n] === 'Doubtful') return;
      var pr = M.proyectar(j, E.jug.temporada, E.jug, rival);
      if (pr) lista.push({ j: j, eq: eq, pr: pr, duda: estado[j.n] === 'Questionable' });
    });
    return lista.sort(function (a, b) { return valor(b) - valor(a); });
    function valor(x) { return (x.pr.pase ? 1000 : 0) + (x.pr.carrera ? x.pr.carrera.m : 0) + (x.pr.recepcion ? x.pr.recepcion.m : 0); }
  }
  function probJugador(pr, k, umbral) {
    if (pr[k] == null) return null;
    return ESTAD[k].poisson ? M.probPoisson(pr[k], umbral) : M.probAlMenos(pr[k].m, pr[k].sd, umbral);
  }
  function textoPick(k, u) { return k === 'td' ? 'anota touchdown' : u + '+ ' + ESTAD[k].nombre; }
  // Lista de picks de un partido, de mayor a menor probabilidad.
  function picksDe(p) {
    var r = simPartido(p), s = r.sim, lista = [], juego = p.visita + ' en ' + p.local;
    var pf = Math.max(s.pLocal, s.pVisita), ef = s.pLocal >= s.pVisita ? p.local : p.visita;
    lista.push({ tipo: 'partido', eq: ef, quien: nombre(ef), que: 'gana el partido', prob: pf, juego: juego, p: p });
    if (p.linea != null) {
      var c = M.cubrir(s, -p.linea), lc = c.local >= c.visita;
      lista.push({ tipo: 'partido', eq: lc ? p.local : p.visita, quien: textoHandicap(lc ? p.local : p.visita, lc ? -p.linea : p.linea), que: 'cubre el hándicap del mercado',
        prob: Math.max(c.local, c.visita) / (1 - c.nulo || 1), juego: juego, p: p });
    }
    if (p.lineaTotal != null) {
      var t = M.totales(s, p.lineaTotal), mas = t.mas >= t.menos;
      lista.push({ tipo: 'partido', eq: null, quien: (mas ? 'Más de ' : 'Menos de ') + p.lineaTotal + ' puntos', que: 'total del partido', prob: Math.max(t.mas, t.menos) / (1 - t.nulo || 1), juego: juego, p: p });
    }
    ['v', 'l'].forEach(function (lado) {
      jugadoresDe(p, lado).forEach(function (x) {
        Object.keys(ESTAD).forEach(function (k) {
          if (x.pr[k] == null) return;
          if (k === 'td') { lista.push({ tipo: 'td', eq: x.eq, quien: x.j.n, que: 'anota touchdown', prob: probJugador(x.pr, k, 1), juego: juego, p: p, duda: x.duda }); return; }
          // El hito más exigente que todavía es muy probable.
          var mejor = null;
          ESTAD[k].escala.forEach(function (u) { var q = probJugador(x.pr, k, u); if (q >= PICK_MINIMO) mejor = { u: u, q: q }; });
          if (mejor) lista.push({ tipo: 'jugador', eq: x.eq, quien: x.j.n, que: textoPick(k, mejor.u), prob: mejor.q, juego: juego, p: p, duda: x.duda });
        });
      });
    });
    return lista.sort(function (a, b) { return b.prob - a.prob; });
  }
  function filaPick(k, conJuego) {
    return '<li class="pick"><span class="pick-prob">' + pct(k.prob, 0) + '</span><span class="pick-cuerpo">' + (k.eq ? escudo(k.eq) + ' ' : '') + '<b>' + esc(k.quien) + '</b> ' + esc(k.que) +
      (k.duda ? ' <span class="etiqueta">en duda</span>' : '') + (conJuego ? '<br><span class="tenue">' + esc(k.juego) + '</span>' : '') +
      '</span><span class="pick-barra"><i style="width:' + (k.prob * 100).toFixed(0) + '%"></i></span><span class="pick-cuota" title="Cuota justa: si tu casa paga más que esto, la apuesta tiene valor según el modelo">' + cuota(k.prob) + '</span></li>';
  }

  // ---------- globo de ayuda para los gráficos ----------
  var globo = $('globo');
  document.addEventListener('mousemove', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-globo]');
    if (!t) { globo.hidden = true; return; }
    globo.textContent = t.getAttribute('data-globo'); globo.hidden = false;
    var x = Math.min(ev.clientX + 12, window.innerWidth - globo.offsetWidth - 8);
    globo.style.left = x + 'px'; globo.style.top = (ev.clientY - globo.offsetHeight - 10 < 0 ? ev.clientY + 16 : ev.clientY - globo.offsetHeight - 10) + 'px';
  });

  /* Histograma en SVG. barras: [{x0, x1, v, color, texto}], ref: {x, texto}, marcas: [{x, t}] */
  function histograma(o) {
    var W = 480, H = 230, iz = 34, de = 8, ar = 20, ab = 24, aw = W - iz - de, ah = H - ar - ab;
    var max = Math.max.apply(null, o.barras.map(function (b) { return b.v; })) || 1;
    var paso = max > 0.12 ? 0.05 : max > 0.05 ? 0.02 : max > 0.02 ? 0.01 : 0.005;
    var X = function (x) { return iz + (x - o.min) / (o.max - o.min) * aw; }, Y = function (v) { return ar + ah - v / max * ah; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.titulo) + '">';
    for (var g = paso; g <= max; g += paso)
      s += '<line x1="' + iz + '" x2="' + (W - de) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" stroke="var(--rejilla)"/><text x="' + (iz - 5) + '" y="' + (Y(g) + 4) + '" text-anchor="end">' + (g * 100).toFixed(paso < 0.01 ? 1 : 0) + '%</text>';
    o.barras.forEach(function (b) {
      var x = X(b.x0) + 0.5, w = Math.max(1, X(b.x1) - X(b.x0) - 1), y = Y(b.v), h = ar + ah - y, r = Math.min(3, w / 2, h);
      if (b.v > 0) s += '<path d="M' + x + ',' + (ar + ah) + 'V' + (y + r) + 'q0,-' + r + ' ' + r + ',-' + r + 'h' + (w - 2 * r) + 'q' + r + ',0 ' + r + ',' + r + 'V' + (ar + ah) + 'z" fill="' + b.color + '"/>';
      s += '<rect x="' + X(b.x0) + '" y="' + ar + '" width="' + (X(b.x1) - X(b.x0)) + '" height="' + ah + '" fill="transparent" data-globo="' + esc(b.texto) + '"/>';
    });
    s += '<line x1="' + iz + '" x2="' + (W - de) + '" y1="' + (ar + ah) + '" y2="' + (ar + ah) + '" stroke="var(--tinta-3)"/>';
    o.marcas.forEach(function (m) { s += '<text x="' + X(m.x) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(m.t) + '</text>'; });
    if (o.ref && o.ref.x > o.min && o.ref.x < o.max) {
      var rx = X(o.ref.x), der = rx < W - 120;
      s += '<line x1="' + rx + '" x2="' + rx + '" y1="' + (ar - 6) + '" y2="' + (ar + ah) + '" stroke="var(--tinta)" stroke-width="1.5" stroke-dasharray="4 3"/>' +
        '<text x="' + (rx + (der ? 5 : -5)) + '" y="' + (ar + 4) + '" text-anchor="' + (der ? 'start' : 'end') + '" style="fill:var(--tinta)">' + esc(o.ref.texto) + '</text>';
    }
    return s + '</svg>';
  }
  // Gráfico de calibración: puntos [{dicho, real, n}] sobre la diagonal ideal.
  function calibracion(puntos, etiqueta, color) {
    var W = 420, H = 300, iz = 40, ab = 34, ar = 12, de = 12;
    var X = function (v) { return iz + v * (W - iz - de); }, Y = function (v) { return ar + (1 - v) * (H - ar - ab); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Calibración">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      svg += '<line x1="' + iz + '" x2="' + (W - de) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--rejilla)"/><text x="' + (iz - 5) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v * 100 + '%</text><text x="' + X(v) + '" y="' + (H - 16) + '" text-anchor="middle">' + v * 100 + '%</text>';
    });
    svg += '<text x="' + X(0.5) + '" y="' + (H - 2) + '" text-anchor="middle">' + esc(etiqueta) + '</text>' +
      '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(1) + '" y2="' + Y(1) + '" stroke="var(--tinta-3)" stroke-dasharray="4 3"/>';
    var max = Math.max.apply(null, puntos.map(function (c) { return c.n; }));
    puntos.forEach(function (c) {
      svg += '<circle cx="' + X(c.dicho) + '" cy="' + Y(c.real) + '" r="' + (4 + 6 * Math.sqrt(c.n / max)) + '" fill="' + color + '" stroke="var(--superficie)" stroke-width="2" data-globo="Se dijo ' + pct(c.dicho, 0) + ' y ocurrió ' + pct(c.real, 0) + ' de las veces (' + c.n.toLocaleString('es') + ' casos)"/>';
    });
    return svg + '</svg>';
  }

  // ---------- piezas del detalle ----------
  function bloqueComparacion(v, l) {
    var a = resumenEquipo(v), b = resumenEquipo(l), ea = E.jug && E.jug.equipos[v], eb = E.jug && E.jug.equipos[l];
    function pj(x, n) { return n ? (x / n).toFixed(1) : '—'; }
    var filas = [
      ['Marca', a.marca, b.marca], ['Puntos a favor por partido', pj(a.pf, a.n), pj(b.pf, b.n)], ['Puntos en contra por partido', pj(a.pc, a.n), pj(b.pc, b.n)],
      ['Marca contra el hándicap', a.handicap, b.handicap], ['Partidos por encima / debajo del total', a.mas + ' / ' + a.menos, b.mas + ' / ' + b.menos]
    ];
    if (ea && eb) filas = filas.concat([
      ['Yardas de pase por partido', pj(ea.pase, ea.g), pj(eb.pase, eb.g)], ['Yardas por tierra por partido', pj(ea.carrera, ea.g), pj(eb.carrera, eb.g)],
      ['Yardas de pase permitidas', pj(ea.paseC, ea.g), pj(eb.paseC, eb.g)], ['Yardas por tierra permitidas', pj(ea.carreraC, ea.g), pj(eb.carreraC, eb.g)],
      ['Balones perdidos / recuperados', ea.perdidas + ' / ' + ea.robos, eb.perdidas + ' / ' + eb.robos], ['Capturas hechas / recibidas', ea.capturas + ' / ' + ea.capturasSufridas, eb.capturas + ' / ' + eb.capturasSufridas]
    ]);
    function forma(r) { return '<span class="forma">' + (r.forma.slice(-5).map(function (f) { return '<i class="f' + f.r + '" data-globo="' + esc(f.t) + '">' + f.r + '</i>'; }).join('') || '—') + '</span>'; }
    var h2h = enfrentamientos(v, l);
    return '<section class="tarjeta"><h3>Comparación de la temporada ' + E.ultima + '</h3><div class="desborde"><table><tr><th></th><th>' + v + '</th><th>' + l + '</th></tr>' +
      filas.map(function (f) { return '<tr><td>' + f[0] + '</td><td>' + f[1] + '</td><td>' + f[2] + '</td></tr>'; }).join('') +
      '<tr><td>Últimos 5 (más reciente a la derecha)</td><td>' + forma(a) + '</td><td>' + forma(b) + '</td></tr></table></div>' +
      (h2h.length ? '<p class="tenue" style="margin-top:10px">Últimos enfrentamientos: ' + h2h.map(function (p) { return p.temporada + ' ' + p.visita + ' ' + p.ptsVisita + '–' + p.ptsLocal + ' ' + p.local; }).join(' · ') + '</p>' : '') + '</section>';
  }
  function bloqueJugadores(p) {
    var lados = [['v', p.visita], ['l', p.local]].map(function (x) { return { eq: x[1], lista: jugadoresDe(p, x[0]) }; });
    if (!lados[0].lista.length && !lados[1].lista.length) return '';
    function c(x) { return x ? Math.round(x.m) : '<span class="tenue">·</span>'; }
    var tablas = lados.map(function (L) {
      return '<p style="margin:10px 0 4px">' + escudo(L.eq) + ' <b>' + esc(nombre(L.eq)) + '</b></p><div class="desborde"><table><tr><th>Jugador</th><th>Pase</th><th>Tierra</th><th>Recepción</th><th>Atrapadas</th><th>Anota TD</th></tr>' +
        L.lista.map(function (x) {
          return '<tr><td>' + esc(x.j.n) + ' <span class="tenue">' + x.j.p + (x.duda ? ' · en duda' : '') + '</span></td><td>' + c(x.pr.pase) + '</td><td>' + c(x.pr.carrera) + '</td><td>' + c(x.pr.recepcion) + '</td><td>' +
            (x.pr.atrapadas ? x.pr.atrapadas.m.toFixed(1) : '<span class="tenue">·</span>') + '</td><td>' + (x.pr.td != null ? pct(M.probPoisson(x.pr.td, 1), 0) : '<span class="tenue">·</span>') + '</td></tr>';
        }).join('') + '</table></div>';
    }).join('');
    var todos = lados[0].lista.concat(lados[1].lista);
    return '<section class="tarjeta ancho"><h3>Jugadores: proyección para este partido</h3><p class="tenue">Yardas y recepciones esperadas según sus últimos partidos y la defensa rival. No incluye a descartados ni a quarterbacks suplentes.</p>' +
      '<div class="dos sin-margen"><div>' + tablas + '</div><div><h3 style="margin-top:10px">Calcula tu propia línea</h3>' +
      '<div class="fila"><label>Jugador<select id="cal-j">' + todos.map(function (x, i) { return '<option value="' + i + '">' + esc(x.j.n) + ' (' + x.eq + ')</option>'; }).join('') + '</select></label>' +
      '<label>Estadística<select id="cal-e"></select></label><label>Línea<input type="number" id="cal-l" step="0.5" min="0" style="width:90px"></label></div><div id="cal-r"></div>' +
      '<p class="tenue">Pon la línea que ofrece tu casa de apuestas. Si la cuota que pagan es mayor que la cuota justa, la apuesta tiene valor según el modelo.</p></div></div></section>';
  }
  function activarCalculadora(caja, p) {
    var selJ = caja.querySelector('#cal-j'); if (!selJ) return;
    var todos = jugadoresDe(p, 'v').concat(jugadoresDe(p, 'l')), selE = caja.querySelector('#cal-e'), inL = caja.querySelector('#cal-l'), res = caja.querySelector('#cal-r');
    function estadisticas() {
      var x = todos[Number(selJ.value)];
      selE.innerHTML = Object.keys(ESTAD).filter(function (k) { return x.pr[k] != null; }).map(function (k) { return '<option value="' + k + '">' + ESTAD[k].nombre + '</option>'; }).join('');
      linea();
    }
    function linea() {
      var x = todos[Number(selJ.value)], k = selE.value, m = ESTAD[k].poisson ? x.pr[k] : x.pr[k].m;
      inL.value = Math.max(0.5, Math.floor(m) + 0.5); calcular();
    }
    function calcular() {
      var x = todos[Number(selJ.value)], k = selE.value, l = Number(inL.value) || 0, mas = probJugador(x.pr, k, Math.floor(l) + 1);
      res.innerHTML = '<div class="resultado" style="grid-template-columns:1fr 1fr"><div><b>' + pct(mas) + '</b><span>más de ' + l + '<br>cuota justa ' + cuota(mas) + '</span></div><div><b>' + pct(1 - mas) + '</b><span>menos de ' + l +
        '<br>cuota justa ' + cuota(1 - mas) + '</span></div></div><p class="tenue">Media esperada: ' + (ESTAD[k].poisson ? x.pr[k].toFixed(2) : x.pr[k].m.toFixed(1)) + ' ' + ESTAD[k].nombre + '.</p>';
    }
    selJ.onchange = estadisticas; selE.onchange = linea; inL.oninput = calcular; estadisticas();
  }
  function parteLesiones(p) {
    var sem = parte(p);
    if (!sem) return '<p class="tenue" style="margin-top:8px">' + (p.jugado ? 'El parte de lesiones de esta jornada ya no está guardado; las bajas sí están contadas arriba.' :
      'Todavía no hay parte oficial de lesiones para esta jornada (se publica entre miércoles y viernes). Hasta entonces las lesiones cuentan 0.') + '</p>';
    var orden = { Out: 0, Doubtful: 1, Questionable: 2 }, texto = { Out: 'descartado', Doubtful: 'dudoso', Questionable: 'en duda' };
    function lista(eq) {
      var js = (sem[eq] || []).slice().sort(function (a, b) { return orden[a.e] - orden[b.e]; });
      return '<p style="margin:8px 0 2px"><b>' + eq + '</b></p>' + (js.length ? '<ul class="lista">' + js.map(function (j) {
        return '<li>' + esc(j.n) + ' (' + esc(j.p) + ') · ' + (texto[j.e] || esc(j.e)) + (j.l ? ' · ' + esc(j.l) : '') + '</li>'; }).join('') + '</ul>' : '<p class="tenue">Sin jugadores en el parte.</p>');
    }
    return '<details><summary>Ver parte oficial de lesiones</summary>' + lista(p.visita) + lista(p.local) +
      '<p class="tenue">El modelo descuenta a los descartados y dudosos; los quarterbacks se valoran aparte.</p></details>';
  }

  // ---------- detalle de un cruce (diálogo y "Cruce libre") ----------
  // c: {visita, local, neutral, partido|null, pred, ajuste, qbVisita, qbLocal, calcular() → {sim, esp}}
  function pintarDetalle(caja, c) {
    var r = c.calcular(), sim = r.sim, esp = r.esp, p = c.partido, n = sim.n, i, F = c.pred.factores, aj = c.ajuste;
    c.vista = c.vista || {};
    var margenes = {}, tot = {}, marcadores = {};
    for (i = 0; i < n; i++) {
      var d = sim.local[i] - sim.visita[i], t = sim.local[i] + sim.visita[i], k = sim.visita[i] + '–' + sim.local[i];
      margenes[d] = (margenes[d] || 0) + 1; tot[t] = (tot[t] || 0) + 1; marcadores[k] = (marcadores[k] || 0) + 1;
    }
    var hIni = c.vista.h != null ? c.vista.h : p && p.linea != null ? -p.linea : -medio(esp.margen);
    var tIni = c.vista.t != null ? c.vista.t : p && p.lineaTotal != null ? p.lineaTotal : medio(esp.total);
    var top = Object.keys(marcadores).sort(function (a, b) { return marcadores[b] - marcadores[a]; }).slice(0, 8);
    var pm = p ? M.sinMargen(p.mlLocal, p.mlVisita) : null, rv = resumenEquipo(c.visita), rl = resumenEquipo(c.local);
    function lado(eq, quien, res, prob, clase) {
      return '<div class="lado ' + clase + '">' + escudo(eq, true) + '<div><div class="duelo-nombre">' + esc(nombre(eq)) + '</div><div class="tenue">' + res.marca + ' · QB ' + esc(quien || '—') + '</div></div>' +
        '<div class="duelo-prob">' + pct(prob) + '<small>gana · cuota justa ' + cuota(prob) + '</small></div></div>';
    }
    var h = '<p class="tenue">' + (p ? esc(fecha(p)) + (p.estadio ? ' · ' + esc(p.estadio) : '') + (p.neutral ? ' · campo neutral' : '') : (c.neutral ? 'Campo neutral' : 'En casa de ' + esc(nombre(c.local)))) + '</p>' +
      '<div class="duelo">' + lado(c.visita, c.qbVisita, rv, sim.pVisita, 'v') +
      '<div class="centro"><div class="marcador">' + n1(sim.mediaVisita) + ' – ' + n1(sim.mediaLocal) + '</div><div class="tenue">marcador medio · total ' + n1(sim.mediaVisita + sim.mediaLocal) + '</div></div>' +
      lado(c.local, c.qbLocal, rl, sim.pLocal, 'l') + '</div>' +
      '<div class="barra alta"><i class="v" style="flex:' + sim.pVisita + '"></i><i class="l" style="flex:' + sim.pLocal + '"></i></div>';
    if (p && p.jugado) h += '<p><span class="etiqueta">Resultado real</span> <b>' + p.visita + ' ' + p.ptsVisita + ' – ' + p.ptsLocal + ' ' + p.local + '</b>' + (p.prorroga ? ' (prórroga)' : '') +
      ' <span class="tenue">· lo de abajo es lo que se estimaba antes del partido</span></p>';
    h += '<p class="tenue">' + n.toLocaleString('es') + ' simulaciones · ' + ({ modelo: 'modelo estadístico', mezcla: 'mezcla modelo + mercado', mercado: 'línea del mercado' })[esp.fuente] +
      ' · prórroga ' + pct(sim.pProrroga) + ' · empate ' + pct(sim.pEmpate, 2) +
      (p && p.linea != null ? ' · mercado: ' + favorito(p, p.linea) + ', total ' + p.lineaTotal + (pm != null ? ', gana ' + p.local + ' ' + pct(pm, 0) + ' según cuotas sin margen' : '') : '') + '</p>';

    if (p && !p.jugado) {
      var picks = picksDe(p), fuertes = picks.filter(function (x) { return x.tipo !== 'td'; }).slice(0, 8), tds = picks.filter(function (x) { return x.tipo === 'td'; }).slice(0, 6);
      h += '<div class="dos"><section class="tarjeta"><h3>Mejores picks del partido</h3><ul class="picks">' + fuertes.map(function (x) { return filaPick(x); }).join('') + '</ul>' +
        '<p class="tenue">A la derecha, la cuota justa. Solo hay valor si tu casa paga más que eso.</p></section>' +
        '<section class="tarjeta"><h3>Quién anota touchdown</h3>' + (tds.length ? '<ul class="picks">' + tds.map(function (x) { return filaPick(x); }).join('') + '</ul>' : '<p class="tenue">Sin datos de jugadores para este partido.</p>') + '</section></div>';
    }

    h += '<div class="dos"><section class="tarjeta"><h3>Hándicap</h3>' +
      '<label>Hándicap de ' + c.local + ' (negativo = favorito)<span class="paso"><button data-paso="h" data-d="-0.5" aria-label="Bajar medio punto">−</button><input type="number" step="0.5" id="in-h" value="' + hIni + '"><button data-paso="h" data-d="0.5" aria-label="Subir medio punto">+</button></span></label>' +
      '<div id="res-h"></div><div class="leyenda"><span><i class="punto v"></i>gana ' + c.visita + '</span><span><i class="punto l"></i>gana ' + c.local + '</span></div><div id="graf-h"></div>' +
      '<details><summary>Ver hándicaps alternativos en tabla</summary><div class="desborde" id="tabla-h"></div></details></section>';
    h += '<section class="tarjeta"><h3>Total de puntos</h3>' +
      '<label>Línea de más/menos<span class="paso"><button data-paso="t" data-d="-0.5" aria-label="Bajar medio punto">−</button><input type="number" step="0.5" id="in-t" value="' + tIni + '"><button data-paso="t" data-d="0.5" aria-label="Subir medio punto">+</button></span></label>' +
      '<div id="res-t"></div><div class="leyenda"><span><i class="punto t"></i>puntos entre los dos equipos</span></div><div id="graf-t"></div>' +
      '<details><summary>Ver marcadores más repetidos</summary><table><tr><th>Marcador (' + c.visita + '–' + c.local + ')</th><th>Frecuencia</th></tr>' +
      top.map(function (k) { return '<tr><td>' + k + '</td><td>' + pct(marcadores[k] / n, 2) + '</td></tr>'; }).join('') + '</table></details></section></div>';

    if (p) h += '<div class="dos">' + bloqueJugadores(p) + '</div>';

    function pts(x) { return Math.abs(x) < 0.05 ? '0' : signo1(x); }
    function nBajas(b) { return b ? b.at + b.li + b.de : 0; }
    var filasF = [
      ['Calificación del equipo contra la del rival', n1(F.baseVisita), n1(F.baseLocal)],
      ['Quarterback: ' + esc(c.qbVisita || '—') + ' / ' + esc(c.qbLocal || '—'), pts(F.qbVisita), pts(F.qbLocal)],
      ['Jugar en casa', pts(-F.casa / 2), pts(F.casa / 2)],
      ['Descanso (semana libre previa)', pts(-F.descanso / 2), pts(F.descanso / 2)],
      ['Estadio techado', pts(F.techo / 2), pts(F.techo / 2)],
      ['Lesiones' + (p ? ' (' + nBajas(p.bajasVisita) + ' y ' + nBajas(p.bajasLocal) + ' descartados)' : ''), pts(F.bajasVisita), pts(F.bajasLocal)]
    ];
    if (esp.fuente !== 'modelo') filasF.push(['Corrección hacia la línea del mercado', pts(esp.visita - (Number(aj.visita) || 0) + esp.viento / 2 - c.pred.visita), pts(esp.local - (Number(aj.local) || 0) + esp.viento / 2 - c.pred.local)]);
    if (aj.visita || aj.local || esp.viento) filasF.push(['Tu ajuste manual' + (esp.viento ? ' y viento' : ''), pts((Number(aj.visita) || 0) - esp.viento / 2), pts((Number(aj.local) || 0) - esp.viento / 2)]);
    h += '<div class="dos">' + bloqueComparacion(c.visita, c.local) +
      '<section class="tarjeta"><h3>De dónde salen los puntos esperados</h3><div class="desborde"><table><tr><th>Factor</th><th>' + c.visita + '</th><th>' + c.local + '</th></tr>' +
      filasF.map(function (f) { return '<tr><td>' + f[0] + '</td><td>' + f[1] + '</td><td>' + f[2] + '</td></tr>'; }).join('') +
      '<tr><td><b>Puntos esperados</b></td><td><b>' + n1(esp.visita) + '</b></td><td><b>' + n1(esp.local) + '</b></td></tr></table></div>' + (p ? parteLesiones(p) : '') +
      '<h3 style="margin-top:16px">Tu información</h3><p class="tenue">¿Sabes algo que los datos todavía no reflejan (una baja de última hora, mal clima)? Súmale o réstale puntos a cada equipo.</p>' +
      '<div class="fila"><label>Puntos para ' + c.visita + '<input type="number" step="0.5" id="aj-v" value="' + (aj.visita || 0) + '" style="width:84px"></label>' +
      '<label>Puntos para ' + c.local + '<input type="number" step="0.5" id="aj-l" value="' + (aj.local || 0) + '" style="width:84px"></label>' +
      (p && p.bajoTecho ? '' : '<label>Viento (km/h)<input type="number" step="1" min="0" id="aj-w" value="' + (aj.viento || 0) + '" style="width:84px"></label>') +
      '<button id="aj-ok" class="primario">Aplicar y simular</button><button id="aj-0">Quitar</button></div>' +
      '<p class="tenue">Referencias: perder a un quarterback titular de élite suele valer entre 4 y 7 puntos; un receptor o corredor estrella, cerca de 1. El viento solo resta por encima de 16 km/h.</p></section></div>';
    caja.innerHTML = h;

    function reajustar() {
      aj.visita = Number(caja.querySelector('#aj-v').value) || 0; aj.local = Number(caja.querySelector('#aj-l').value) || 0;
      var w = caja.querySelector('#aj-w'); aj.viento = w ? Number(w.value) || 0 : 0;
      c.vista = {}; pintarDetalle(caja, c);
    }
    caja.querySelector('#aj-ok').addEventListener('click', reajustar);
    ['aj-v', 'aj-l', 'aj-w'].forEach(function (id) { var el = caja.querySelector('#' + id); if (el) el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') reajustar(); }); });
    caja.querySelector('#aj-0').addEventListener('click', function () { aj.visita = aj.local = aj.viento = 0; c.vista = {}; pintarDetalle(caja, c); });
    if (p) activarCalculadora(caja, p);

    var inH = caja.querySelector('#in-h'), inT = caja.querySelector('#in-t');
    function caso(valor, texto, extra) { return '<div><b>' + valor + '</b><span>' + texto + (extra ? '<br>' + extra : '') + '</span></div>'; }
    function pintarH() {
      var hv = Number(inH.value) || 0, r = M.cubrir(sim, hv), barras = [], m; c.vista.h = hv;
      caja.querySelector('#res-h').innerHTML = '<div class="resultado">' +
        caso(pct(r.visita), 'cubre ' + textoHandicap(c.visita, -hv), 'cuota justa ' + cuota(r.visita / (1 - r.nulo || 1))) +
        caso(pct(r.local), 'cubre ' + textoHandicap(c.local, hv), 'cuota justa ' + cuota(r.local / (1 - r.nulo || 1))) +
        caso(pct(r.nulo), 'nulo (se devuelve)') + '</div>';
      for (m = -35; m <= 35; m++) {
        var f = (margenes[m] || 0) / n;
        barras.push({ x0: m - 0.5, x1: m + 0.5, v: f, color: m > 0 ? 'var(--local)' : m < 0 ? 'var(--visita)' : 'var(--neutro)',
          texto: (m === 0 ? 'Empate' : (m > 0 ? c.local : c.visita) + ' gana por ' + Math.abs(m)) + ': ' + pct(f, 2) });
      }
      caja.querySelector('#graf-h').innerHTML = histograma({ titulo: 'Distribución de la diferencia de puntos', barras: barras, min: -35.5, max: 35.5,
        marcas: [-28, -14, 0, 14, 28].map(function (x) { return { x: x, t: x === 0 ? 'empate' : (x < 0 ? c.visita : c.local) + ' por ' + Math.abs(x) }; }),
        ref: { x: -hv, texto: 'línea ' + textoHandicap(c.local, hv) } });
    }
    function pintarT() {
      var tv = Number(inT.value) || 0, r = M.totales(sim, tv), barras = [], a; c.vista.t = tv;
      caja.querySelector('#res-t').innerHTML = '<div class="resultado">' +
        caso(pct(r.menos), 'menos de ' + tv, 'cuota justa ' + cuota(r.menos / (1 - r.nulo || 1))) +
        caso(pct(r.mas), 'más de ' + tv, 'cuota justa ' + cuota(r.mas / (1 - r.nulo || 1))) +
        caso(pct(r.nulo), 'exacto (nulo)') + '</div>';
      for (a = 0; a < 90; a += 3) {
        var f = ((tot[a] || 0) + (tot[a + 1] || 0) + (tot[a + 2] || 0)) / n;
        barras.push({ x0: a - 0.5, x1: a + 2.5, v: f, color: 'var(--total)', texto: a + ' a ' + (a + 2) + ' puntos: ' + pct(f) });
      }
      caja.querySelector('#graf-t').innerHTML = histograma({ titulo: 'Distribución del total de puntos', barras: barras, min: -0.5, max: 89.5,
        marcas: [10, 20, 30, 40, 50, 60, 70, 80].map(function (x) { return { x: x, t: String(x) }; }), ref: { x: tv, texto: 'línea ' + tv } });
    }
    var lineas = [-14.5, -10.5, -7.5, -6.5, -3.5, -2.5, -1.5, 1.5, 2.5, 3.5, 6.5, 7.5, 10.5, 14.5];
    caja.querySelector('#tabla-h').innerHTML = '<table><tr><th>Hándicap ' + c.local + '</th><th>Cubre ' + c.local + '</th><th>Cubre ' + c.visita + '</th></tr>' +
      lineas.map(function (l) { var r = M.cubrir(sim, l); return '<tr><td>' + signo(l) + '</td><td>' + pct(r.local) + '</td><td>' + pct(r.visita) + '</td></tr>'; }).join('') + '</table>';
    inH.addEventListener('input', pintarH); inT.addEventListener('input', pintarT);
    caja.querySelectorAll('[data-paso]').forEach(function (b) {
      b.addEventListener('click', function () {
        var en = b.getAttribute('data-paso') === 'h' ? inH : inT;
        en.value = (Number(en.value) || 0) + Number(b.getAttribute('data-d'));
        (en === inH ? pintarH : pintarT)();
      });
    });
    pintarH(); pintarT();
  }
  function abrirPartido(p) {
    E.ajustes[p.id] = E.ajustes[p.id] || {};
    pintarDetalle($('dialogo-cuerpo'), { visita: p.visita, local: p.local, neutral: p.neutral, partido: p, pred: p.pred, ajuste: E.ajustes[p.id],
      qbVisita: qb(p, 'v'), qbLocal: qb(p, 'l'), calcular: function () { return simPartido(p); } });
    $('dialogo').showModal(); $('dialogo').scrollTop = 0;
  }

  // ---------- selector de jornada (compartido por Jornada y Picks) ----------
  function semanasDe(temporada) {
    var vistas = {}, lista = [];
    E.partidos.forEach(function (p) {
      if (p.temporada === temporada && !vistas[p.semana]) { vistas[p.semana] = 1; lista.push({ semana: p.semana, texto: RONDAS[p.tipo] || 'Semana ' + p.semana }); }
    });
    return lista.sort(function (a, b) { return a.semana - b.semana; });
  }
  function selectorJornada() {
    var temporadas = [], t, semanas = semanasDe(E.temporada);
    for (t = E.ultima; t >= PRIMERA_TEMPORADA_VISIBLE; t--) temporadas.push(t);
    if (!semanas.some(function (s) { return s.semana === E.semana; })) E.semana = semanas[semanas.length - 1].semana;
    return '<label>Temporada<select id="sel-temp">' + temporadas.map(function (x) { return '<option' + (x === E.temporada ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
      '<label>Jornada<select id="sel-sem">' + semanas.map(function (s) { return '<option value="' + s.semana + '"' + (s.semana === E.semana ? ' selected' : '') + '>' + s.texto + '</option>'; }).join('') + '</select></label>';
  }
  function activarSelector() {
    $('sel-temp').onchange = function () { E.temporada = Number(this.value); E.semana = 1; pintar(); };
    $('sel-sem').onchange = function () { E.semana = Number(this.value); pintar(); };
  }
  function partidosDeJornada() { return E.partidos.filter(function (p) { return p.temporada === E.temporada && p.semana === E.semana; }); }

  // ---------- vista: jornada ----------
  function vistaJornada() {
    var cab = selectorJornada(), lista = partidosDeJornada(), sims = lista.map(simPartido);
    var claro = null, parejo = null, alto = null;
    lista.forEach(function (p, i) {
      var s = sims[i].sim, f = Math.max(s.pLocal, s.pVisita), tt = s.mediaLocal + s.mediaVisita;
      if (!claro || f > claro.v) claro = { v: f, t: (s.pLocal > s.pVisita ? p.local : p.visita) + ' ' + pct(f, 0), s: p.visita + ' en ' + p.local };
      if (!parejo || f < parejo.v) parejo = { v: f, t: p.visita + ' – ' + p.local, s: pct(s.pVisita, 0) + ' / ' + pct(s.pLocal, 0) };
      if (!alto || tt > alto.v) alto = { v: tt, t: n1(tt) + ' pts', s: p.visita + ' en ' + p.local };
    });
    var jugados = lista.filter(function (p) { return p.jugado; }), aciertos = 0, decididos = 0;
    jugados.forEach(function (p) { var s = simPartido(p).sim, m = p.ptsLocal - p.ptsVisita; if (m) { decididos++; if ((s.pLocal >= s.pVisita) === (m > 0)) aciertos++; } });
    function cifra(t, v, s) { return '<div class="cifra"><div class="t">' + t + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; }
    var h = '<div class="fila">' + cab + '<span class="tenue">Toca un partido para ver picks, jugadores, hándicaps y totales.</span></div>' +
      '<div class="cifras">' + cifra('Partidos', lista.length, jugados.length ? jugados.length + ' jugados · favorito acertado ' + aciertos + ' de ' + decididos : 'por jugar') +
      (claro ? cifra('Favorito más claro', claro.t, claro.s) + cifra('Partido más parejo', parejo.t, parejo.s) + cifra('Total más alto', alto.t, alto.s) : '') + '</div><div class="rejilla">';
    lista.forEach(function (p, i) {
      var s = sims[i].sim, pie = '';
      if (p.jugado) {
        var gano = p.ptsLocal > p.ptsVisita ? 'l' : p.ptsLocal < p.ptsVisita ? 'v' : 'e', fav = s.pLocal >= s.pVisita ? 'l' : 'v';
        pie = gano === 'e' ? '<span class="etiqueta">Empate</span>' : gano === fav ? '<span class="etiqueta bien">✓ acertó el favorito</span>' : '<span class="etiqueta mal">✗ ganó el no favorito</span>';
      } else {
        pie = picksDe(p).slice(0, 3).map(function (k) { return '<span class="chip"><b>' + pct(k.prob, 0) + '</b> ' + esc(k.tipo === 'partido' ? k.quien : abreviar(k.quien)) + (k.tipo === 'partido' ? '' : ' ' + esc(k.que)) + '</span>'; }).join('');
      }
      function fila(eq, lado, prob, puntos) {
        return '<span class="eq">' + escudo(eq) + '<span><span class="nombre">' + esc(nombre(eq)) + '</span><span class="sub">' + resumenEquipo(eq).marca + ' · ' + esc(apellido(qb(p, lado))) + '</span></span></span>' +
          '<span class="pct">' + (p.jugado ? '<b class="final">' + puntos + '</b>' : '') + pct(prob, 0) + '</span>';
      }
      h += '<button class="partido" data-i="' + i + '"><div class="arriba"><span>' + esc(fecha(p)) + (p.neutral ? ' · neutral' : '') + '</span><span>' + (p.jugado ? 'Final' : 'Por jugar') + '</span></div>' +
        '<div class="equipos">' + fila(p.visita, 'v', s.pVisita, p.ptsVisita) + fila(p.local, 'l', s.pLocal, p.ptsLocal) + '</div>' +
        '<div class="barra" data-globo="' + p.visita + ' ' + pct(s.pVisita) + ' · ' + p.local + ' ' + pct(s.pLocal) + ' · empate ' + pct(s.pEmpate, 2) + '"><i class="v" style="flex:' + s.pVisita + '"></i><i class="l" style="flex:' + s.pLocal + '"></i></div>' +
        '<div class="trio"><div><span>Marcador medio</span><b>' + n1(s.mediaVisita) + ' – ' + n1(s.mediaLocal) + '</b></div><div><span>Hándicap estimado</span><b>' + favorito(p, s.mediaLocal - s.mediaVisita) + '</b></div>' +
        '<div><span>Mercado</span><b>' + (p.linea != null ? favorito(p, p.linea) + ' · ' + p.lineaTotal : '—') + '</b></div></div>' +
        '<div class="chips">' + pie + '</div></button>';
    });
    vista.innerHTML = h + '</div>';
    activarSelector();
    vista.querySelectorAll('.partido').forEach(function (b) { b.onclick = function () { abrirPartido(lista[Number(b.getAttribute('data-i'))]); }; });
  }

  // ---------- vista: picks ----------
  function vistaPicks() {
    var lista = partidosDeJornada().filter(function (p) { return !p.jugado; }), todos = [];
    lista.forEach(function (p) { todos = todos.concat(picksDe(p)); });
    var filtros = [['todos', 'Todos'], ['partido', 'Partido'], ['jugador', 'Yardas y recepciones'], ['td', 'Touchdowns']];
    var ver = todos.filter(function (k) { return E.filtro === 'todos' || k.tipo === E.filtro; }).sort(function (a, b) { return b.prob - a.prob; }).slice(0, 40);
    vista.innerHTML = '<div class="fila">' + selectorJornada() + '<div class="segmento" role="group" aria-label="Tipo de pick">' + filtros.map(function (f) {
      return '<button data-f="' + f[0] + '" aria-pressed="' + (E.filtro === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div></div>' +
      (ver.length ? '<section class="tarjeta"><h2>Los picks más probables de la jornada</h2>' +
        '<p class="tenue">Para cada jugador se elige el hito más exigente que aún supera el ' + pct(PICK_MINIMO, 0) + ' de probabilidad. Toca un pick para abrir su partido. La columna de la derecha es la cuota justa: una apuesta solo tiene valor si tu casa paga más que eso.</p>' +
        '<ul class="picks grande">' + ver.map(function (k, i) { return filaPick(k, true).replace('<li class="pick">', '<li class="pick" data-i="' + i + '" tabindex="0">'); }).join('') + '</ul></section>' :
        '<p class="aviso">' + (lista.length ? 'No hay picks de este tipo para la jornada.' : 'Esta jornada ya se jugó. Elige una jornada por jugar para ver picks.') + '</p>') +
      '<p class="aviso">Probabilidad alta no es lo mismo que apuesta buena: las casas ya pagan poco por lo probable. Las proyecciones de jugadores no saben de cambios de rol, clima ni planes de juego.</p>';
    activarSelector();
    vista.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { E.filtro = b.getAttribute('data-f'); vistaPicks(); }; });
    vista.querySelectorAll('.pick[data-i]').forEach(function (li) {
      var abrir = function () { abrirPartido(ver[Number(li.getAttribute('data-i'))].p); };
      li.onclick = abrir; li.onkeydown = function (ev) { if (ev.key === 'Enter') abrir(); };
    });
  }

  // ---------- vista: cruce libre ----------
  function vistaLibre() {
    var codigos = Object.keys(EQ).sort(function (a, b) { return nombre(a) < nombre(b) ? -1 : 1; });
    E.libre = E.libre || { visita: 'KC', local: 'BUF', neutral: false };
    function opciones(sel) { return codigos.map(function (c) { return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + nombre(c) + '</option>'; }).join(''); }
    vista.innerHTML = '<div class="fila"><label>Visitante<select id="lib-v">' + opciones(E.libre.visita) + '</select></label>' +
      '<label>Local<select id="lib-l">' + opciones(E.libre.local) + '</select></label>' +
      '<label>Sede<select id="lib-n"><option value="0">Casa del local</option><option value="1"' + (E.libre.neutral ? ' selected' : '') + '>Campo neutral</option></select></label>' +
      '<button id="lib-otra">Volver a simular</button></div>' +
      '<p class="tenue">Usa las calificaciones actuales de cada equipo y su último quarterback titular, sin lesiones ni línea de mercado.</p><div id="lib-res"></div>';
    var semilla = 1;
    function correr() {
      E.libre = { visita: $('lib-v').value, local: $('lib-l').value, neutral: $('lib-n').value === '1' };
      if (E.libre.visita === E.libre.local) { $('lib-res').innerHTML = '<p class="aviso">Elige dos equipos distintos.</p>'; return; }
      var pred = M.predecir(E.estado, E.libre.local, E.libre.visita, E.libre.neutral), aj = {}, T = E.estado.titular;
      pintarDetalle($('lib-res'), { visita: E.libre.visita, local: E.libre.local, neutral: E.libre.neutral, partido: null, pred: pred, ajuste: aj,
        qbVisita: (T[E.libre.visita] || {}).nombre, qbLocal: (T[E.libre.local] || {}).nombre,
        calcular: function () {
          var e = ajustar({ local: pred.local, visita: pred.visita, fuente: 'modelo' }, aj);
          return { esp: e, sim: M.simular(e.local, e.visita, nsims(), M.semillaDe(E.libre.visita + E.libre.local) + semilla) };
        } });
    }
    ['lib-v', 'lib-l', 'lib-n'].forEach(function (id) { $(id).onchange = correr; });
    $('lib-otra').onclick = function () { semilla++; correr(); };
    correr();
  }

  // ---------- vista: equipos ----------
  function vistaEquipos() {
    var s = E.estado;
    var filas = Object.keys(EQ).filter(function (t) { return t in s.ataque; }).map(function (t) {
      var q = s.titular[t], vq = q && q.id in s.qb ? s.qb[q.id] : 0;
      return { t: t, q: q ? q.nombre : '—', vq: vq, a: s.ataque[t], d: s.defensa[t], n: s.ataque[t] + s.defensa[t] + vq, r: resumenEquipo(t) };
    }).sort(function (a, b) { return b.n - a.n; });
    var max = Math.max.apply(null, filas.map(function (f) { return Math.abs(f.n); }));
    vista.innerHTML = '<p class="tenue">Calificación = puntos por encima o por debajo de un equipo promedio en campo neutral. Ataque: lo que anota de más el equipo sin contar a su quarterback. Defensa: lo que le quita al rival. ' +
      'Ventaja de local estimada hoy: ' + n1(s.local) + ' puntos · promedio de la liga: ' + n1(s.base) + ' puntos por equipo.</p>' +
      '<div class="tarjeta desborde"><table><tr><th>#</th><th class="izq">Equipo</th><th>Marca</th><th>A favor</th><th>En contra</th><th>Hándicap</th><th>Más / menos</th><th>Ataque</th><th class="izq">Quarterback</th><th>Defensa</th><th>Total</th><th class="izq">Frente al promedio</th></tr>' +
      filas.map(function (f, i) {
        var w = Math.abs(f.n) / max * 70, r = f.r;
        return '<tr><td>' + (i + 1) + '</td><td class="izq">' + escudo(f.t) + ' ' + esc(nombre(f.t)) + '</td><td>' + r.marca + '</td><td>' + (r.n ? (r.pf / r.n).toFixed(1) : '—') + '</td><td>' + (r.n ? (r.pc / r.n).toFixed(1) : '—') + '</td><td>' + r.handicap + '</td><td>' + r.mas + ' / ' + r.menos +
          '</td><td>' + signo1(f.a) + '</td><td class="izq">' + esc(f.q) + ' <span class="tenue">' + signo1(f.vq) + '</span></td><td>' + signo1(f.d) + '</td><td><b>' + signo1(f.n) + '</b></td>' +
          '<td class="izq" style="min-width:150px"><span style="display:inline-block;width:70px;text-align:right">' + (f.n < 0 ? '<i class="mini" style="width:' + w + 'px"></i>' : '') + '</span><span style="display:inline-block;width:2px"></span>' +
          (f.n >= 0 ? '<i class="mini" style="width:' + w + 'px"></i>' : '') + '</td></tr>';
      }).join('') + '</table></div><p class="tenue">Hándicap: partidos en los que cubrió la línea del mercado. Más / menos: partidos por encima y por debajo del total del mercado.</p>';
  }

  // ---------- vista: precisión y método ----------
  function calcularPrecision() {
    if (E.precision) return E.precision;
    var porTemp = {}, cubos = [], g = { n: 0, ok: 0, dec: 0, mae: 0, mN: 0, mOk: 0, mDec: 0, mMae: 0, mBrier: 0, mBN: 0, bMod: 0 };
    for (var i = 0; i < 10; i++) cubos.push({ n: 0, p: 0, y: 0 });
    E.partidos.forEach(function (p) {
      if (!p.jugado || p.temporada < PRIMERA_TEMPORADA_VISIBLE) return;
      var s = M.simular(p.pred.local, p.pred.visita, 500, M.semillaDe(p.id), p.tipo !== 'REG');
      var pr = s.pLocal + s.pEmpate / 2, m = p.ptsLocal - p.ptsVisita, y = m > 0 ? 1 : m < 0 ? 0 : 0.5;
      var t = porTemp[p.temporada] = porTemp[p.temporada] || { n: 0, ok: 0, dec: 0, mae: 0, mN: 0, mOk: 0, mDec: 0, mMae: 0 };
      [g, t].forEach(function (o) {
        o.n++; o.mae += Math.abs(m - p.pred.margen);
        if (m !== 0) { o.dec++; if ((pr > 0.5) === (m > 0)) o.ok++; }
        if (p.linea != null) { o.mN++; o.mMae += Math.abs(m - p.linea); if (m !== 0 && p.linea !== 0) { o.mDec++; if ((p.linea > 0) === (m > 0)) o.mOk++; } }
      });
      var pm = M.sinMargen(p.mlLocal, p.mlVisita);
      if (pm != null) { g.mBN++; g.mBrier += (pm - y) * (pm - y); g.bMod += (pr - y) * (pr - y); }
      var c = cubos[Math.min(9, Math.floor(pr * 10))]; c.n++; c.p += pr; c.y += y;
    });
    return (E.precision = { g: g, porTemp: porTemp, cubos: cubos });
  }
  function vistaPrecision() {
    var r = calcularPrecision(), g = r.g, temps = Object.keys(r.porTemp).sort().reverse();
    var puntos = r.cubos.filter(function (c) { return c.n >= 5; }).map(function (c) { return { dicho: c.p / c.n, real: c.y / c.n, n: c.n }; });
    var jug = '';
    if (E.calib) {
      var juntos = {}, nombres = { pase: 'Yardas de pase', tdPase: 'Pases de touchdown', carrera: 'Yardas por tierra', recepcion: 'Yardas de recepción', atrapadas: 'Recepciones', td: 'Anota touchdown' };
      Object.keys(E.calib.tipos).forEach(function (t) { E.calib.tipos[t].forEach(function (c) {
        var k = Math.min(9, Math.floor(c.dicho * 10)), o = juntos[k] = juntos[k] || { n: 0, d: 0, r: 0 }; o.n += c.n; o.d += c.dicho * c.n; o.r += c.real * c.n; }); });
      var pj = Object.keys(juntos).map(function (k) { var o = juntos[k]; return { dicho: o.d / o.n, real: o.r / o.n, n: o.n }; });
      function cerca(lista, v) { var m = null; lista.forEach(function (c) { if (c.n >= 30 && (!m || Math.abs(c.dicho - v) < Math.abs(m.dicho - v))) m = c; }); return m && Math.abs(m.dicho - v) < 0.06 ? pct(m.real, 0) : '—'; }
      jug = '<div class="dos"><section class="tarjeta"><h3>Jugadores: lo que se dijo contra lo que pasó</h3><p class="tenue">' + E.calib.predicciones.toLocaleString('es') + ' predicciones de yardas, recepciones y touchdowns de ' +
        E.calib.temporadas[0] + ' a ' + E.calib.temporadas[E.calib.temporadas.length - 1] + ', cada una hecha solo con partidos anteriores.</p>' + calibracion(pj, 'probabilidad que dio el modelo', 'var(--total)') + '</section>' +
        '<section class="tarjeta"><h3>Por tipo de pick</h3><p class="tenue">Cuando el modelo dio cerca de esa probabilidad, con qué frecuencia ocurrió de verdad.</p><div class="desborde"><table><tr><th>Tipo</th><th>Dijo 55%</th><th>Dijo 65%</th><th>Dijo 75%</th><th>Dijo 85%</th></tr>' +
        Object.keys(nombres).filter(function (t) { return E.calib.tipos[t]; }).map(function (t) { var l = E.calib.tipos[t];
          return '<tr><td>' + nombres[t] + '</td><td>' + cerca(l, 0.55) + '</td><td>' + cerca(l, 0.65) + '</td><td>' + cerca(l, 0.75) + '</td><td>' + cerca(l, 0.85) + '</td></tr>'; }).join('') +
        '</table></div><p class="tenue" style="margin-top:8px">Solo cuenta a jugadores que llegaron a jugar ese partido.</p></section></div>';
    }
    vista.innerHTML = '<h2>¿Qué tan bien acierta?</h2><p class="tenue">Cada partido desde ' + PRIMERA_TEMPORADA_VISIBLE + ' se predijo usando solo lo ocurrido antes de ese día, y se comparó con el resultado real. ' +
      'Las líneas de cierre de las casas de apuestas se muestran como referencia: son la vara más alta que existe.</p>' +
      '<div class="cifras">' +
      '<div class="cifra"><div class="t">Ganador acertado · modelo</div><div class="v">' + pct(g.ok / g.dec) + '</div><div class="s">mercado: ' + pct(g.mOk / g.mDec) + ' · ' + g.n.toLocaleString('es') + ' partidos</div></div>' +
      '<div class="cifra"><div class="t">Error medio del margen · modelo</div><div class="v">' + (g.mae / g.n).toFixed(2) + ' pts</div><div class="s">mercado: ' + (g.mMae / g.mN).toFixed(2) + ' pts</div></div>' +
      '<div class="cifra"><div class="t">Puntaje Brier · modelo</div><div class="v">' + (g.bMod / g.mBN).toFixed(4) + '</div><div class="s">mercado: ' + (g.mBrier / g.mBN).toFixed(4) + ' · moneda al aire: 0.2500 · menor es mejor</div></div>' +
      '</div>' +
      '<div class="dos"><section class="tarjeta"><h3>Partidos: lo que se dijo contra lo que pasó</h3><p class="tenue">Si los puntos caen sobre la diagonal, un 70% del modelo ocurre de verdad cerca del 70% de las veces.</p>' +
      calibracion(puntos, 'probabilidad que dio el modelo al local', 'var(--local)') + '</section>' +
      '<section class="tarjeta"><h3>Por temporada</h3><div class="desborde"><table><tr><th>Temporada</th><th>Partidos</th><th>Acierto modelo</th><th>Acierto mercado</th><th>Error modelo</th><th>Error mercado</th></tr>' +
      temps.map(function (t) { var o = r.porTemp[t]; return '<tr><td>' + t + '</td><td>' + o.n + '</td><td>' + pct(o.ok / o.dec) + '</td><td>' + (o.mDec ? pct(o.mOk / o.mDec) : '—') + '</td><td>' + (o.mae / o.n).toFixed(1) + '</td><td>' + (o.mN ? (o.mMae / o.mN).toFixed(1) : '—') + '</td></tr>'; }).join('') +
      '</table></div></section></div>' + jug +
      '<div class="dos"><section class="tarjeta"><h3>Cómo funciona</h3><ul class="lista">' +
      '<li><b>Datos reales.</b> Marcadores, calendario, líneas de cierre, quarterbacks, eficiencia por jugada, partes de lesiones y estadísticas de cada jugador, todo de nflverse. Se renuevan cada día.</li>' +
      '<li><b>Calificaciones.</b> Cada equipo tiene una nota de ataque y otra de defensa, y cada quarterback titular la suya, en puntos. Tras cada partido se corrigen según lo esperado y lo ocurrido; un 30% de la corrección usa la eficiencia por jugada (EPA), que depende menos de la suerte.</li>' +
      '<li><b>Circunstancias.</b> Quarterback anunciado, descartados por lesión según su posición, ventaja de local, semana libre previa y estadio techado.</li>' +
      '<li><b>Simulación.</b> Cada partido se juega miles de veces, serie ofensiva por serie: touchdown, gol de campo o nada; punto extra o conversión de 2; decisiones de final de partido y prórroga.</li>' +
      '<li><b>Jugadores.</b> La proyección parte de sus últimos 10 partidos (los recientes pesan más), se acerca un poco al promedio para no fiarse de rachas y se ajusta por lo que concede la defensa rival.</li>' +
      '<li><b>Picks.</b> La cuota justa es 1 ÷ probabilidad, sin margen de la casa.</li></ul></section>' +
      '<section class="tarjeta"><h3>Lo que el modelo no sabe</h3><ul class="lista">' +
      '<li>Noticias: no lee prensa ni redes. Para eso están «Tu información» en cada partido y la línea del mercado.</li>' +
      '<li>La calidad de cada lesionado: cuenta jugadores por posición, sin distinguir a una estrella de un suplente.</li>' +
      '<li>Las líneas de jugadores de las casas de apuestas: no hay una fuente gratuita. Por eso los picks de jugadores usan hitos fijos y una calculadora donde pones tú la línea.</li>' +
      '<li>Cambios de rol: si un suplente pasa a titular esta semana, su proyección todavía refleja su papel anterior. Con quarterback nuevo, los receptores se proyectan como si nada hubiera cambiado.</li>' +
      '<li>El parte de lesiones se publica entre miércoles y viernes; antes, las lesiones de la jornada cuentan 0.</li>' +
      '<li>El margen exacto de 3 puntos sale menos que en la NFL real (≈10% contra ≈15%), así que los hándicaps pegados al 3 son aproximados.</li>' +
      '<li>El mercado sigue acertando algo más que el modelo. Ningún pick es una garantía.</li></ul></section></div>';
  }

  // ---------- navegación ----------
  var VISTAS = { jornada: vistaJornada, picks: vistaPicks, libre: vistaLibre, equipos: vistaEquipos, precision: vistaPrecision };
  function pintar() {
    document.querySelectorAll('.pestanas button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-vista') === E.vista)); });
    VISTAS[E.vista]();
  }
  document.querySelectorAll('.pestanas button').forEach(function (b) { b.onclick = function () { E.vista = b.getAttribute('data-vista'); pintar(); }; });
  $('fuente').onchange = pintar; $('nsims').onchange = pintar;
  $('cerrar').onclick = function () { $('dialogo').close(); };
  $('dialogo').addEventListener('click', function (ev) { if (ev.target === this) this.close(); });
  $('dialogo').addEventListener('close', function () { if (E.vista === 'jornada' || E.vista === 'picks') pintar(); });

  cargar().then(pintar).catch(function (e) {
    vista.innerHTML = '<p class="aviso">No se pudieron cargar los datos (' + esc(e.message) + '). Comprueba tu conexión a internet y vuelve a abrir la página.</p>';
    $('estado-datos').textContent = 'Sin datos';
  });
})();
