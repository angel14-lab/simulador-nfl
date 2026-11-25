/* Interfaz del simulador NFL. El modelo está en modelo.js y los picks en picks.js. */
(function () {
  'use strict';
  var M = window.ModeloNFL, P = window.PicksNFL;
  var URL_VIVO = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
  var SIMS = 100000;          // simulaciones por partido por jugar
  var SIMS_PASADO = 30000;    // partidos ya jugados de temporadas anteriores (solo se usa su probabilidad)
  var PRIMERA_TEMPORADA = 2016;

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

  var E = { partidos: [], porId: {}, estado: null, vista: 'jornada', temporada: null, semana: null, cache: {}, resumen: {},
    hist: {}, reales: {}, jug: null, lesiones: null, calib: null, valid: null, ctx: null };
  var $ = function (id) { return document.getElementById(id); };
  var vista = $('vista');

  // ---------- utilidades ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(p, d) { return (p * 100).toFixed(d == null ? 0 : d) + '%'; }
  function n1(x) { return x.toFixed(1); }
  function signo1(x) { var t = Math.abs(x).toFixed(1); return (t === '0.0' ? '' : x > 0 ? '+' : '−') + t; }
  function cuota(p) { return p > 0.0005 ? (1 / p).toFixed(2) : '—'; }
  function nombre(t) { return EQ[t] ? EQ[t][0] : t; }
  function apodo(t) { var n = nombre(t).split(' '); return n[n.length - 1]; }
  function chip(t, clase) { return '<span class="chip' + (clase ? ' ' + clase : '') + '" style="--c:' + (EQ[t] ? EQ[t][1] : '#555') + '">' + t + '</span>'; }
  function apellido(n) { var x = String(n || '').split(' '); return x.length > 1 ? x.slice(1).join(' ') : (n || '—'); }
  function diaLargo(f) { var d = new Date(f + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }); return d.charAt(0).toUpperCase() + d.slice(1); }
  function qb(p, lado) { return lado === 'l' ? (p.qbLocal || p.qbLocalSupuesto || '') : (p.qbVisita || p.qbVisitaSupuesto || ''); }
  function lineaTexto(linea, total, p) {
    if (linea == null) return '—';
    var fav = linea > 0 ? p.local : linea < 0 ? p.visita : null;
    return (fav ? fav + ' −' + Math.abs(linea) : 'Parejo') + (total != null ? ' · ' + total : '');
  }
  function iniciado(p) { var i = P.inicio(p); return p.jugado || (i != null && Date.now() >= i); }

  // ---------- datos ----------
  function traer(url, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(url, { signal: ctl.signal, cache: 'no-store' }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.text(); });
  }
  function cargar() {
    // En vivo: marcadores y quarterbacks al minuto. Copia del sitio: eficiencia, lesiones, jugadores, picks guardados y líneas.
    var nada = function () { return null; }, json = function (u) { return traer(u, 15000).then(JSON.parse).catch(nada); };
    return Promise.all([
      traer(URL_VIVO, 9000).catch(nada), traer('datos/partidos.csv', 15000).catch(nada),
      json('datos/lesiones.json'), json('datos/jugadores.json'), json('datos/calibracion-jugadores.json'),
      json('datos/historial.json'), json('datos/lineas.json'), json('datos/validacion-picks.json')
    ]).then(function (r) {
      if (!r[0] && !r[1]) throw new Error('sin conexión con los datos');
      var copia = r[1] ? M.leerCSV(r[1]) : null;
      E.lesiones = r[2]; E.jug = r[3]; E.calib = r[4]; E.hist = (r[5] && r[5].partidos) || {};
      E.lineasInfo = r[6]; E.reales = (r[6] && r[6].partidos) || {}; E.valid = r[7];
      E.partidos = M.prepararPartidos(r[0] ? M.leerCSV(r[0]) : copia, 2010, r[0] ? copia : null);
      if (!E.partidos.length) throw new Error('sin partidos');
      E.partidos.forEach(function (p) { E.porId[p.id] = p; });
      E.estado = M.calificar(E.partidos);
      var ind = P.indexar(E.jug);
      E.ctx = { jug: E.jug, porEquipo: ind.porEquipo, semanas: ind.semanas, lesiones: E.lesiones, titular: E.estado.titular, lineas: E.reales,
        correccion: P.calcularCorreccion(E.hist) }; // la misma corrección que usa el registro automático
      var jugados = E.partidos.filter(function (p) { return p.jugado; }), ultimo = jugados[jugados.length - 1];
      E.ultima = E.partidos[E.partidos.length - 1].temporada;
      E.temporada = E.ultima;
      var pendiente = E.partidos.filter(function (p) { return p.temporada === E.ultima && !iniciado(p); })[0];
      E.semana = pendiente ? pendiente.semana : ultimo.semana;
      $('estado-datos').textContent = 'Datos de nflverse' + (r[0] ? ' en vivo' : '') + ' · último resultado: ' + ultimo.visita + ' ' + ultimo.ptsVisita + '–' + ultimo.ptsLocal + ' ' + ultimo.local +
        (E.lineasInfo && E.lineasInfo.actualizado ? ' · líneas de casas de apuestas del ' + new Date(E.lineasInfo.actualizado).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    });
  }

  // ---------- pronóstico de un partido ----------
  /* Si el partido tiene pronóstico guardado (lo que se califica), se usa ese, tal cual. Si no, se calcula
     aquí con la misma regla: puntos esperados mezclando modelo y mercado y 100 000 simulaciones. */
  function pronostico(p) {
    if (E.cache[p.id]) return E.cache[p.id];
    var reg = E.hist[p.id], r;
    if (reg) {
      var mapear = function (k) {
        var x = { estimada: !!k.est, tipo: k.t, eq: k.eq, quien: k.q, que: String(k.que).replace(' (línea alternativa)', '').replace('hándicap alternativo', 'hándicap'), prob: k.p, m: k.m, resp: k.r, cuotaReal: k.c, ok: k.ok, top: k.top,
          principal: !reg.v && (k.que === 'hándicap' || k.que === 'puntos en el partido') };
        // Partido terminado y aún sin calificar en el servidor: lo que ya se puede saber se califica aquí.
        if (x.ok === undefined && p.jugado) { var o = P.calificar(x.m, p, function () { return undefined; }); if (o !== undefined) x.ok = o; }
        return x;
      };
      var lista = reg.picks.map(mapear);
      var riesgo = (reg.riesgo || []).map(mapear);
      var top = (reg.v ? lista.filter(function (k) { return k.top && P.apto(k); }) : P.mejores(lista)).sort(function (a, b) { return b.prob - a.prob; });
      r = { pV: reg.pV, pL: reg.pL, mV: reg.mV, mL: reg.mL, top: top, riesgo: riesgo, reg: reg, linea: reg.v ? reg.linea : p.linea, total: reg.v ? reg.total : p.lineaTotal,
        esp: reg.e ? { visita: reg.e[0], local: reg.e[1] } : { visita: Math.max(3, p.pred.visita), local: Math.max(3, p.pred.local) } };
    } else {
      var q = P.conLineas(p, E.reales), esp = P.mezclar(p.pred, q.linea, q.lineaTotal, P.MEZCLA);
      var s = M.simular(esp.local, esp.visita, p.jugado ? SIMS_PASADO : SIMS, M.semillaDe(p.id), p.tipo !== 'REG');
      var todos = p.jugado ? [] : P.picksDe(E.ctx, q, s, esp);
      r = { pV: s.pVisita, pL: s.pLocal, mV: s.mediaVisita, mL: s.mediaLocal, top: P.mejores(todos), riesgo: p.jugado ? [] : P.arriesgados(E.ctx, q, s, esp, todos),
        linea: q.linea, total: q.lineaTotal, esp: esp, sim: p.jugado ? null : s };
    }
    r.top.concat(r.riesgo).forEach(function (k) { k.p = p; });
    r.rOk = r.riesgo.filter(function (k) { return k.ok === true; }).length;
    r.rMal = r.riesgo.filter(function (k) { return k.ok === false; }).length;
    r.ok = r.top.filter(function (k) { return k.ok === true; }).length;
    r.mal = r.top.filter(function (k) { return k.ok === false; }).length;
    r.pend = r.top.filter(function (k) { return k.ok === undefined; }).length;
    return (E.cache[p.id] = r);
  }
  function simDe(p, r) { if (!r.sim) r.sim = M.simular(r.esp.local, r.esp.visita, SIMS, M.semillaDe(p.id), p.tipo !== 'REG'); return r.sim; }

  // ---------- temporada de cada equipo ----------
  function resumenEquipo(t) {
    if (E.resumen[t]) return E.resumen[t];
    var r = { g: 0, p: 0, e: 0, pf: 0, pc: 0, n: 0, hg: 0, hp: 0, he: 0, forma: [] };
    E.partidos.forEach(function (p) {
      if (p.temporada !== E.ultima || !p.jugado || (p.local !== t && p.visita !== t)) return;
      var casa = p.local === t, propios = casa ? p.ptsLocal : p.ptsVisita, rival = casa ? p.ptsVisita : p.ptsLocal, d = propios - rival;
      r.n++; r.pf += propios; r.pc += rival; r[d > 0 ? 'g' : d < 0 ? 'p' : 'e']++;
      if (p.linea != null) { var c = (casa ? 1 : -1) * (p.ptsLocal - p.ptsVisita - p.linea); r[c > 0 ? 'hg' : c < 0 ? 'hp' : 'he']++; }
      r.forma.push({ r: d > 0 ? 'G' : d < 0 ? 'P' : 'E', t: (casa ? 'vs ' : 'en ') + (casa ? p.visita : p.local) + ' ' + propios + '–' + rival });
    });
    r.marca = r.g + '-' + r.p + (r.e ? '-' + r.e : '');
    r.handicap = r.hg + '-' + r.hp + (r.he ? '-' + r.he : '');
    return (E.resumen[t] = r);
  }

  // ---------- por qué de cada pick ----------
  // Lo que lleva cada equipo esta temporada antes de la fecha del partido (puntos y touchdowns).
  function historialEquipo(t, fecha) {
    var g = [];
    E.partidos.forEach(function (p) {
      if (p.temporada !== E.ultima || !p.jugado || p.fecha >= fecha || (p.local !== t && p.visita !== t)) return;
      var casa = p.local === t;
      g.push({ pf: casa ? p.ptsLocal : p.ptsVisita, pc: casa ? p.ptsVisita : p.ptsLocal, tf: casa ? p.tdLocal : p.tdVisita, tc: casa ? p.tdVisita : p.tdLocal, tot: p.ptsLocal + p.ptsVisita,
        tdt: p.tdLocal != null && p.tdVisita != null ? p.tdLocal + p.tdVisita : null });
    });
    return g;
  }
  function media(g, f) { var v = g.map(f).filter(function (x) { return x != null; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }
  function cuantos(g, f) { var v = g.filter(function (x) { return f(x) != null; }); return v.filter(function (x) { return f(x); }).length + ' de ' + v.length; }
  var HISTORICO = { gana: 'Ganador', handicap: 'Hándicap alternativo', total: 'Total de puntos alternativo', tds: 'Touchdowns del partido', tdsEquipo: 'Touchdowns de un equipo' };
  /* Una línea con los datos que sostienen el pick: lo que dicen las simulaciones, el mercado y lo que
     llevan los equipos este año, más cuánto acertó ese tipo de pick en la prueba de 2016-2025. */
  function razon(k) {
    var p = k.p, m = k.m || {}, r = pronostico(p), x = [], otro, g, h, dif;
    if (m.m === 'yardas' || m.m === 'tdPase') return k.resp || '';
    if (m.m === 'gana') {
      var fav = r.linea > 0 ? p.local : r.linea < 0 ? p.visita : null;
      x.push('gana en el ' + pct(k.prob) + ' de las simulaciones');
      x.push(fav === m.eq ? 'el mercado lo da favorito por ' + Math.abs(r.linea) : fav ? 'el mercado da favorito al rival por ' + Math.abs(r.linea) : 'el mercado lo ve parejo');
      x.push('marca ' + resumenEquipo(m.eq).marca);
    } else if (m.m === 'handicap') {
      dif = m.eq === p.local ? r.mL - r.mV : r.mV - r.mL;
      x.push('pronóstico: ' + (dif >= 0 ? 'gana por ' + n1(dif) : 'pierde por ' + n1(-dif)));
      x.push(m.linea > 0 ? 'pierde por más de ' + m.linea + ' solo en el ' + pct(1 - k.prob) + ' de las simulaciones' : 'gana por más de ' + Math.abs(m.linea) + ' en el ' + pct(k.prob));
      x.push('contra el hándicap este año ' + resumenEquipo(m.eq).handicap);
    } else if (m.m === 'total') {
      x.push('pronóstico ' + n1(r.mV + r.mL) + ' puntos' + (r.total != null ? ', mercado ' + r.total : ''));
      g = historialEquipo(p.visita, p.fecha); h = historialEquipo(p.local, p.fecha);
      if (g.length && h.length) x.push('sus partidos este año: ' + p.visita + ' ' + n1(media(g, function (y) { return y.tot; })) + ', ' + p.local + ' ' + n1(media(h, function (y) { return y.tot; })) + ' de media');
    } else if (m.m === 'tds') {
      g = historialEquipo(p.visita, p.fecha); h = historialEquipo(p.local, p.fecha);
      var tv = media(g, function (y) { return y.tdt; }), tl = media(h, function (y) { return y.tdt; });
      if (tv != null && tl != null) x.push('touchdowns por partido en sus juegos: ' + p.visita + ' ' + n1(tv) + ', ' + p.local + ' ' + n1(tl));
      if (g.length) x.push('más de ' + m.linea + ' en ' + cuantos(g.concat(h), function (y) { return y.tdt == null ? null : y.tdt > m.linea; }) + ' de esos partidos');
    } else if (m.m === 'tdsEquipo') {
      otro = m.eq === p.local ? p.visita : p.local; g = historialEquipo(m.eq, p.fecha); h = historialEquipo(otro, p.fecha);
      var a = media(g, function (y) { return y.tf; }), c = media(h, function (y) { return y.tc; });
      if (a != null) x.push(m.eq + ' anota ' + n1(a) + ' touchdowns por partido (más de ' + m.linea + ' en ' + cuantos(g, function (y) { return y.tf == null ? null : y.tf > m.linea; }) + ')');
      if (c != null) x.push(otro + ' permite ' + n1(c));
    }
    var v = E.valid && E.valid.tipos.filter(function (t) { return t.tipo === HISTORICO[m.m]; })[0];
    if (k.riesgo) x.push('histórico de los arriesgados: 58%');
    else if (v) x.push('histórico de este tipo de pick: ' + pct(v.acierto));
    return x.join(' · ');
  }

  // ---------- piezas comunes ----------
  function estadoPick(k) {
    if (k.ok === true) return '<span class="res bien">Acertó</span>';
    if (k.ok === false) return '<span class="res mal">Falló</span>';
    if (k.ok === null) return '<span class="res">Anulado</span>';
    return '';
  }
  function filaPick(k, i, conPartido) {
    var notas = [conPartido ? esc(k.p.visita + ' en ' + k.p.local) : '', esc(razon(k))].filter(Boolean).join(' · ');
    return '<li class="pk' + (k.ok === true ? ' es-bien' : k.ok === false ? ' es-mal' : '') + '"' + (conPartido ? ' data-id="' + k.p.id + '" tabindex="0"' : '') + '>' +
      '<span class="pk-n">' + (i + 1) + '</span><span class="pk-p">' + pct(k.prob) + '</span>' +
      '<span class="pk-t">' + (k.eq ? chip(k.eq) + ' ' : '') + '<b>' + esc(k.quien) + '</b> ' + esc(k.que) + (k.duda ? ' <em>en duda</em>' : '') + (notas ? '<small>' + notas + '</small>' : '') + '</span>' +
      (k.cuotaReal ? '<span class="pk-c real">' + Number(k.cuotaReal).toFixed(2) + '<small>paga la casa · justa ' + cuota(k.prob) + (k.riesgo ? ' · ' + (k.prob * k.cuotaReal >= 1 ? 'con valor' : 'sin valor') : '') + '</small></span>' :
        '<span class="pk-c">' + cuota(k.prob) + '<small>' + (k.estimada ? 'cuota justa · línea estimada' : 'cuota justa') + '</small></span>') + estadoPick(k) + '</li>';
  }

  var globo = $('globo');
  document.addEventListener('mousemove', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-globo]');
    if (!t) { globo.hidden = true; return; }
    globo.textContent = t.getAttribute('data-globo'); globo.hidden = false;
    globo.style.left = Math.min(ev.clientX + 12, window.innerWidth - globo.offsetWidth - 8) + 'px';
    globo.style.top = (ev.clientY - globo.offsetHeight - 10 < 0 ? ev.clientY + 16 : ev.clientY - globo.offsetHeight - 10) + 'px';
  });

  /* Histograma en SVG. barras: [{x0, x1, v, color, texto}], ref: {x, texto}, marcas: [{x, t}] */
  function histograma(o) {
    var W = 480, H = 220, iz = 34, de = 8, ar = 20, ab = 24, aw = W - iz - de, ah = H - ar - ab;
    var max = Math.max.apply(null, o.barras.map(function (b) { return b.v; })) || 1;
    var paso = max > 0.12 ? 0.05 : max > 0.05 ? 0.02 : max > 0.02 ? 0.01 : 0.005;
    var X = function (x) { return iz + (x - o.min) / (o.max - o.min) * aw; }, Y = function (v) { return ar + ah - v / max * ah; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.titulo) + '">';
    for (var g = paso; g <= max; g += paso)
      s += '<line x1="' + iz + '" x2="' + (W - de) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" stroke="var(--rejilla)"/><text x="' + (iz - 5) + '" y="' + (Y(g) + 4) + '" text-anchor="end">' + (g * 100).toFixed(paso < 0.01 ? 1 : 0) + '%</text>';
    o.barras.forEach(function (b) {
      var x = X(b.x0) + 0.5, w = Math.max(1, X(b.x1) - X(b.x0) - 1), y = Y(b.v), h = ar + ah - y, r = Math.min(2, w / 2, h);
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
  // Calibración: puntos [{dicho, real, n}] sobre la diagonal ideal, desde «d0» hasta 100%.
  function calibracion(puntos, etiqueta, d0) {
    var W = 420, H = 290, iz = 40, ab = 34, ar = 12, de = 12, t;
    var X = function (v) { return iz + (v - d0) / (1 - d0) * (W - iz - de); }, Y = function (v) { return ar + (1 - (v - d0) / (1 - d0)) * (H - ar - ab); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Calibración">';
    for (t = d0; t <= 1.0001; t += 0.1)
      svg += '<line x1="' + iz + '" x2="' + (W - de) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="var(--rejilla)"/><text x="' + (iz - 5) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + Math.round(t * 100) + '%</text><text x="' + X(t) + '" y="' + (H - 16) + '" text-anchor="middle">' + Math.round(t * 100) + '%</text>';
    svg += '<text x="' + X((d0 + 1) / 2) + '" y="' + (H - 2) + '" text-anchor="middle">' + esc(etiqueta) + '</text>' +
      '<line x1="' + X(d0) + '" y1="' + Y(d0) + '" x2="' + X(1) + '" y2="' + Y(1) + '" stroke="var(--tinta-3)" stroke-dasharray="4 3"/>';
    var max = Math.max.apply(null, puntos.map(function (c) { return c.n; }));
    puntos.filter(function (c) { return c.dicho >= d0 && c.real >= d0; }).forEach(function (c) {
      svg += '<circle cx="' + X(c.dicho) + '" cy="' + Y(c.real) + '" r="' + (4 + 6 * Math.sqrt(c.n / max)) + '" fill="var(--acento)" stroke="var(--panel)" stroke-width="2" data-globo="Se dijo ' + pct(c.dicho) + ' y ocurrió ' + pct(c.real) + ' de las veces (' + c.n.toLocaleString('es') + ' picks)"/>';
    });
    return svg + '</svg>';
  }

  // ---------- detalle de un partido ----------
  function abrirPartido(p) {
    var r = pronostico(p), emp = iniciado(p);
    $('dialogo-titulo').textContent = nombre(p.visita) + ' en ' + nombre(p.local);
    function lado(t, l, prob, pts) {
      return '<div class="d-eq d-' + l + '">' + chip(t, 'grande') + '<div class="d-nom"><b>' + esc(apodo(t)) + '</b><span>' + resumenEquipo(t).marca + ' · QB ' + esc(apellido(qb(p, l))) + '</span></div>' +
        '<div class="d-prob">' + pct(prob) + '<span>' + n1(pts) + ' pts esperados</span></div></div>';
    }
    var h = '<p class="d-meta">' + diaLargo(p.fecha) + (p.hora ? ' · ' + p.hora + ' ET' : '') + (p.estadio ? ' · ' + esc(p.estadio) : '') + (p.neutral ? ' · campo neutral' : '') + '</p>' +
      '<div class="d-cab">' + lado(p.visita, 'v', r.pV, r.mV) +
      '<div class="d-centro">' + (p.jugado ? '<span>Final</span><b>' + p.ptsVisita + ' – ' + p.ptsLocal + '</b>' : '<span>Mercado</span><b>' + lineaTexto(r.linea, r.total, p) + '</b>') + '</div>' +
      lado(p.local, 'l', r.pL, r.mL) + '</div>' +
      bajasResumen(p) + '<div class="reparto"><i style="flex:' + r.pV + ';background:' + EQ[p.visita][1] + '"></i><i style="flex:' + r.pL + ';background:' + EQ[p.local][1] + '"></i></div>';

    if (r.top.length) {
      var aviso = !r.reg ? 'Calculados ahora: este partido todavía no tiene pronóstico guardado.' :
        p.jugado ? (r.pend ? r.ok + ' aciertos, ' + r.mal + ' fallos y ' + r.pend + ' por calificar: los de touchdowns y jugadores esperan las estadísticas oficiales.' :
          r.ok + (r.ok === 1 ? ' acierto' : ' aciertos') + ' de ' + (r.ok + r.mal) + '. Picks guardados antes del inicio.') :
        emp ? 'Congelados antes del inicio; se califican al terminar.' : (E.reales[p.id] && E.reales[p.id].partido ? 'Líneas y cuotas de ' + esc(E.reales[p.id].casaLineas || E.reales[p.id].casa || 'la casa') + ', bajadas el ' + new Date(E.reales[p.id].actualizado).toLocaleString('es', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) + '. ' + (E.reales[p.id].confirmado ? 'Líneas de jugadores del ' + new Date(E.reales[p.id].confirmado).toLocaleString('es', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) + '.' : 'Jugadores con línea estimada: la línea real de la casa se baja en las 24 horas previas.') + ' Quedan fijos 10 minutos antes del inicio.' :
          'Líneas estimadas: las reales de la casa se bajan en las 24 horas previas (jugadores) y en las 4 previas (partido), y los picks se ajustan a ellas.') + ' Todo se revisa cada 20 minutos con el último parte de lesiones y entrenamientos: si un jugador deja de estar disponible, su pick se cae.';
      h += '<p class="d-aviso">' + aviso + (r.reg && r.reg.reconstruido ? ' Rehechos después del partido.' : '') + '</p><div class="d-picks">' +
        '<section class="d-sec"><div class="d-tit"><h3>Los ' + r.top.length + ' picks más probables</h3><p>65% o más · pagan 1.25 o más</p></div>' +
        '<ol class="picks">' + r.top.map(function (k, i) { return filaPick(k, i); }).join('') + '</ol></section>' + bloqueRiesgo(p, r) + '</div>';
    } else if (r.reg) {
      h += '<section class="d-sec"><p class="nota">Este partido se guardó con una versión anterior del modelo y ninguno de sus picks cumple la regla actual (entre ' + pct(P.MINIMO) + ' y ' + pct(P.MAXIMO) + ' en mercados validados).</p></section>';
    } else if (!p.jugado) {
      h += '<section class="d-sec"><p class="vacio">Ningún pick de este partido queda entre ' + pct(P.MINIMO) + ' y ' + pct(P.MAXIMO) + '.</p></section>';
    }

    var q = P.conLineas(p, E.reales), mercado = q.linea != null && q.lineaTotal != null ? { l: (q.lineaTotal + q.linea) / 2, v: (q.lineaTotal - q.linea) / 2 } : null;
    h += '<details class="d-sec analisis"><summary>Análisis del partido</summary>' +
      '<div class="dos"><section><h4>Diferencia de puntos</h4><div class="paso"><label for="in-h">Hándicap de ' + p.local + '</label><button data-paso="h" data-d="-0.5" aria-label="Bajar medio punto">−</button><input type="number" step="0.5" id="in-h" value="' + (r.linea != null ? -r.linea : 0) + '"><button data-paso="h" data-d="0.5" aria-label="Subir medio punto">+</button></div><div id="res-h"></div><div id="graf-h"></div></section>' +
      '<section><h4>Total de puntos</h4><div class="paso"><label for="in-t">Línea</label><button data-paso="t" data-d="-0.5" aria-label="Bajar medio punto">−</button><input type="number" step="0.5" id="in-t" value="' + (r.total != null ? r.total : Math.round(r.mV + r.mL) + 0.5) + '"><button data-paso="t" data-d="0.5" aria-label="Subir medio punto">+</button></div><div id="res-t"></div><div id="graf-t"></div></section></div>' +
      '<div class="dos"><section><h4>Puntos esperados</h4><table><tr><th class="izq"></th><th>' + p.visita + '</th><th>' + p.local + '</th></tr>' +
      '<tr><td class="izq">Modelo estadístico</td><td>' + n1(p.pred.visita) + '</td><td>' + n1(p.pred.local) + '</td></tr>' +
      (mercado ? '<tr><td class="izq">Línea del mercado</td><td>' + n1(mercado.v) + '</td><td>' + n1(mercado.l) + '</td></tr>' : '') +
      '<tr><td class="izq"><b>Usado en la simulación</b></td><td><b>' + n1(r.esp.visita) + '</b></td><td><b>' + n1(r.esp.local) + '</b></td></tr></table>' +
      '<p class="nota">' + (r.reg && !r.reg.v ? 'Pronóstico guardado con la versión anterior: solo modelo, 10 000 simulaciones.' : (P.MEZCLA === 1 ? 'Puntos esperados tomados de la línea del mercado' : pct(P.MEZCLA) + ' mercado y ' + pct(1 - P.MEZCLA) + ' modelo') + ', ' + SIMS.toLocaleString('es') + ' simulaciones.') + '</p></section>' +
      '<section><h4>Temporada ' + E.ultima + '</h4>' + comparacion(p.visita, p.local) + '</section></div>' + lesiones(p) + '</details>';
    $('dialogo-cuerpo').innerHTML = h;
    var d = $('dialogo');
    d.querySelector('.analisis').addEventListener('toggle', function () { if (this.open && !this.dataset.listo) { this.dataset.listo = '1'; graficos(p, r); } });
    d.showModal(); d.scrollTop = 0;
  }
  // Columna de picks arriesgados: más probables que no, con mejor cuota.
  function bloqueRiesgo(p, r) {
    if (!r.riesgo.length) return '<section class="d-sec riesgo"><div class="d-tit"><h3>Arriesgados</h3></div><p class="nota">Este partido no tiene picks entre ' + pct(P.RIESGO_MIN) + ' y ' + pct(P.RIESGO_MAX) + ' que paguen ' + P.RIESGO_CUOTA.toFixed(2) + ' o más.</p></section>';
    r.riesgo.forEach(function (k) { k.riesgo = true; });
    return '<section class="d-sec riesgo"><div class="d-tit"><h3>Arriesgados</h3><p>' + pct(P.RIESGO_MIN) + ' a ' + pct(P.RIESGO_MAX) + ' · pagan ' + P.RIESGO_CUOTA.toFixed(2) + ' o más</p></div>' +
      '<ol class="picks">' + r.riesgo.map(function (k, i) { return filaPick(k, i); }).join('') + '</ol>' +
      '<p class="nota">Más probables que no, pero fallan unas 4 de cada 10 veces. En 2016-2025 acertaron 58% (8 250 picks) con cuota justa media de 1.75. A la larga solo compensan si la casa paga más que la cuota justa.</p></section>';
  }
  // Descartados y dudosos del parte oficial, con la fecha del parte: lo primero que hay que mirar antes de apostar.
  function bajasResumen(p) {
    var sem = P.parte(E.lesiones, p);
    if (!sem) return p.jugado ? '' : '<p class="bajas-res">Todavía no hay parte oficial de lesiones para esta jornada (sale de miércoles a viernes).</p>';
    var fecha = E.lesiones.modificado && E.lesiones.modificado[p.semana], texto = { Out: 'fuera', Doubtful: 'dudoso', Questionable: 'en duda' };
    function eq(t) {
      var js = (sem[t] || []).filter(function (j) { return texto[j.e] && j.p !== 'LS' && j.p !== 'P' && j.p !== 'K'; });
      var fuera = js.filter(function (j) { return j.e !== 'Questionable'; }), qb = js.filter(function (j) { return j.p === 'QB'; });
      return '<span>' + chip(t) + ' ' + fuera.length + ' fuera o dudosos, ' + (js.length - fuera.length) + ' en duda' + (qb.length ? ' · <b>QB ' + esc(qb.map(function (j) { return apellido(j.n) + ' ' + texto[j.e]; }).join(', ')) + '</b>' : '') + '</span>';
    }
    return '<p class="bajas-res">' + eq(p.visita) + eq(p.local) + '<small>Parte oficial de la NFL' + (fecha ? ' del ' + new Date(fecha).toLocaleString('es', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') + (E.lesiones.bajado && !p.jugado ? ', consultado el ' + new Date(E.lesiones.bajado).toLocaleString('es', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') + '. Detalle en «Análisis del partido».</small></p>';
  }
  function comparacion(v, l) {
    var a = resumenEquipo(v), b = resumenEquipo(l), ea = E.jug && E.jug.equipos[v], eb = E.jug && E.jug.equipos[l];
    function pj(x, n) { return n ? (x / n).toFixed(1) : '—'; }
    var filas = [['Marca', a.marca, b.marca], ['Puntos a favor', pj(a.pf, a.n), pj(b.pf, b.n)], ['Puntos en contra', pj(a.pc, a.n), pj(b.pc, b.n)], ['Contra el hándicap', a.handicap, b.handicap]];
    if (ea && eb) filas = filas.concat([['Yardas de pase', pj(ea.pase, ea.g), pj(eb.pase, eb.g)], ['Yardas por tierra', pj(ea.carrera, ea.g), pj(eb.carrera, eb.g)],
      ['Yardas permitidas', pj(ea.paseC + ea.carreraC, ea.g), pj(eb.paseC + eb.carreraC, eb.g)], ['Pérdidas / recuperaciones', ea.perdidas + ' / ' + ea.robos, eb.perdidas + ' / ' + eb.robos]]);
    function forma(r) { return '<span class="forma">' + (r.forma.slice(-5).map(function (f) { return '<i class="f' + f.r + '" data-globo="' + esc(f.t) + '">' + f.r + '</i>'; }).join('') || '—') + '</span>'; }
    return '<table><tr><th class="izq"></th><th>' + v + '</th><th>' + l + '</th></tr>' + filas.map(function (f) { return '<tr><td class="izq">' + f[0] + '</td><td>' + f[1] + '</td><td>' + f[2] + '</td></tr>'; }).join('') +
      '<tr><td class="izq">Últimos 5</td><td>' + forma(a) + '</td><td>' + forma(b) + '</td></tr></table>';
  }
  function lesiones(p) {
    var sem = P.parte(E.lesiones, p);
    if (!sem) return '';
    var texto = { Out: 'descartado', Doubtful: 'dudoso' };
    function lista(eq) {
      var js = (sem[eq] || []).filter(function (j) { return texto[j.e]; });
      return '<section><h4>' + chip(eq) + ' Bajas</h4>' + (js.length ? '<ul class="bajas">' + js.map(function (j) { return '<li>' + esc(j.n) + ' <span>' + esc(j.p) + ' · ' + texto[j.e] + '</span></li>'; }).join('') + '</ul>' : '<p class="nota">Sin descartados.</p>') + '</section>';
    }
    return '<div class="dos">' + lista(p.visita) + lista(p.local) + '</div>';
  }
  function graficos(p, r) {
    var caja = $('dialogo-cuerpo'), sim = simDe(p, r), n = sim.n, margenes = {}, tot = {}, i;
    for (i = 0; i < n; i++) { var d = sim.local[i] - sim.visita[i], t = sim.local[i] + sim.visita[i]; margenes[d] = (margenes[d] || 0) + 1; tot[t] = (tot[t] || 0) + 1; }
    var inH = caja.querySelector('#in-h'), inT = caja.querySelector('#in-t');
    function caso(valor, texto) { return '<div><b>' + valor + '</b><span>' + texto + '</span></div>'; }
    function pintarH() {
      var hv = Number(inH.value) || 0, x = M.cubrir(sim, hv), den = 1 - x.nulo || 1, barras = [], m;
      caja.querySelector('#res-h').innerHTML = '<div class="dos-cifras">' + caso(pct(x.visita / den), P.textoHandicap(p.visita, -hv) + ' · cuota ' + cuota(x.visita / den)) + caso(pct(x.local / den), P.textoHandicap(p.local, hv) + ' · cuota ' + cuota(x.local / den)) + '</div>';
      for (m = -35; m <= 35; m++) {
        var f = (margenes[m] || 0) / n;
        barras.push({ x0: m - 0.5, x1: m + 0.5, v: f, color: m > 0 ? 'var(--local)' : m < 0 ? 'var(--visita)' : 'var(--tinta-3)', texto: (m === 0 ? 'Empate' : (m > 0 ? p.local : p.visita) + ' gana por ' + Math.abs(m)) + ': ' + pct(f, 2) });
      }
      caja.querySelector('#graf-h').innerHTML = histograma({ titulo: 'Diferencia de puntos', barras: barras, min: -35.5, max: 35.5,
        marcas: [-28, -14, 0, 14, 28].map(function (x) { return { x: x, t: x === 0 ? 'empate' : (x < 0 ? p.visita : p.local) + ' por ' + Math.abs(x) }; }), ref: { x: -hv, texto: P.textoHandicap(p.local, hv) } });
    }
    function pintarT() {
      var tv = Number(inT.value) || 0, x = M.totales(sim, tv), den = 1 - x.nulo || 1, barras = [], a;
      caja.querySelector('#res-t').innerHTML = '<div class="dos-cifras">' + caso(pct(x.menos / den), 'menos de ' + tv + ' · cuota ' + cuota(x.menos / den)) + caso(pct(x.mas / den), 'más de ' + tv + ' · cuota ' + cuota(x.mas / den)) + '</div>';
      for (a = 0; a < 90; a += 3) { var f = ((tot[a] || 0) + (tot[a + 1] || 0) + (tot[a + 2] || 0)) / n; barras.push({ x0: a - 0.5, x1: a + 2.5, v: f, color: 'var(--acento)', texto: a + ' a ' + (a + 2) + ' puntos: ' + pct(f, 1) }); }
      caja.querySelector('#graf-t').innerHTML = histograma({ titulo: 'Total de puntos', barras: barras, min: -0.5, max: 89.5, marcas: [10, 20, 30, 40, 50, 60, 70, 80].map(function (x) { return { x: x, t: String(x) }; }), ref: { x: tv, texto: String(tv) } });
    }
    inH.addEventListener('input', pintarH); inT.addEventListener('input', pintarT);
    caja.querySelectorAll('[data-paso]').forEach(function (b) {
      b.addEventListener('click', function () { var en = b.getAttribute('data-paso') === 'h' ? inH : inT; en.value = (Number(en.value) || 0) + Number(b.getAttribute('data-d')); (en === inH ? pintarH : pintarT)(); });
    });
    pintarH(); pintarT();
  }

  // ---------- selector de jornada ----------
  function semanasDe(temporada) {
    var vistas = {}, lista = [];
    E.partidos.forEach(function (p) { if (p.temporada === temporada && !vistas[p.semana]) { vistas[p.semana] = 1; lista.push({ semana: p.semana, texto: RONDAS[p.tipo] || 'Semana ' + p.semana }); } });
    return lista.sort(function (a, b) { return a.semana - b.semana; });
  }
  function cabecera(titulo) {
    var temporadas = [], t, semanas = semanasDe(E.temporada);
    for (t = E.ultima; t >= PRIMERA_TEMPORADA; t--) temporadas.push(t);
    if (!semanas.some(function (s) { return s.semana === E.semana; })) E.semana = semanas[semanas.length - 1].semana;
    var nombreSem = semanas.filter(function (s) { return s.semana === E.semana; })[0].texto;
    return '<div class="cab-vista"><h1>' + titulo + ' <span>' + esc(nombreSem) + ' · ' + E.temporada + '</span></h1><div class="selectores">' +
      '<button class="flecha" data-mover="-1" aria-label="Jornada anterior">‹</button>' +
      '<select id="sel-sem" aria-label="Jornada">' + semanas.map(function (s) { return '<option value="' + s.semana + '"' + (s.semana === E.semana ? ' selected' : '') + '>' + s.texto + '</option>'; }).join('') + '</select>' +
      '<button class="flecha" data-mover="1" aria-label="Jornada siguiente">›</button>' +
      '<select id="sel-temp" aria-label="Temporada">' + temporadas.map(function (x) { return '<option' + (x === E.temporada ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div></div>';
  }
  function activarCabecera() {
    var semanas = semanasDe(E.temporada).map(function (s) { return s.semana; });
    $('sel-temp').onchange = function () { E.temporada = Number(this.value); E.semana = 1; pintar(); };
    $('sel-sem').onchange = function () { E.semana = Number(this.value); pintar(); };
    vista.querySelectorAll('[data-mover]').forEach(function (b) {
      var i = semanas.indexOf(E.semana) + Number(b.getAttribute('data-mover'));
      b.disabled = i < 0 || i >= semanas.length;
      b.onclick = function () { E.semana = semanas[i]; pintar(); };
    });
  }
  function partidosDeJornada() { return E.partidos.filter(function (p) { return p.temporada === E.temporada && p.semana === E.semana; }); }

  // ---------- vista: jornada ----------
  function vistaJornada() {
    var lista = partidosDeJornada(), h = cabecera('Partidos'), dia = null;
    lista.forEach(function (p) {
      var r = pronostico(p), emp = iniciado(p), k = r.top[0];
      if (p.fecha !== dia) { h += (dia ? '</div>' : '') + '<h2 class="dia">' + diaLargo(p.fecha) + '</h2><div class="juegos">'; dia = p.fecha; }
      function eq(t, l, prob, pts) {
        var gana = p.jugado ? (l === 'l' ? p.ptsLocal > p.ptsVisita : p.ptsVisita > p.ptsLocal) : prob >= 0.5;
        return '<span class="j-eq' + (gana ? ' fuerte' : '') + '">' + chip(t) + '<span class="j-n">' + esc(apodo(t)) + '</span><span class="j-r">' + resumenEquipo(t).marca + '</span>' +
          '<span class="j-p">' + pct(prob) + '</span>' + '<span class="j-s">' + (p.jugado ? pts : '') + '</span></span>';
      }
      var estado = p.jugado ? (r.top.length ? '<b>' + r.ok + ' de ' + (r.ok + r.mal) + '</b><span>' + (r.pend ? r.pend + ' por calificar' : 'aciertos') + '</span>' : '<span>Final</span>') :
        emp ? '<b>En juego</b><span>picks fijos</span>' : (r.top.length ? '<b>' + r.top.length + ' picks</b><span>' + (r.riesgo.length ? '+ ' + r.riesgo.length + ' arriesgados' : 'ver') + '</span>' : '<span>ver</span>');
      h += '<button class="juego" data-id="' + p.id + '">' +
        '<span class="j-hora">' + (p.jugado ? 'Final' : emp ? 'En juego' : (p.hora || '—')) + '<small>' + (p.neutral ? 'neutral' : p.jugado || emp ? '' : 'ET') + '</small></span>' +
        '<span class="j-equipos">' + eq(p.visita, 'v', r.pV, p.ptsVisita) + eq(p.local, 'l', r.pL, p.ptsLocal) + '</span>' +
        '<span class="j-linea"><small>Mercado</small>' + lineaTexto(r.linea, r.total, p) + '</span>' +
        '<span class="j-pick">' + (k ? '<small>Mejor pick · ' + pct(k.prob) + (k.ok === true ? ' · acertó' : k.ok === false ? ' · falló' : '') + '</small><span class="' + (k.ok === true ? 'bien' : k.ok === false ? 'mal' : '') + '">' + (k.eq ? chip(k.eq) + ' ' : '') + esc(k.quien) + ' ' + esc(k.que) + '</span>' : '') + '</span>' +
        '<span class="j-estado">' + estado + '</span></button>';
    });
    vista.innerHTML = h + (dia ? '</div>' : '');
    activarCabecera();
    vista.querySelectorAll('.juego').forEach(function (b) { b.onclick = function () { abrirPartido(E.porId[b.getAttribute('data-id')]); }; });
  }

  // ---------- vista: mejores picks de la jornada ----------
  function vistaPicks() {
    var todos = [], riesgo = [];
    partidosDeJornada().forEach(function (p) {
      if (iniciado(p)) return;
      var r = pronostico(p);
      r.top.forEach(function (k) { todos.push(k); });
      r.riesgo.forEach(function (k) { k.riesgo = true; riesgo.push(k); });
    });
    riesgo.sort(function (a, b) { return b.prob - a.prob; });
    todos.sort(function (a, b) { return b.prob - a.prob; });
    var ver = todos.slice(0, 40);
    vista.innerHTML = cabecera('Mejores picks') +
      (ver.length ? '<div class="d-picks"><div class="panel"><h3>Más probables</h3><ol class="picks">' + ver.map(function (k, i) { return filaPick(k, i, true); }).join('') + '</ol></div>' +
        '<div class="panel riesgo"><h3>Arriesgados</h3><ol class="picks">' + riesgo.slice(0, 20).map(function (k, i) { return filaPick(k, i, true); }).join('') + '</ol>' +
        '<p class="nota">De ' + pct(P.RIESGO_MIN) + ' a ' + pct(P.RIESGO_MAX) + ' y pagan ' + P.RIESGO_CUOTA.toFixed(2) + ' o más. En 2016-2025 acertaron 58%.</p></div></div>' +
        '<p class="nota">Los ' + ver.length + ' más probables entre los partidos que faltan. Los picks de un mismo partido están relacionados: si el partido sale distinto de lo esperado, suelen fallar varios a la vez.</p>' :
        '<p class="vacio">No quedan partidos por empezar en esta jornada.</p>');
    activarCabecera();
    vista.querySelectorAll('.pk[data-id]').forEach(function (li) {
      var abrir = function () { abrirPartido(E.porId[li.getAttribute('data-id')]); };
      li.onclick = abrir; li.onkeydown = function (ev) { if (ev.key === 'Enter') abrir(); };
    });
  }

  // ---------- vista: aciertos ----------
  function vistaAciertos() {
    var gan = { n: 0, neto: 0 }, ganArr = { n: 0, neto: 0 }, arr = { n: 0, ok: 0, p: 0 }, semanas = {}, total = { n: 0, ok: 0, p: 0 }, rehechos = { n: 0, ok: 0 }, mejor = { n: 0, ok: 0 }, porTipo = {}, pendientes = 0;
    var NOM = { gana: 'Ganador', handicap: 'Hándicap', total: 'Total de puntos', tds: 'Touchdowns del partido', tdsEquipo: 'Touchdowns de un equipo', yardas: 'Yardas de jugador', tdPase: 'Pases de touchdown' };
    Object.keys(E.hist).forEach(function (id) {
      var p = E.porId[id]; if (!p || !iniciado(p)) return;
      var r = pronostico(p), reg = r.reg, clave = reg.temporada * 100 + reg.semana;
      var s = semanas[clave] = semanas[clave] || { t: reg.temporada, sem: reg.semana, juegos: [], n: 0, ok: 0, p: 0 };
      s.juegos.push(p);
      if (!reg.reconstruido) r.riesgo.forEach(function (k) {
        if (k.ok !== true && k.ok !== false) return;
        arr.n++; arr.ok += k.ok ? 1 : 0; arr.p += k.prob;
        if (k.cuotaReal) { ganArr.n++; ganArr.neto += k.ok ? k.cuotaReal - 1 : -1; }
      });
      r.top.forEach(function (k, i) {
        if (k.ok === undefined) { pendientes++; return; }
        if (k.ok === null) return;
        if (reg.reconstruido) { rehechos.n++; rehechos.ok += k.ok ? 1 : 0; return; }
        total.n++; total.ok += k.ok ? 1 : 0; total.p += k.prob;
        s.n++; s.ok += k.ok ? 1 : 0; s.p += k.prob;
        var t = porTipo[k.m.m] = porTipo[k.m.m] || { n: 0, ok: 0, p: 0 }; t.n++; t.ok += k.ok ? 1 : 0; t.p += k.prob;
        if (i === 0) { mejor.n++; mejor.ok += k.ok ? 1 : 0; }
        if (k.cuotaReal) { gan.n++; gan.neto += k.ok ? k.cuotaReal - 1 : -1; } // solo como dato: no se usa para elegir picks
      });
    });
    // Lo que se habría ganado apostando 1 unidad a cada pick con cuota real de la casa. Solo informativo.
    function ganancia(t, a, b) {
      function txt(o) { return o.n ? (o.neto >= 0 ? '+' : '−') + Math.abs(o.neto / o.n).toFixed(2) : '—'; }
      return '<div class="cifra"><span>' + t + '</span><b>' + txt(a) + '</b><small>' + a.n + ' picks con cuota real' + (b.n ? ' · arriesgados ' + txt(b) + ' en ' + b.n : '') + ' · solo como dato, no se usa para elegir picks</small></div>';
    }
    function cifra(t, o, sub) { return '<div class="cifra"><span>' + t + '</span><b>' + (o.n ? pct(o.ok / o.n) : '—') + '</b><small>' + sub + '</small></div>'; }
    var claves = Object.keys(semanas).map(Number).sort(function (a, b) { return b - a; });
    var h = '<div class="cab-vista"><h1>Aciertos <span>picks guardados antes de cada partido</span></h1></div>' +
      '<div class="cifras">' + cifra('Picks acertados', total, total.ok + ' de ' + total.n + (total.n ? ' · anunciaban ' + pct(total.p / total.n) : '')) +
      cifra('Mejor pick de cada partido', mejor, mejor.ok + ' de ' + mejor.n) +
      cifra('Arriesgados', arr, arr.n ? arr.ok + ' de ' + arr.n + ' · anunciaban ' + pct(arr.p / arr.n) : 'desde la semana 12') +
      ganancia('Ganancia por unidad, cuota real', gan, ganArr) +
      (E.valid ? '<div class="cifra"><span>Misma regla, ' + E.valid.desde + '–' + E.valid.hasta + '</span><b>' + pct(E.valid.mostrados.acierto, 1) + '</b><small>' + E.valid.mostrados.n.toLocaleString('es') + ' picks de partido en ' + E.valid.partidos.toLocaleString('es') + ' partidos</small></div>' : '') + '</div>';
    h += '<div class="dos"><div class="panel"><h3>Por jornada</h3><table><tr><th class="izq">Jornada</th><th>Partidos</th><th>Picks</th><th>Acertados</th><th>Acierto</th><th>Anunciaban</th></tr>' +
      claves.filter(function (c) { return semanas[c].n; }).map(function (c) { var s = semanas[c]; return '<tr><td class="izq">Semana ' + s.sem + '</td><td>' + s.juegos.length + '</td><td>' + s.n + '</td><td>' + s.ok + '</td><td><b>' + pct(s.ok / s.n) + '</b></td><td>' + pct(s.p / s.n) + '</td></tr>'; }).join('') + '</table></div>' +
      '<div class="panel"><h3>Por tipo de pick</h3><table><tr><th class="izq">Tipo</th><th>Picks</th><th>Acierto</th><th>Anunciaban</th><th class="izq">Corrección</th></tr>' +
      Object.keys(porTipo).sort(function (a, b) { return porTipo[b].n - porTipo[a].n; }).map(function (t) {
        var o = porTipo[t], c = E.ctx.correccion[t] || { n: 0 }, est = c.factor != null ? 'activa: se acercan al ' + pct(c.real) :
          c.n >= P.MIN_CORRECCION ? 'no hace falta' : 'con ' + P.MIN_CORRECCION + ' picks (van ' + c.n + ')';
        return '<tr><td class="izq">' + (NOM[t] || t) + '</td><td>' + o.n + '</td><td><b>' + pct(o.ok / o.n) + '</b></td><td>' + pct(o.p / o.n) + '</td><td class="izq"><small>' + est + '</small></td></tr>'; }).join('') +
      '</table><p class="nota">Solo picks congelados y calificados, sin rehechos. Cuando un tipo llega a ' + P.MIN_CORRECCION + ' y acierta menos de lo que anuncia, sus probabilidades se acercan a lo que de verdad acierta; si así bajan del ' + pct(P.MINIMO) + ', dejan de mostrarse.</p></div></div>';
    claves.forEach(function (c, i) {
      var s = semanas[c];
      h += '<details class="panel semana"' + (i === 0 ? ' open' : '') + '><summary>Semana ' + s.sem + ' · ' + s.t + (s.n ? ' <span>' + s.ok + ' de ' + s.n + ' · ' + pct(s.ok / s.n) + '</span>' : '') + '</summary>' +
        '<div class="desborde"><table><tr><th class="izq">Partido</th><th>Final</th><th class="izq">Mejor pick</th><th>Prob.</th><th>Resultado</th><th>Picks</th></tr>' +
        s.juegos.map(function (p) {
          var r = pronostico(p), k = r.top[0];
          return '<tr data-id="' + p.id + '"><td class="izq">' + chip(p.visita) + ' en ' + chip(p.local) + '</td><td>' + (p.jugado ? p.ptsVisita + '–' + p.ptsLocal : 'en juego') + '</td><td class="izq">' + (k ? esc(k.quien) + ' ' + esc(k.que) : '—') +
            (r.reg.reconstruido ? ' <em>rehecho</em>' : '') + '</td><td>' + (k ? pct(k.prob) : '') + '</td><td>' + (k ? estadoPick(k) || '<span class="res">pendiente</span>' : '') + '</td><td>' + r.ok + ' de ' + (r.ok + r.mal) + (r.pend ? ' <small>+' + r.pend + ' pend.</small>' : '') + '</td></tr>';
        }).join('') + '</table></div></details>';
    });
    h += '<p class="nota">Se cuentan solo los picks que se muestran: los 10 mejores de cada partido. Las semanas 8 a 11 se guardaron con la versión anterior del modelo; de esas se cuentan los picks que cumplen la regla actual' +
      (rehechos.n ? '. Los rehechos después del partido no entran en el total: ' + rehechos.ok + ' de ' + rehechos.n + ' (' + pct(rehechos.ok / rehechos.n) + ')' : '') + '.' +
      (pendientes ? ' ' + pendientes + ' picks esperan las estadísticas oficiales para calificarse.' : '') + '</p>';
    vista.innerHTML = h;
    vista.querySelectorAll('tr[data-id]').forEach(function (tr) { tr.onclick = function () { abrirPartido(E.porId[tr.getAttribute('data-id')]); }; });
  }

  // ---------- vista: equipos ----------
  function vistaEquipos() {
    var s = E.estado;
    var filas = Object.keys(EQ).filter(function (t) { return t in s.ataque; }).map(function (t) {
      var q = s.titular[t], vq = q && q.id in s.qb ? s.qb[q.id] : 0;
      return { t: t, q: q ? q.nombre : '—', vq: vq, a: s.ataque[t], d: s.defensa[t], n: s.ataque[t] + s.defensa[t] + vq, r: resumenEquipo(t) };
    }).sort(function (a, b) { return b.n - a.n; });
    var max = Math.max.apply(null, filas.map(function (f) { return Math.abs(f.n); }));
    vista.innerHTML = '<div class="cab-vista"><h1>Equipos <span>calificación del modelo frente a un equipo promedio, en puntos</span></h1></div>' +
      '<div class="panel desborde"><table><tr><th>#</th><th class="izq">Equipo</th><th>Marca</th><th>A favor</th><th>En contra</th><th>Hándicap</th><th>Ataque</th><th class="izq">Quarterback</th><th>Defensa</th><th>Total</th><th class="izq"></th></tr>' +
      filas.map(function (f, i) {
        var w = Math.abs(f.n) / max * 60, r = f.r;
        return '<tr><td>' + (i + 1) + '</td><td class="izq">' + chip(f.t) + ' ' + esc(nombre(f.t)) + '</td><td>' + r.marca + '</td><td>' + (r.n ? (r.pf / r.n).toFixed(1) : '—') + '</td><td>' + (r.n ? (r.pc / r.n).toFixed(1) : '—') + '</td><td>' + r.handicap +
          '</td><td>' + signo1(f.a) + '</td><td class="izq">' + esc(f.q) + ' <span class="nota">' + signo1(f.vq) + '</span></td><td>' + signo1(f.d) + '</td><td><b>' + signo1(f.n) + '</b></td>' +
          '<td class="izq barrita"><span>' + (f.n < 0 ? '<i style="width:' + w + 'px"></i>' : '') + '</span><span>' + (f.n >= 0 ? '<i style="width:' + w + 'px"></i>' : '') + '</span></td></tr>';
      }).join('') + '</table></div><p class="nota">Ataque: lo que anota de más sin contar a su quarterback. Defensa: lo que le quita al rival. Hándicap: partidos en que cubrió la línea del mercado. Ventaja de local estimada: ' + n1(s.local) + ' puntos.</p>';
  }

  // ---------- vista: método ----------
  function vistaMetodo() {
    var v = E.valid, h = '<div class="cab-vista"><h1>Método <span>cómo se eligen los picks y qué tan bien aciertan</span></h1></div>';
    if (v) {
      h += '<div class="cifras"><div class="cifra"><span>Picks de partido mostrados, ' + v.desde + '–' + v.hasta + '</span><b>' + pct(v.mostrados.acierto, 1) + '</b><small>' + v.mostrados.n.toLocaleString('es') + ' picks · anunciaban ' + pct(v.mostrados.esperado, 1) + '</small></div>' +
        '<div class="cifra"><span>Partidos probados</span><b>' + v.partidos.toLocaleString('es') + '</b><small>cada uno solo con lo que se sabía antes de jugarse</small></div>' +
        '<div class="cifra"><span>Parámetros elegidos con</span><b>' + (v.ajustadoCon || '2016-2022') + '</b><small>el acierto de arriba es solo de ' + v.desde + '-' + v.hasta + ', años que no se usaron para elegir</small></div></div>' +
        '<div class="dos"><div class="panel"><h3>Lo que se dijo contra lo que pasó</h3>' + calibracion(v.calibracion, 'probabilidad anunciada', 0.5) +
        '<p class="nota">Todos los picks de partido calculados en la prueba, también los que no se muestran. Si los puntos caen sobre la diagonal, un 75% ocurre cerca del 75% de las veces.</p></div>' +
        '<div class="panel"><h3>Picks mostrados, por tipo</h3><table><tr><th class="izq">Tipo</th><th>Picks</th><th>Acierto</th><th>Anunciaban</th></tr>' +
        v.tipos.map(function (t) { return '<tr><td class="izq">' + t.tipo + '</td><td>' + t.n.toLocaleString('es') + '</td><td><b>' + pct(t.acierto, 1) + '</b></td><td>' + pct(t.esperado, 1) + '</td></tr>'; }).join('') +
        '</table><h3 style="margin-top:20px">Por temporada</h3><div class="desborde"><table class="temporadas"><tr>' + v.temporadas.map(function (t) { return '<th>' + t.temporada + '</th>'; }).join('') + '</tr><tr>' + v.temporadas.map(function (t) { return '<td>' + pct(t.acierto) + '</td>'; }).join('') + '</tr></table></div>' +
        '<p class="nota">Las yardas de jugadores se validan aparte: 75-78% en 2023-2026 con la regla de los últimos 10 partidos.</p></div></div>';
    }
    h += '<div class="dos"><div class="panel texto"><h3>Cómo funciona</h3><ol>' +
      '<li><b>Puntos esperados.</b> El modelo califica a cada equipo y a su quarterback con todos los partidos desde 2010, la eficiencia por jugada y el parte de lesiones. Pero para los picks se usan los puntos que implica la línea de las casas de apuestas: al elegir el peso solo con 2016-2022, la línea sola predijo mejor que cualquier mezcla con el modelo, y también fue la mejor en 2023-2025, que no se usaron para elegir. El modelo queda para cuando no hay línea y como referencia en el análisis.</li>' +
      '<li><b>Simulación.</b> Cada partido se juega ' + SIMS.toLocaleString('es') + ' veces, serie ofensiva por serie: touchdowns, goles de campo, puntos extra, decisiones de final de partido y prórroga.</li>' +
      '<li><b>Líneas de la casa.</b> El día de cada partido se bajan las líneas y cuotas reales de una casa grande (ganador, hándicaps y totales alternativos; las yardas de jugadores, desde el día anterior). Los picks se eligen solo entre esas líneas: de cada mercado, la más probable que todavía paga al menos ' + P.CUOTA_MINIMA.toFixed(2) + '. Antes de ese día se muestran con líneas estimadas.</li>' +
      '<li><b>Los de cada partido.</b> Solo picks de al menos ' + pct(P.MINIMO) + ' que paguen ' + P.CUOTA_MINIMA.toFixed(2) + ' o más, del más al menos probable, hasta 10. Cada uno lleva su razón: lo que dicen las simulaciones, el mercado y lo que llevan los equipos o el jugador este año.</li>' +
      '<li><b>Jugadores.</b> Se proponen con anticipación, con línea estimada (la mediana de sus últimos 10 partidos), y pasan a la línea real de la casa en las 24 horas previas; si la casa no ofrece al jugador, su pick se cae. Su probabilidad está calibrada, pero esa calibración (70% de acierto en los picks de 65% o más) se validó contra la línea estimada, no contra la de la casa. Contra la línea real el modelo resultó sobreconfiado: 87 picks congelados de las semanas 10 y 11 anunciaban 56% y acertaron 42.5%, menos de lo que implicaba la casa (~51%). Por eso, con línea real, la probabilidad es el promedio del modelo y la de la casa sin su margen, y si no llega al mínimo no hay pick. Disponibilidad: cada 20 minutos se revisa el último parte de lesiones y entrenamientos. En 2023-2025, entre jugadores con rol: sin estado y entrenando jugó el 93%; en duda, 47-81%; sin estado pero sin entrenar por lesión, 33%; dudoso o fuera, 0-8%. Por eso no reciben pick los que están en duda, dudosos, fuera o sin entrenar por lesión.</li>' +
      '<li><b>Información al día.</b> Cada 20 minutos se vuelven a bajar el parte oficial de lesiones, los quarterbacks anunciados y los marcadores. En las 4 horas previas al partido se toma la línea vigente de la casa, que ya recoge las noticias de última hora (lesiones, clima, cambios de titular), y con ella se recalcula todo. Si un jugador deja de estar disponible antes de que los picks queden fijos, su pick se cae.</li>' +
      '<li><b>Arriesgados.</b> Hasta 3 por partido, entre ' + pct(P.RIESGO_MIN) + ' y ' + pct(P.RIESGO_MAX) + ' y con cuota de ' + P.RIESGO_CUOTA.toFixed(2) + ' o más, en los mismos mercados. Con líneas reales se elige la que más devuelve (probabilidad × cuota). En 2016-2025 acertaron 58.2% anunciando 57.2% (8 250 picks), con cuota justa media de 1.75.</li>' +
      '<li><b>Registro.</b> Quedan fijos 10 minutos antes del inicio. Ganador, hándicap y total se califican en cuanto hay marcador; touchdowns y jugadores, cuando salen las estadísticas oficiales.</li></ol></div>' +
      '<div class="panel texto"><h3>Qué se descartó y por qué</h3><ul>' +
      '<li>Picks contra la línea principal del mercado (hándicap, total o puntos de un equipo en la línea de la casa): acertaban entre 46% y 52%.</li>' +
      '<li>Picks de 58% a 65%: acertaban menos de lo que anunciaban.</li>' +
      '<li>Goles de campo: entre 55% y 69% según la época, demasiado inestable.</li>' +
      '<li>Anotador de touchdown y «menos de 1.5 pases de touchdown»: casi nunca pasan del 55%.</li>' +
            '<li>Touchdowns del partido o de un equipo e hitos de yardas tipo «25+»: las casas solo ofrecen la línea principal, donde la probabilidad ronda el 50%, así que no hay pick que coincida con lo que se puede apostar.</li>' +
      '<li>Todos los «menos» (puntos del partido, touchdowns del partido y de un equipo): «menos de X puntos» es el mercado más flojo en todas las épocas (72% en 2016-2025, 70% en 2026, 5 de 9 en la semana 11) y desde 2024 los partidos terminan por encima del total de las casas el 52-54% de las veces. Un partido abierto los tumba todos a la vez.</li>' +
      '<li>El modelo no lee noticias. Lo que sabe el mercado (cambios de rol, clima, rumores) entra a través de su línea.</li>' +
      '<li>También se probó exigir que el equipo ya viniera cumpliendo la línea en sus últimos partidos (como con los jugadores) y corregir el sesgo reciente de los totales: ninguna de las dos mejoró la prueba, así que no se aplican.</li>' +
      '<li>Ningún pick es seguro: un 75% falla una de cada cuatro veces, y los picks de un mismo partido suelen fallar juntos.</li></ul></div></div>';
    vista.innerHTML = h;
  }

  // ---------- navegación ----------
  var VISTAS = { jornada: vistaJornada, picks: vistaPicks, aciertos: vistaAciertos, equipos: vistaEquipos, metodo: vistaMetodo };
  function pintar() {
    document.querySelectorAll('.nav button').forEach(function (b) { b.setAttribute('aria-current', b.getAttribute('data-vista') === E.vista ? 'page' : 'false'); });
    VISTAS[E.vista]();
  }
  document.querySelectorAll('.nav button').forEach(function (b) { b.onclick = function () { E.vista = b.getAttribute('data-vista'); pintar(); window.scrollTo(0, 0); }; });
  $('cerrar').onclick = function () { $('dialogo').close(); };
  $('dialogo').addEventListener('click', function (ev) { if (ev.target === this) this.close(); });

  cargar().then(pintar).catch(function (e) {
    vista.innerHTML = '<p class="vacio">No se pudieron cargar los datos (' + esc(e.message) + '). Comprueba tu conexión y vuelve a abrir la página.</p>';
    $('estado-datos').textContent = 'Sin datos';
  });
})();
