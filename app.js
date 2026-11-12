/* Interfaz del simulador NFL. El cálculo vive en modelo.js. */
(function () {
  'use strict';
  var M = window.ModeloNFL;
  var URL_VIVO = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
  var URL_COPIA = 'datos/partidos.csv';
  var PRIMERA_TEMPORADA_VISIBLE = 2016;

  var EQUIPOS = {
    ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers',
    CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos',
    DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars',
    KC: 'Kansas City Chiefs', LA: 'Los Angeles Rams', LAC: 'Los Angeles Chargers', LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins',
    MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets',
    PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers',
    TEN: 'Tennessee Titans', WAS: 'Washington Commanders'
  };
  var RONDAS = { WC: 'Comodines', DIV: 'Ronda divisional', CON: 'Finales de conferencia', SB: 'Super Bowl' };

  var E = { partidos: [], estado: null, vista: 'jornada', temporada: null, semana: null, origen: '', cache: {}, libre: null, precision: null, lesiones: null, ajustes: {} };
  var $ = function (id) { return document.getElementById(id); };
  var vista = $('vista');

  // ---------- utilidades ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(p, d) { return (p * 100).toFixed(d == null ? 1 : d) + '%'; }
  function n1(x) { return x.toFixed(1); }
  function signo(x) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toString(); }
  function signo1(x) { var t = Math.abs(x).toFixed(1); return (t === '0.0' ? '' : x > 0 ? '+' : '−') + t; }
  function cuota(p) { return p > 0.0005 ? (1 / p).toFixed(2) : '—'; }
  function nombre(t) { return EQUIPOS[t] || t; }
  function fecha(p) {
    var d = new Date(p.fecha + 'T12:00:00');
    var s = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
    return s + (p.hora ? ' · ' + p.hora + ' ET' : '');
  }
  function medio(x) { return Math.round(x * 2) / 2; }
  // Hándicap del local en formato de casa de apuestas: favorito con signo menos.
  function textoHandicap(equipo, h) { return equipo + ' ' + (h === 0 ? 'PK' : signo(h)); }
  function favorito(p, margen) {
    var m = medio(margen);
    return m === 0 ? 'Parejo' : m > 0 ? textoHandicap(p.local, -m) : textoHandicap(p.visita, m);
  }

  // ---------- datos ----------
  function traer(url, ms) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(url, { signal: ctl.signal, cache: 'no-store' }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.text();
    });
  }
  function cargar() {
    // En vivo: marcadores, líneas y quarterbacks al minuto. Copia del sitio: además trae eficiencia (EPA) y lesiones.
    var nada = function () { return null; };
    return Promise.all([
      traer(URL_VIVO, 9000).catch(nada), traer(URL_COPIA, 15000).catch(nada),
      traer('datos/lesiones.json', 15000).then(JSON.parse).catch(nada)
    ]).then(function (r) {
        if (!r[0] && !r[1]) throw new Error('sin conexión con los datos');
        var copia = r[1] ? M.leerCSV(r[1]) : null;
        E.origen = r[0] ? (copia ? 'en vivo desde nflverse' : 'en vivo desde nflverse (sin eficiencia ni lesiones)') : 'copia guardada en el sitio';
        E.lesiones = r[2];
        E.partidos = M.prepararPartidos(r[0] ? M.leerCSV(r[0]) : copia, 2010, r[0] ? copia : null);
        if (!E.partidos.length) throw new Error('sin partidos');
        E.estado = M.calificar(E.partidos);
        var jugados = E.partidos.filter(function (p) { return p.jugado; });
        var ultimo = jugados[jugados.length - 1];
        E.temporada = E.partidos[E.partidos.length - 1].temporada;
        var pendiente = E.partidos.filter(function (p) { return p.temporada === E.temporada && !p.jugado; })[0];
        E.semana = pendiente ? pendiente.semana : ultimo.semana;
        $('estado-datos').textContent = jugados.length.toLocaleString('es') + ' partidos reales desde 2010 · último: ' +
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

  // ---------- globo de ayuda para los gráficos ----------
  var globo = $('globo');
  document.addEventListener('mousemove', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-globo]');
    if (!t) { globo.hidden = true; return; }
    globo.textContent = t.getAttribute('data-globo'); globo.hidden = false;
    var x = Math.min(ev.clientX + 12, window.innerWidth - globo.offsetWidth - 8);
    globo.style.left = x + 'px'; globo.style.top = (ev.clientY - globo.offsetHeight - 10 < 0 ? ev.clientY + 16 : ev.clientY - globo.offsetHeight - 10) + 'px';
  });

  /* Histograma en SVG. barras: [{x0, x1, v, color, texto}], ref: {x, texto}, marcas: [x], */
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

  // ---------- detalle de un cruce (se usa en el diálogo y en "Cruce libre") ----------
  // c: {visita, local, neutral, partido|null, pred (del modelo), ajuste (objeto editable), calcular() → {sim, esp}}
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
    var pm = p ? M.sinMargen(p.mlLocal, p.mlVisita) : null;

    var h = '<h2>' + esc(nombre(c.visita)) + ' en ' + esc(nombre(c.local)) + '</h2>';
    h += '<p class="tenue">' + (p ? esc(fecha(p)) + (p.estadio ? ' · ' + esc(p.estadio) : '') + (p.neutral ? ' · campo neutral' : '') : (c.neutral ? 'Campo neutral' : 'En casa de ' + esc(nombre(c.local)))) +
'</p>';
    if (p && p.jugado) h += '<p><span class="etiqueta">Resultado real</span> <b>' + p.visita + ' ' + p.ptsVisita + ' – ' + p.ptsLocal + ' ' + p.local + '</b>' + (p.prorroga ? ' (prórroga)' : '') +
      ' <span class="tenue">· lo de abajo es lo que se estimaba antes del partido</span></p>';
    h += '<div class="cifras">' +
      '<div class="cifra"><div class="t"><i class="punto v"></i>Gana ' + c.visita + '</div><div class="v">' + pct(sim.pVisita) + '</div><div class="s">cuota justa ' + cuota(sim.pVisita) + '</div></div>' +
      '<div class="cifra"><div class="t"><i class="punto l"></i>Gana ' + c.local + '</div><div class="v">' + pct(sim.pLocal) + '</div><div class="s">cuota justa ' + cuota(sim.pLocal) + '</div></div>' +
      '<div class="cifra"><div class="t">Marcador medio</div><div class="v">' + n1(sim.mediaVisita) + ' – ' + n1(sim.mediaLocal) + '</div><div class="s">' + c.visita + ' – ' + c.local + ' · total ' + n1(sim.mediaVisita + sim.mediaLocal) + '</div></div>' +
      '<div class="cifra"><div class="t">Prórroga / empate</div><div class="v">' + pct(sim.pProrroga) + '</div><div class="s">termina empatado ' + pct(sim.pEmpate, 2) + '</div></div>' +
      '</div>';
    h += '<p class="tenue">' + n.toLocaleString('es') + ' simulaciones · puntos esperados ' + c.visita + ' ' + n1(esp.visita) + ', ' + c.local + ' ' + n1(esp.local) +
      ' (' + ({ modelo: 'modelo estadístico', mezcla: 'mezcla modelo + mercado', mercado: 'línea del mercado' })[esp.fuente] + ')' +
      (p && p.linea != null ? ' · mercado: ' + favorito(p, p.linea) + ', total ' + p.lineaTotal + (pm != null ? ', gana ' + p.local + ' ' + pct(pm, 0) + ' según cuotas sin margen' : '') : '') + '</p>';

    h += '<div class="dos"><section class="tarjeta"><h3>Hándicap</h3>' +
      '<label>Hándicap de ' + c.local + ' (negativo = favorito)<span class="paso"><button data-paso="h" data-d="-0.5" aria-label="Bajar medio punto">−</button><input type="number" step="0.5" id="in-h" value="' + hIni + '"><button data-paso="h" data-d="0.5" aria-label="Subir medio punto">+</button></span></label>' +
      '<div id="res-h"></div><div class="leyenda"><span><i class="punto v"></i>gana ' + c.visita + '</span><span><i class="punto l"></i>gana ' + c.local + '</span></div><div id="graf-h"></div>' +
      '<details><summary>Ver hándicaps alternativos en tabla</summary><div class="desborde" id="tabla-h"></div></details></section>';
    h += '<section class="tarjeta"><h3>Total de puntos</h3>' +
      '<label>Línea de más/menos<span class="paso"><button data-paso="t" data-d="-0.5" aria-label="Bajar medio punto">−</button><input type="number" step="0.5" id="in-t" value="' + tIni + '"><button data-paso="t" data-d="0.5" aria-label="Subir medio punto">+</button></span></label>' +
      '<div id="res-t"></div><div class="leyenda"><span><i class="punto t"></i>puntos entre los dos equipos</span></div><div id="graf-t"></div>' +
      '<details><summary>Ver marcadores más repetidos</summary><table><tr><th>Marcador (' + c.visita + '–' + c.local + ')</th><th>Frecuencia</th></tr>' +
      top.map(function (k) { return '<tr><td>' + k + '</td><td>' + pct(marcadores[k] / n, 2) + '</td></tr>'; }).join('') + '</table></details></section></div>';
    // Factores: de dónde salen los puntos esperados de cada equipo.
    function pts(x) { return Math.abs(x) < 0.05 ? '0' : signo1(x); }
    function nBajas(b) { return b ? b.at + b.li + b.de : 0; }
    var qv = c.qbVisita || '—', ql = c.qbLocal || '—';
    var filasF = [
      ['Calificación del equipo contra la del rival', n1(F.baseVisita), n1(F.baseLocal)],
      ['Quarterback: ' + esc(qv) + ' / ' + esc(ql), pts(F.qbVisita), pts(F.qbLocal)],
      ['Jugar en casa', pts(-F.casa / 2), pts(F.casa / 2)],
      ['Descanso (semana libre previa)', pts(-F.descanso / 2), pts(F.descanso / 2)],
      ['Estadio techado', pts(F.techo / 2), pts(F.techo / 2)],
      ['Lesiones' + (p ? ' (' + nBajas(p.bajasVisita) + ' y ' + nBajas(p.bajasLocal) + ' descartados)' : ''), pts(F.bajasVisita), pts(F.bajasLocal)]
    ];
    if (esp.fuente !== 'modelo') filasF.push(['Corrección hacia la línea del mercado', pts(esp.visita - (Number(aj.visita) || 0) + esp.viento / 2 - c.pred.visita), pts(esp.local - (Number(aj.local) || 0) + esp.viento / 2 - c.pred.local)]);
    if (aj.visita || aj.local || esp.viento) filasF.push(['Tu ajuste manual' + (esp.viento ? ' y viento' : ''), pts((Number(aj.visita) || 0) - esp.viento / 2), pts((Number(aj.local) || 0) - esp.viento / 2)]);
    h += '<div class="dos"><section class="tarjeta"><h3>De dónde salen los puntos esperados</h3><div class="desborde"><table><tr><th>Factor</th><th>' + c.visita + '</th><th>' + c.local + '</th></tr>' +
      filasF.map(function (f) { return '<tr><td>' + f[0] + '</td><td>' + f[1] + '</td><td>' + f[2] + '</td></tr>'; }).join('') +
      '<tr><td><b>Puntos esperados</b></td><td><b>' + n1(esp.visita) + '</b></td><td><b>' + n1(esp.local) + '</b></td></tr></table></div>' +
      (p ? parteLesiones(p) : '') + '</section>' +
      '<section class="tarjeta"><h3>Tu información</h3><p class="tenue">¿Sabes algo que los datos todavía no reflejan (una baja de última hora, un cambio de entrenador, mal clima)? Súmale o réstale puntos a cada equipo y la simulación se repite.</p>' +
      '<div class="fila"><label>Puntos para ' + c.visita + '<input type="number" step="0.5" id="aj-v" value="' + (aj.visita || 0) + '" style="width:90px"></label>' +
      '<label>Puntos para ' + c.local + '<input type="number" step="0.5" id="aj-l" value="' + (aj.local || 0) + '" style="width:90px"></label>' +
      (p && p.bajoTecho ? '' : '<label>Viento previsto (km/h)<input type="number" step="1" min="0" id="aj-w" value="' + (aj.viento || 0) + '" style="width:90px"></label>') +
      '<button id="aj-ok">Aplicar y simular</button><button id="aj-0">Quitar ajustes</button></div>' +
      '<p class="tenue">Referencias: perder a un quarterback titular de élite suele valer entre 4 y 7 puntos; un receptor o corredor estrella, cerca de 1. El viento solo resta puntos por encima de 16 km/h.</p></section></div>';
    caja.innerHTML = h;
    function reajustar() {
      aj.visita = Number(caja.querySelector('#aj-v').value) || 0; aj.local = Number(caja.querySelector('#aj-l').value) || 0;
      var w = caja.querySelector('#aj-w'); aj.viento = w ? Number(w.value) || 0 : 0;
      c.vista = {}; pintarDetalle(caja, c); if (c.alCambiar) c.alCambiar();
    }
    caja.querySelector('#aj-ok').addEventListener('click', reajustar);
    ['aj-v', 'aj-l', 'aj-w'].forEach(function (id) { var el = caja.querySelector('#' + id); if (el) el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') reajustar(); }); });
    caja.querySelector('#aj-0').addEventListener('click', function () { aj.visita = aj.local = aj.viento = 0; c.vista = {}; pintarDetalle(caja, c); if (c.alCambiar) c.alCambiar(); });

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

  function parteLesiones(p) {
    var L = E.lesiones, sem = L && L.temporada === p.temporada && L.semanas ? L.semanas[p.semana] : null;
    if (!sem) return '<p class="tenue" style="margin-top:8px">' + (p.jugado ? 'Parte de lesiones de esta jornada no guardado en el sitio; las bajas sí están contadas arriba.' :
      'Todavía no hay parte oficial de lesiones para esta jornada (se publica entre miércoles y viernes). Hasta entonces las lesiones cuentan 0.') + '</p>';
    var orden = { Out: 0, Doubtful: 1, Questionable: 2 }, texto = { Out: 'descartado', Doubtful: 'dudoso', Questionable: 'en duda' };
    function lista(eq) {
      var js = (sem[eq] || []).slice().sort(function (a, b) { return orden[a.e] - orden[b.e]; });
      return '<p style="margin:8px 0 2px"><b>' + eq + '</b></p>' + (js.length ? '<ul class="lista">' + js.map(function (j) {
        return '<li>' + esc(j.n) + ' (' + esc(j.p) + ') · ' + (texto[j.e] || esc(j.e)) + (j.l ? ' · ' + esc(j.l) : '') + '</li>'; }).join('') + '</ul>' : '<p class="tenue">Sin jugadores en el parte.</p>');
    }
    return '<details><summary>Ver parte oficial de lesiones</summary>' + lista(p.visita) + lista(p.local) +
      '<p class="tenue">El modelo descuenta a los descartados y dudosos (nombres en inglés tal como los publica la liga); los quarterbacks se valoran aparte.</p></details>';
  }

  // ---------- vista: jornada ----------
  function semanasDe(temporada) {
    var vistas = {}, lista = [];
    E.partidos.forEach(function (p) {
      if (p.temporada === temporada && !vistas[p.semana]) { vistas[p.semana] = 1; lista.push({ semana: p.semana, texto: RONDAS[p.tipo] || 'Semana ' + p.semana }); }
    });
    return lista.sort(function (a, b) { return a.semana - b.semana; });
  }
  function vistaJornada() {
    var temporadas = [], t;
    for (t = E.partidos[E.partidos.length - 1].temporada; t >= PRIMERA_TEMPORADA_VISIBLE; t--) temporadas.push(t);
    var semanas = semanasDe(E.temporada);
    if (!semanas.some(function (s) { return s.semana === E.semana; })) E.semana = semanas[semanas.length - 1].semana;
    var lista = E.partidos.filter(function (p) { return p.temporada === E.temporada && p.semana === E.semana; });
    var h = '<div class="fila"><label>Temporada<select id="sel-temp">' + temporadas.map(function (x) { return '<option' + (x === E.temporada ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
      '<label>Jornada<select id="sel-sem">' + semanas.map(function (s) { return '<option value="' + s.semana + '"' + (s.semana === E.semana ? ' selected' : '') + '>' + s.texto + '</option>'; }).join('') + '</select></label>' +
      '<span class="tenue">Toca un partido para ver hándicaps, totales y la distribución completa.</span></div><div class="rejilla">';
    lista.forEach(function (p, i) {
      var r = simPartido(p), s = r.sim, e = r.esp;
      var acierto = '';
      if (p.jugado) {
        var gano = p.ptsLocal > p.ptsVisita ? 'l' : p.ptsLocal < p.ptsVisita ? 'v' : 'e', fav = s.pLocal >= s.pVisita ? 'l' : 'v';
        acierto = gano === 'e' ? '<span class="etiqueta">Empate</span>' : gano === fav ? '<span class="etiqueta bien">✓ acertó el favorito</span>' : '<span class="etiqueta mal">✗ ganó el no favorito</span>';
      }
      h += '<button class="partido" data-i="' + i + '"><div class="arriba"><span>' + esc(fecha(p)) + (p.neutral ? ' · neutral' : '') + '</span><span>' + (p.jugado ? 'Final' : 'Por jugar') + '</span></div>' +
        '<div class="equipos"><span class="nombre"><i class="punto v"></i>' + esc(nombre(p.visita)) + (p.jugado ? ' <b class="num">' + p.ptsVisita + '</b>' : '') + '</span><span class="pct">' + pct(s.pVisita, 0) + '</span>' +
        '<span class="nombre"><i class="punto l"></i>' + esc(nombre(p.local)) + (p.jugado ? ' <b class="num">' + p.ptsLocal + '</b>' : '') + '</span><span class="pct">' + pct(s.pLocal, 0) + '</span></div>' +
        '<div class="barra" data-globo="' + p.visita + ' ' + pct(s.pVisita) + ' · ' + p.local + ' ' + pct(s.pLocal) + ' · empate ' + pct(s.pEmpate, 2) + '"><i class="v" style="flex:' + s.pVisita + '"></i><i class="l" style="flex:' + s.pLocal + '"></i></div>' +
        '<dl class="datos"><dt>Quarterbacks</dt><dd>' + esc((qb(p, 'v') || '—').split(' ').slice(-1)[0]) + ' / ' + esc((qb(p, 'l') || '—').split(' ').slice(-1)[0]) + '</dd><dt>Marcador medio simulado</dt><dd>' + n1(s.mediaVisita) + ' – ' + n1(s.mediaLocal) + '</dd>' +
        '<dt>Hándicap estimado</dt><dd>' + favorito(p, s.mediaLocal - s.mediaVisita) + '</dd>' +
        '<dt>Línea del mercado</dt><dd>' + (p.linea != null ? favorito(p, p.linea) + ' · total ' + p.lineaTotal : 'sin dato') + '</dd></dl>' +
        (acierto ? '<div style="margin-top:8px">' + acierto + '</div>' : '') + '</button>';
    });
    vista.innerHTML = h + '</div>';
    $('sel-temp').onchange = function () { E.temporada = Number(this.value); E.semana = 1; vistaJornada(); };
    $('sel-sem').onchange = function () { E.semana = Number(this.value); vistaJornada(); };
    vista.querySelectorAll('.partido').forEach(function (b) {
      b.onclick = function () {
        var p = lista[Number(b.getAttribute('data-i'))];
        E.ajustes[p.id] = E.ajustes[p.id] || {};
        pintarDetalle($('dialogo-cuerpo'), { visita: p.visita, local: p.local, neutral: p.neutral, partido: p, pred: p.pred, ajuste: E.ajustes[p.id],
          qbVisita: qb(p, 'v'), qbLocal: qb(p, 'l'), calcular: function () { return simPartido(p); } });
        $('dialogo').showModal(); $('dialogo').scrollTop = 0;
      };
    });
  }

  // ---------- vista: cruce libre ----------
  function vistaLibre() {
    var codigos = Object.keys(EQUIPOS).sort(function (a, b) { return nombre(a) < nombre(b) ? -1 : 1; });
    E.libre = E.libre || { visita: 'KC', local: 'BUF', neutral: false };
    function opciones(sel) { return codigos.map(function (c) { return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + nombre(c) + '</option>'; }).join(''); }
    vista.innerHTML = '<div class="fila"><label>Visitante<select id="lib-v">' + opciones(E.libre.visita) + '</select></label>' +
      '<label>Local<select id="lib-l">' + opciones(E.libre.local) + '</select></label>' +
      '<label>Sede<select id="lib-n"><option value="0">Casa del local</option><option value="1"' + (E.libre.neutral ? ' selected' : '') + '>Campo neutral</option></select></label>' +
      '<button id="lib-otra">Volver a simular</button></div>' +
      '<p class="tenue">Usa las calificaciones actuales de cada equipo y su último quarterback titular, sin lesiones. Aquí no hay línea de mercado, así que siempre se usa el modelo estadístico.</p><div id="lib-res"></div>';
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
    var marca = {}, s = E.estado;
    E.partidos.forEach(function (p) {
      if (p.temporada !== E.partidos[E.partidos.length - 1].temporada || !p.jugado || p.tipo !== 'REG') return;
      [[p.local, p.ptsLocal - p.ptsVisita], [p.visita, p.ptsVisita - p.ptsLocal]].forEach(function (x) {
        var m = marca[x[0]] = marca[x[0]] || [0, 0, 0]; m[x[1] > 0 ? 0 : x[1] < 0 ? 1 : 2]++;
      });
    });
    var filas = Object.keys(EQUIPOS).filter(function (t) { return t in s.ataque; }).map(function (t) { var q = s.titular[t], vq = q && q.id in s.qb ? s.qb[q.id] : 0; return { t: t, q: q ? q.nombre : '—', vq: vq, a: s.ataque[t], d: s.defensa[t], n: s.ataque[t] + s.defensa[t] + vq }; })
      .sort(function (a, b) { return b.n - a.n; });
    var max = Math.max.apply(null, filas.map(function (f) { return Math.abs(f.n); }));
    vista.innerHTML = '<p class="tenue">Calificación = puntos por encima o por debajo de un equipo promedio en campo neutral. Ataque: puntos extra que anota el equipo sin contar a su quarterback. Quarterback: lo que suma o resta el último titular. Defensa: puntos que le quita al rival. ' +
      'Ventaja de local estimada hoy: ' + n1(s.local) + ' puntos · promedio de la liga: ' + n1(s.base) + ' puntos por equipo.</p>' +
      '<div class="tarjeta desborde"><table><tr><th>#</th><th style="text-align:left">Equipo</th><th>Marca ' + E.partidos[E.partidos.length - 1].temporada + '</th><th>Ataque</th><th style="text-align:left">Quarterback</th><th>Defensa</th><th>Total</th><th style="text-align:left">Frente a un equipo promedio</th></tr>' +
      filas.map(function (f, i) {
        var m = marca[f.t] || [0, 0, 0], w = Math.abs(f.n) / max * 90;
        return '<tr><td>' + (i + 1) + '</td><td style="text-align:left">' + esc(nombre(f.t)) + '</td><td>' + m[0] + '-' + m[1] + (m[2] ? '-' + m[2] : '') + '</td><td>' + signo1(f.a) + '</td><td style="text-align:left">' + esc(f.q) + ' <span class="tenue">' + signo1(f.vq) + '</span></td><td>' + signo1(f.d) + '</td><td><b>' + signo1(f.n) + '</b></td>' +
          '<td style="text-align:left;min-width:200px"><span style="display:inline-block;width:90px;text-align:right">' + (f.n < 0 ? '<i class="mini" style="width:' + w + 'px;background:var(--tinta-3)"></i>' : '') + '</span><span style="display:inline-block;width:2px"></span>' +
          (f.n >= 0 ? '<i class="mini" style="width:' + w + 'px;background:var(--tinta-3)"></i>' : '') + '</td></tr>';
      }).join('') + '</table></div>';
  }

  // ---------- vista: precisión y método ----------
  function calcularPrecision() {
    if (E.precision) return E.precision;
    var porTemp = {}, cubos = [], g = { n: 0, ok: 0, dec: 0, mae: 0, brier: 0, mN: 0, mOk: 0, mDec: 0, mMae: 0, mBrier: 0, mBN: 0, bMod: 0 };
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
      g.brier += (pr - y) * (pr - y);
      var pm = M.sinMargen(p.mlLocal, p.mlVisita);
      if (pm != null) { g.mBN++; g.mBrier += (pm - y) * (pm - y); g.bMod += (pr - y) * (pr - y); }
      var c = cubos[Math.min(9, Math.floor(pr * 10))]; c.n++; c.p += pr; c.y += y;
    });
    return (E.precision = { g: g, porTemp: porTemp, cubos: cubos });
  }
  function vistaPrecision() {
    var r = calcularPrecision(), g = r.g, W = 420, H = 300, iz = 40, ab = 34, ar = 12, de = 12;
    var X = function (v) { return iz + v * (W - iz - de); }, Y = function (v) { return ar + (1 - v) * (H - ar - ab); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Calibración del modelo">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      svg += '<line x1="' + iz + '" x2="' + (W - de) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--rejilla)"/><text x="' + (iz - 5) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v * 100 + '%</text><text x="' + X(v) + '" y="' + (H - 16) + '" text-anchor="middle">' + v * 100 + '%</text>';
    });
    svg += '<text x="' + X(0.5) + '" y="' + (H - 2) + '" text-anchor="middle">probabilidad que dio el modelo al local</text>' +
      '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(1) + '" y2="' + Y(1) + '" stroke="var(--tinta-3)" stroke-dasharray="4 3"/>';
    r.cubos.forEach(function (c) {
      if (c.n < 5) return;
      svg += '<circle cx="' + X(c.p / c.n) + '" cy="' + Y(c.y / c.n) + '" r="' + (4 + Math.sqrt(c.n) / 6) + '" fill="var(--local)" stroke="var(--superficie)" stroke-width="2" data-globo="El modelo dijo ' + pct(c.p / c.n, 0) + ' y el local ganó ' + pct(c.y / c.n, 0) + ' de las veces (' + c.n + ' partidos)"/>';
    });
    svg += '</svg>';
    var temps = Object.keys(r.porTemp).sort().reverse();
    vista.innerHTML = '<h2>¿Qué tan bien acierta?</h2><p class="tenue">Cada partido desde ' + PRIMERA_TEMPORADA_VISIBLE + ' se predijo usando solo los resultados anteriores a ese día, y se comparó con lo que pasó de verdad. ' +
      'Las líneas de cierre de las casas de apuestas se muestran como referencia: son la vara más alta que existe.</p>' +
      '<div class="cifras">' +
      '<div class="cifra"><div class="t">Ganador acertado · modelo</div><div class="v">' + pct(g.ok / g.dec) + '</div><div class="s">mercado: ' + pct(g.mOk / g.mDec) + ' · ' + g.n.toLocaleString('es') + ' partidos</div></div>' +
      '<div class="cifra"><div class="t">Error medio del margen · modelo</div><div class="v">' + (g.mae / g.n).toFixed(2) + ' pts</div><div class="s">mercado: ' + (g.mMae / g.mN).toFixed(2) + ' pts</div></div>' +
      '<div class="cifra"><div class="t">Puntaje Brier · modelo</div><div class="v">' + (g.bMod / g.mBN).toFixed(4) + '</div><div class="s">mercado: ' + (g.mBrier / g.mBN).toFixed(4) + ' · tirar una moneda: 0.2500 · menor es mejor</div></div>' +
      '</div>' +
      '<div class="dos"><section class="tarjeta"><h3>Calibración: lo que dijo contra lo que pasó</h3><p class="tenue">Si los puntos caen sobre la diagonal, un «70%» del modelo ocurre de verdad cerca del 70% de las veces.</p>' + svg +
      '<details><summary>Ver como tabla</summary><table><tr><th>Modelo dijo</th><th>Local ganó</th><th>Partidos</th></tr>' +
      r.cubos.filter(function (c) { return c.n; }).map(function (c) { return '<tr><td>' + pct(c.p / c.n, 0) + '</td><td>' + pct(c.y / c.n, 0) + '</td><td>' + c.n + '</td></tr>'; }).join('') + '</table></details></section>' +
      '<section class="tarjeta"><h3>Por temporada</h3><div class="desborde"><table><tr><th>Temporada</th><th>Partidos</th><th>Acierto modelo</th><th>Acierto mercado</th><th>Error modelo</th><th>Error mercado</th></tr>' +
      temps.map(function (t) { var o = r.porTemp[t]; return '<tr><td>' + t + '</td><td>' + o.n + '</td><td>' + pct(o.ok / o.dec) + '</td><td>' + (o.mDec ? pct(o.mOk / o.mDec) : '—') + '</td><td>' + (o.mae / o.n).toFixed(1) + '</td><td>' + (o.mN ? (o.mMae / o.mN).toFixed(1) : '—') + '</td></tr>'; }).join('') +
      '</table></div></section></div>' +
      '<div class="dos"><section class="tarjeta"><h3>Cómo funciona</h3><ul class="lista">' +
      '<li><b>Datos reales.</b> Marcadores, calendario y líneas de cierre de todos los partidos desde 2010, tomados de nflverse. La página intenta bajar la versión más reciente cada vez que se abre.</li>' +
      '<li><b>Calificaciones.</b> Cada equipo tiene una nota de ataque y otra de defensa, y cada quarterback titular la suya, en puntos. Después de cada partido se corrigen según la diferencia entre lo esperado y lo ocurrido (las palizas cuentan con tope). Entre temporadas, cada equipo vuelve un 35% hacia el promedio.</li>' +
      '<li><b>Eficiencia por jugada.</b> La corrección no mira solo el marcador: un 30% se basa en el EPA ofensivo del partido, que mide lo bien que se movió el balón y depende menos de la suerte.</li>' +
      '<li><b>Quarterback.</b> Si cambia el titular, la expectativa cambia en el acto: se usa la nota del que va a jugar. Uno sin historial empieza 2 puntos por debajo del promedio.</li>' +
      '<li><b>Lesiones.</b> Del parte oficial se cuentan los descartados y dudosos: cada receptor, corredor o ala cerrada resta 0.4 puntos a su ataque; cada liniero ofensivo, 0.3; cada defensor regala 0.2 al rival.</li>' +
      '<li><b>Circunstancias.</b> Ventaja de local (se reestima con los datos), 0.8 puntos para quien viene de semana libre y 3 puntos más de total bajo techo.</li>' +
      '<li><b>Simulación.</b> Cada partido se juega miles de veces, serie ofensiva por serie: touchdown, gol de campo o nada; punto extra o conversión de 2; decisiones de final de partido y prórroga con la regla actual. Por eso aparecen de forma natural los márgenes típicos de 3 y 7.</li>' +
      '<li><b>Hándicaps y totales.</b> Se cuentan directamente sobre los marcadores simulados; la «cuota justa» es 1 ÷ probabilidad, sin margen de la casa.</li></ul></section>' +
      '<section class="tarjeta"><h3>Lo que el modelo no sabe</h3><ul class="lista">' +
      '<li>Noticias: no lee prensa ni redes. Lo que no esté en el parte de lesiones o en la alineación anunciada no existe para el modelo; para eso están «Tu información» en cada partido y la línea del mercado.</li>' +
      '<li>La calidad de cada lesionado: cuenta jugadores por posición, no distingue a una estrella de un suplente.</li>' +
      '<li>El parte de lesiones se publica entre miércoles y viernes; antes de eso las lesiones de la jornada cuentan 0. El quarterback de partidos lejanos se supone igual al último titular.</li>' +
      '<li>El pronóstico del clima: el viento se puede indicar a mano en cada partido, pero no se descarga solo.</li>' +
      '<li>Por eso el mercado sigue acertando algo más. Con «Mezcla modelo + mercado» o «Línea del mercado» la simulación parte de la línea de cierre.</li>' +
      '<li>El simulador genera el margen exacto de 3 puntos con menos frecuencia que la NFL real (≈10% contra ≈15%), así que las probabilidades de hándicaps pegados al 3 son aproximadas.</li>' +
      '<li>Con 10 000 simulaciones el error por azar de cada porcentaje ronda ±1 punto; con 100 000, ±0.3.</li></ul></section></div>';
  }

  // ---------- navegación ----------
  var VISTAS = { jornada: vistaJornada, libre: vistaLibre, equipos: vistaEquipos, precision: vistaPrecision };
  function pintar() {
    document.querySelectorAll('.pestanas button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-vista') === E.vista)); });
    VISTAS[E.vista]();
  }
  document.querySelectorAll('.pestanas button').forEach(function (b) { b.onclick = function () { E.vista = b.getAttribute('data-vista'); pintar(); }; });
  $('fuente').onchange = pintar; $('nsims').onchange = pintar;
  $('cerrar').onclick = function () { $('dialogo').close(); };
  $('dialogo').addEventListener('click', function (ev) { if (ev.target === this) this.close(); });
  $('dialogo').addEventListener('close', function () { if (E.vista === 'jornada') vistaJornada(); });

  cargar().then(pintar).catch(function (e) {
    vista.innerHTML = '<p class="aviso">No se pudieron cargar los datos (' + esc(e.message) + '). Si abriste el archivo directamente desde tu computadora, necesitas conexión a internet para bajar los resultados.</p>';
    $('estado-datos').textContent = 'Sin datos';
  });
})();
