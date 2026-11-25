/* Interfaz del simulador NFL: solo picks. El modelo está en modelo.js y los picks en picks.js.
   Las validaciones, la calibración y las alertas se hacen por dentro (herramientas/ y picks.js). */
(function () {
  'use strict';
  var M = window.ModeloNFL, P = window.PicksNFL;
  var URL_VIVO = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
  var SIMS = 100000;          // simulaciones por partido por jugar
  var SIMS_PASADO = 30000;    // partidos ya jugados sin pronóstico guardado
  var PRIMERA_TEMPORADA = 2016;
  var SEGURO_MIN = 0.72;      // filtro «Seguros» de Mejores picks
  var GUARDADO = 'nfl-calculadora'; // lo que se mete en la calculadora, en este navegador

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
  var NOM_TIPO = { gana: 'Ganador', handicap: 'Hándicap', total: 'Total de puntos', tds: 'Touchdowns del partido', tdsEquipo: 'Touchdowns de un equipo', yardas: 'Jugadores (yardas y recepciones)', tdPase: 'Pases de touchdown',
    equipo: 'Puntos de un equipo', mitadGana: '1ª mitad: ganador', mitadHandicap: '1ª mitad: hándicap', mitadTotal: '1ª mitad: total' };

  var E = { partidos: [], porId: {}, estado: null, vista: 'jornada', temporada: null, semana: null, cache: {}, hist: {}, reales: {}, jug: null, lesiones: null, ctx: null };
  var $ = function (id) { return document.getElementById(id); };
  var vista = $('vista');

  // ---------- utilidades ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(p, d) { return (p * 100).toFixed(d == null ? 0 : d) + '%'; }
  function cuota(p) { return p > 0.0005 ? (1 / p).toFixed(2) : '—'; }
  function nombre(t) { return EQ[t] ? EQ[t][0] : t; }
  function apodo(t) { var n = nombre(t).split(' '); return n[n.length - 1]; }
  function chip(t) { return '<span class="chip" style="--c:' + (EQ[t] ? EQ[t][1] : '#555') + '">' + t + '</span>'; }
  function diaLargo(f) { var d = new Date(f + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }); return d.charAt(0).toUpperCase() + d.slice(1); }
  function iniciado(p) { var i = P.inicio(p); return p.jugado || (i != null && Date.now() >= i); }
  var ALERTA = ' <span class="alerta" role="img" aria-label="alerta">⚠</span>';

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
      json('datos/lesiones.json'), json('datos/jugadores.json'), json('datos/historial.json'), json('datos/lineas.json')
    ]).then(function (r) {
      if (!r[0] && !r[1]) throw new Error('sin conexión con los datos');
      var copia = r[1] ? M.leerCSV(r[1]) : null;
      E.lesiones = r[2]; E.jug = r[3]; E.hist = (r[4] && r[4].partidos) || {};
      E.lineasInfo = r[5]; E.reales = (r[5] && r[5].partidos) || {};
      E.partidos = M.prepararPartidos(r[0] ? M.leerCSV(r[0]) : copia, 2010, r[0] ? copia : null);
      if (!E.partidos.length) throw new Error('sin partidos');
      E.partidos.forEach(function (p) { E.porId[p.id] = p; });
      E.estado = M.calificar(E.partidos);
      var ind = P.indexar(E.jug);
      E.ctx = { jug: E.jug, porEquipo: ind.porEquipo, semanas: ind.semanas, lesiones: E.lesiones, titular: E.estado.titular, lineas: E.reales,
        correccion: P.calcularCorreccion(E.hist), fechas: P.contarFechas(E.partidos) }; // lo mismo que usa el registro automático
      var jugados = E.partidos.filter(function (p) { return p.jugado; }), ultimo = jugados[jugados.length - 1];
      E.ultima = E.partidos[E.partidos.length - 1].temporada;
      E.temporada = E.ultima;
      var pendiente = E.partidos.filter(function (p) { return p.temporada === E.ultima && !iniciado(p); })[0];
      E.semana = pendiente ? pendiente.semana : ultimo.semana;
      $('estado-datos').textContent = 'Datos de nflverse' + (r[0] ? ' en vivo' : '') +
        (E.lineasInfo && E.lineasInfo.actualizado ? ' · líneas de casas de EE. UU. del ' + new Date(E.lineasInfo.actualizado).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    });
  }

  // ---------- pronóstico de un partido ----------
  /* Si el partido tiene pronóstico guardado (lo que se califica), se usa ese, tal cual. Si no, se calcula
     aquí con la misma regla. */
  function pronostico(p) {
    if (E.cache[p.id]) return E.cache[p.id];
    var reg = E.hist[p.id], r;
    if (reg) {
      var mapear = function (k) {
        var x = { tipo: k.t, eq: k.eq, quien: k.q, que: String(k.que).replace(' (línea alternativa)', '').replace('hándicap alternativo', 'hándicap'), prob: k.p, m: k.m, cuotaReal: k.c, ok: k.ok, top: k.top,
          esc: k.x, alerta: k.a, principal: !reg.v && (k.que === 'hándicap' || k.que === 'puntos en el partido') };
        // Partido terminado y aún sin calificar en el servidor: lo que ya se puede saber se califica aquí.
        if (x.ok === undefined && p.jugado) { var o = P.calificar(x.m, p, function () { return undefined; }); if (o !== undefined) x.ok = o; }
        return x;
      };
      var lista = reg.picks.map(mapear), riesgo = (reg.riesgo || []).map(mapear);
      var top = (reg.v ? lista.filter(function (k) { return k.top && P.apto(k); }) : P.mejores(lista)).sort(function (a, b) { return b.prob - a.prob; });
      r = { top: top, riesgo: riesgo, reg: reg, esp: reg.e ? { visita: reg.e[0], local: reg.e[1] } : { visita: Math.max(3, p.pred.visita), local: Math.max(3, p.pred.local) } };
    } else {
      var q = P.conLineas(p, E.reales), esp = P.mezclar(p.pred, q.linea, q.lineaTotal, P.MEZCLA);
      var s = M.simular(esp.local, esp.visita, p.jugado ? SIMS_PASADO : SIMS, M.semillaDe(p.id), p.tipo !== 'REG');
      var todos = p.jugado ? [] : P.picksDe(E.ctx, q, s, esp);
      r = { top: P.mejores(todos), riesgo: p.jugado ? [] : P.arriesgados(E.ctx, q, s, esp, todos), esp: esp, sim: p.jugado ? null : s };
    }
    r.top.concat(r.riesgo).forEach(function (k) { k.p = p; });
    r.riesgo.forEach(function (k) { k.riesgo = true; });
    r.ok = r.top.filter(function (k) { return k.ok === true; }).length;
    r.mal = r.top.filter(function (k) { return k.ok === false; }).length;
    r.pend = r.top.filter(function (k) { return k.ok === undefined; }).length;
    return (E.cache[p.id] = r);
  }
  function simDe(p, r) { if (!r.sim) r.sim = M.simular(r.esp.local, r.esp.visita, SIMS, M.semillaDe(p.id), p.tipo !== 'REG'); return r.sim; }

  // ---------- un pick ----------
  function estadoPick(k) {
    if (k.ok === true) return '<span class="res bien">Acertó</span>';
    if (k.ok === false) return '<span class="res mal">Falló</span>';
    if (k.ok === null) return '<span class="res">Anulado</span>';
    return '';
  }
  function casaDe(k) {
    var r = E.reales[k.p.id] || {};
    return (k.tipo === 'jug' ? r.casaJugadores : r.casaLineas || r.casa) || 'casa de EE. UU.';
  }
  // Cuota de la casa solo si es real; la del modelo siempre, rotulada como tal.
  function cuotas(k) {
    var justa = '<span class="cu"><b>' + cuota(k.prob) + '</b><small>cuota justa del modelo</small></span>';
    return '<span class="pk-c">' + (k.cuotaReal ? '<span class="cu casa"><b>' + Number(k.cuotaReal).toFixed(2) + '</b><small>cuota de la casa · ' + esc(casaDe(k)) + '</small></span>' : '') + justa + '</span>';
  }
  function textoLinea(k, l) {
    var m = k.m;
    if (m.m === 'handicap' || m.m === 'mitadHandicap') return P.textoHandicap(m.eq, l);
    return (m.mas === false ? 'menos de ' : 'más de ') + l;
  }
  // Escalera de líneas, plegada: verde si llega al mínimo, gris si no.
  function escalera(k) {
    if (!k.esc || !k.esc.length || k.p.jugado) return '';
    return '<details class="esc"><summary>Otras líneas</summary><div class="esc-l">' + k.esc.map(function (x) {
      return '<span class="' + (x[1] >= P.MINIMO ? 'si' : 'no') + (x[0] === k.m.linea ? ' esta' : '') + '"><small>' + esc(textoLinea(k, x[0])) + '</small><b>' + pct(x[1]) + '</b></span>';
    }).join('') + '</div></details>';
  }
  function filaPick(k, i, conPartido) {
    return '<li class="pk' + (k.ok === true ? ' es-bien' : k.ok === false ? ' es-mal' : '') + '"' + (conPartido ? ' data-id="' + k.p.id + '" tabindex="0"' : '') + '>' +
      '<span class="pk-n">' + (i + 1) + '</span><span class="pk-p">' + pct(k.prob) + '</span>' +
      '<span class="pk-t">' + (k.eq && String(k.quien).indexOf(k.eq + ' ') !== 0 ? chip(k.eq) + ' ' : '') + '<b>' + esc(k.quien) + '</b> ' + esc(k.que) + (k.alerta && k.alerta.length ? ALERTA : '') +
      (conPartido ? '<small>' + esc(k.p.visita + ' en ' + k.p.local) + '</small>' : '') + '</span>' +
      cuotas(k) + estadoPick(k) + escalera(k) + '</li>';
  }

  // ---------- detalle de un partido ----------
  function abrirPartido(p) {
    var r = pronostico(p), emp = iniciado(p);
    $('dialogo-titulo').textContent = nombre(p.visita) + ' en ' + nombre(p.local);
    var h = '<p class="d-meta">' + diaLargo(p.fecha) + (p.hora ? ' · ' + p.hora + ' ET' : '') + (p.estadio ? ' · ' + esc(p.estadio) : '') +
      (p.jugado ? ' · <b>Final ' + p.visita + ' ' + p.ptsVisita + ' – ' + p.ptsLocal + ' ' + p.local + '</b>' + (r.top.length ? ' · ' + r.ok + ' de ' + (r.ok + r.mal) + ' acertados' + (r.pend ? ', ' + r.pend + ' por calificar' : '') : '') : emp ? ' · en juego' : '') + '</p>';
    if (r.top.length || r.riesgo.length) {
      h += '<div class="d-picks"><section class="d-sec"><h3>Picks</h3>' + (r.top.length ? '<ol class="picks">' + r.top.map(function (k, i) { return filaPick(k, i); }).join('') + '</ol>' : '<p class="vacio">Ninguno llega al ' + pct(P.MINIMO) + '.</p>') + '</section>' +
        (r.riesgo.length ? '<section class="d-sec riesgo"><h3>Arriesgados</h3><ol class="picks">' + r.riesgo.map(function (k, i) { return filaPick(k, i); }).join('') + '</ol></section>' : '') + '</div>';
    } else {
      h += '<p class="vacio">Sin picks de ' + pct(P.MINIMO) + ' o más.</p>';
    }
    if (!emp) h += calculadora(p);
    $('dialogo-cuerpo').innerHTML = h;
    if (!emp) activarCalculadora(p, r);
    var d = $('dialogo'); d.showModal(); d.scrollTop = 0;
  }

  // ---------- calculadora ----------
  /* Metes la línea y la cuota de tu casa en cualquier mercado y devuelve la probabilidad del modelo en esa
     línea exacta, si llega al 65% y ⚠ si la cuota implica más de 10 puntos de diferencia. Se guarda en el navegador. */
  var MERCADOS = [
    ['pase', 'Yardas de pase', 'jug'], ['carrera', 'Yardas por tierra', 'jug'], ['recepcion', 'Yardas de recepción', 'jug'], ['atrapadas', 'Recepciones', 'jug'],
    ['tdPase', 'Pases de touchdown (QB)', 'jug'], ['equipo', 'Puntos de un equipo', 'eq'], ['handicap', 'Hándicap', 'eq'], ['total', 'Total de puntos', '']
  ];
  var TIPO_MERCADO = {}; MERCADOS.forEach(function (m) { TIPO_MERCADO[m[0]] = m; });
  function guardadas(id) { try { return (JSON.parse(localStorage.getItem(GUARDADO)) || {})[id] || []; } catch (e) { return []; } }
  function guardar(id, lista) {
    try { var t = JSON.parse(localStorage.getItem(GUARDADO)) || {}; if (lista.length) t[id] = lista; else delete t[id]; localStorage.setItem(GUARDADO, JSON.stringify(t)); } catch (e) { /* sin almacenamiento */ }
  }
  function jugadoresPartido(p) { // jugadores con proyección de los dos equipos
    var q = P.conLineas(p, E.reales);
    return P.jugadoresDe(E.ctx, q, 'v').concat(P.jugadoresDe(E.ctx, q, 'l'));
  }
  function calculadora(p) {
    return '<section class="d-sec calc"><h3>Calculadora</h3><form class="calc-f" autocomplete="off">' +
      '<select name="mer" aria-label="Mercado">' + MERCADOS.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('') + '</select>' +
      '<select name="quien" aria-label="Jugador o equipo"></select>' +
      '<select name="lado" aria-label="Más o menos"><option value="mas">Más de</option><option value="menos">Menos de</option></select>' +
      '<input name="linea" type="number" step="0.5" inputmode="decimal" placeholder="Línea" aria-label="Línea" required>' +
      '<input name="cuota" type="number" step="0.01" min="1.01" inputmode="decimal" placeholder="Cuota" aria-label="Cuota de la casa" required>' +
      '<button type="submit">Calcular</button></form><ol class="calc-l"></ol></section>';
  }
  function activarCalculadora(p, r) {
    var caja = $('dialogo-cuerpo'), f = caja.querySelector('.calc-f'), lista = caja.querySelector('.calc-l'), jugs = null;
    function opciones() {
      var m = TIPO_MERCADO[f.mer.value], html = '';
      if (m[2] === 'jug') {
        jugs = jugs || jugadoresPartido(p);
        html = jugs.filter(function (j) { return j.pr[m[0]]; }).map(function (j) { return '<option value="' + esc(j.j.id) + '">' + esc(j.j.n) + ' (' + j.eq + ')</option>'; }).join('') || '<option value="">Sin jugadores con datos</option>';
      } else if (m[2] === 'eq') html = [p.visita, p.local].map(function (t) { return '<option value="' + t + '">' + esc(nombre(t)) + '</option>'; }).join('');
      f.quien.innerHTML = html; f.quien.hidden = !m[2]; f.lado.hidden = m[0] === 'handicap';
    }
    function calcular(x) {
      var m = TIPO_MERCADO[x.mer], q = null, texto;
      if (m[2] === 'jug') {
        jugs = jugs || jugadoresPartido(p);
        var j = jugs.filter(function (y) { return y.j.id === x.quien; })[0];
        if (j) q = P.probJugadorLinea(E.ctx, j.pr, x.mer, x.linea, x.lado !== 'menos');
        texto = (j ? j.j.n : x.nombre || '—') + ' · ' + (x.lado === 'menos' ? 'menos de ' : 'más de ') + x.linea + ' ' + m[1].toLowerCase();
      } else {
        var mm = x.mer === 'handicap' ? { m: 'handicap', eq: x.quien, linea: x.linea } : { m: x.mer, eq: x.quien, linea: x.linea, mas: x.lado !== 'menos' };
        q = P.probPartido(E.ctx, p, simDe(p, r), mm);
        texto = x.mer === 'handicap' ? P.textoHandicap(x.quien, x.linea) + ' hándicap' : (x.mer === 'equipo' ? x.quien + ' ' : '') + (x.lado === 'menos' ? 'menos de ' : 'más de ') + x.linea + (x.mer === 'equipo' ? ' puntos' : ' puntos en el partido');
      }
      return { q: q, texto: texto };
    }
    function pintar() {
      var g = guardadas(p.id);
      lista.innerHTML = g.map(function (x, i) {
        var c = calcular(x), q = c.q, alerta = q != null && Math.abs(q - 1 / x.cuota) > P.DIFERENCIA;
        return '<li><span class="calc-t">' + esc(c.texto) + '<small>cuota de la casa ' + Number(x.cuota).toFixed(2) + ' · cuota justa del modelo ' + (q != null ? cuota(q) : '—') + '</small></span>' +
          '<span class="pk-p">' + (q != null ? pct(q) : '—') + '</span>' +
          (q != null ? '<span class="res ' + (q >= P.MINIMO ? 'bien">llega al ' : '">no llega al ') + pct(P.MINIMO) + '</span>' : '<span></span>') +
          '<span>' + (alerta ? ALERTA : '') + '</span><button type="button" data-borrar="' + i + '" aria-label="Quitar">×</button></li>';
      }).join('');
      lista.querySelectorAll('[data-borrar]').forEach(function (b) {
        b.onclick = function () { var g2 = guardadas(p.id); g2.splice(Number(b.getAttribute('data-borrar')), 1); guardar(p.id, g2); pintar(); };
      });
    }
    f.mer.onchange = opciones;
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var x = { mer: f.mer.value, quien: f.quien.value, nombre: f.quien.selectedOptions[0] ? f.quien.selectedOptions[0].textContent : '', lado: f.lado.value, linea: Number(f.linea.value), cuota: Number(f.cuota.value) };
      if (!isFinite(x.linea) || !(x.cuota > 1)) return;
      if (TIPO_MERCADO[x.mer][2] && !x.quien) return;
      var g = guardadas(p.id); g.push(x); guardar(p.id, g); pintar();
      f.linea.value = ''; f.cuota.value = ''; f.linea.focus();
    };
    opciones(); pintar();
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
  // Las filas de picks abren su partido; la escalera plegada no.
  function abrirAlTocar(selector) {
    vista.querySelectorAll(selector).forEach(function (el) {
      var abrir = function (ev) { if (ev.target.closest('details')) return; abrirPartido(E.porId[el.getAttribute('data-id')]); };
      el.onclick = abrir; el.onkeydown = function (ev) { if (ev.key === 'Enter') abrir(ev); };
    });
  }

  // ---------- vista: partidos ----------
  function vistaJornada() {
    var lista = partidosDeJornada(), h = cabecera('Partidos'), dia = null;
    lista.forEach(function (p) {
      var r = pronostico(p), emp = iniciado(p), k = r.top[0];
      if (p.fecha !== dia) { h += (dia ? '</div>' : '') + '<h2 class="dia">' + diaLargo(p.fecha) + '</h2><div class="juegos">'; dia = p.fecha; }
      function eq(t, l) {
        var gana = p.jugado && (l === 'l' ? p.ptsLocal > p.ptsVisita : p.ptsVisita > p.ptsLocal);
        return '<span class="j-eq' + (gana ? ' fuerte' : '') + '">' + chip(t) + '<span class="j-n">' + esc(apodo(t)) + '</span><span class="j-s">' + (p.jugado ? (l === 'l' ? p.ptsLocal : p.ptsVisita) : '') + '</span></span>';
      }
      var estado = p.jugado ? (r.top.length ? '<b>' + r.ok + ' de ' + (r.ok + r.mal) + '</b><span>' + (r.pend ? r.pend + ' por calificar' : 'acertados') + '</span>' : '') :
        (r.top.length ? '<b>' + r.top.length + ' picks</b>' + (r.riesgo.length ? '<span>+ ' + r.riesgo.length + ' arriesgados</span>' : '') : '');
      h += '<button class="juego" data-id="' + p.id + '">' +
        '<span class="j-hora">' + (p.jugado ? 'Final' : emp ? 'En juego' : (p.hora || '—')) + '<small>' + (p.jugado || emp ? '' : 'ET') + '</small></span>' +
        '<span class="j-equipos">' + eq(p.visita, 'v') + eq(p.local, 'l') + '</span>' +
        '<span class="j-pick">' + (k ? '<span class="' + (k.ok === true ? 'bien' : k.ok === false ? 'mal' : '') + '"><b>' + pct(k.prob) + '</b> ' + (k.eq && String(k.quien).indexOf(k.eq + ' ') !== 0 ? chip(k.eq) + ' ' : '') + esc(k.quien) + ' ' + esc(k.que) + (k.alerta && k.alerta.length ? ALERTA : '') + '</span>' +
          '<small>' + (k.cuotaReal ? 'cuota de la casa ' + Number(k.cuotaReal).toFixed(2) + ' · ' : '') + 'cuota justa del modelo ' + cuota(k.prob) + '</small>' : '') + '</span>' +
        '<span class="j-estado">' + estado + '</span></button>';
    });
    vista.innerHTML = h + (dia ? '</div>' : '');
    activarCabecera();
    vista.querySelectorAll('.juego').forEach(function (b) { b.onclick = function () { abrirPartido(E.porId[b.getAttribute('data-id')]); }; });
  }

  // ---------- vista: mejores picks de la jornada ----------
  function vistaPicks() {
    // Uno por partido en cada columna: los de un mismo partido suben y bajan juntos.
    var todos = [], riesgo = [], seguro = function (k) { return k.prob >= SEGURO_MIN && (k.cuotaReal ? k.cuotaReal >= P.CUOTA_MINIMA : k.prob <= P.MAXIMO); };
    partidosDeJornada().forEach(function (p) {
      if (iniciado(p)) return;
      var r = pronostico(p), cand = r.top.filter(function (k) { return E.filtroPicks !== 'seguros' || seguro(k); });
      if (cand.length) todos.push(cand[0]);
      if (r.riesgo.length) riesgo.push(r.riesgo[0]);
    });
    riesgo.sort(function (a, b) { return b.prob - a.prob; });
    todos.sort(function (a, b) { return b.prob - a.prob; });
    var filtro = '<div class="segmento filtro" role="group" aria-label="Filtro de picks">' + [['todos', 'Todos (' + pct(P.MINIMO) + '+)'], ['seguros', 'Seguros (' + pct(SEGURO_MIN) + '+)']].map(function (f) {
      return '<button data-filtro="' + f[0] + '" aria-pressed="' + ((E.filtroPicks || 'todos') === f[0]) + '">' + f[1] + '</button>'; }).join('') + '</div>';
    vista.innerHTML = cabecera('Mejores picks') + filtro +
      (todos.length || riesgo.length ? '<div class="d-picks"><div class="panel"><h3>Más probables</h3><ol class="picks">' + todos.map(function (k, i) { return filaPick(k, i, true); }).join('') + '</ol></div>' +
        (riesgo.length ? '<div class="panel riesgo"><h3>Arriesgados</h3><ol class="picks">' + riesgo.map(function (k, i) { return filaPick(k, i, true); }).join('') + '</ol></div>' : '') + '</div>' :
        '<p class="vacio">' + (E.filtroPicks === 'seguros' ? 'Ningún pick llega al ' + pct(SEGURO_MIN) + '.' : 'No quedan partidos por empezar en esta jornada.') + '</p>');
    activarCabecera();
    vista.querySelectorAll('[data-filtro]').forEach(function (b) { b.onclick = function () { E.filtroPicks = b.getAttribute('data-filtro'); vistaPicks(); }; });
    abrirAlTocar('.pk[data-id]');
  }

  // ---------- vista: aciertos ----------
  function vistaAciertos() {
    var gan = { n: 0, neto: 0 }, ganArr = { n: 0, neto: 0 }, arr = { n: 0, ok: 0, p: 0 }, semanas = {}, total = { n: 0, ok: 0, p: 0 }, mejor = { n: 0, ok: 0 }, porTipo = {};
    Object.keys(E.hist).forEach(function (id) {
      var p = E.porId[id]; if (!p || !iniciado(p)) return;
      var r = pronostico(p), reg = r.reg, clave = reg.temporada * 100 + reg.semana;
      var s = semanas[clave] = semanas[clave] || { t: reg.temporada, sem: reg.semana, juegos: [], n: 0, ok: 0, p: 0 };
      s.juegos.push(p);
      if (reg.reconstruido) return; // los rehechos después del partido no cuentan
      r.riesgo.forEach(function (k) {
        if (k.ok !== true && k.ok !== false) return;
        arr.n++; arr.ok += k.ok ? 1 : 0; arr.p += k.prob;
        if (k.cuotaReal) { ganArr.n++; ganArr.neto += k.ok ? k.cuotaReal - 1 : -1; }
      });
      r.top.forEach(function (k, i) {
        if (k.ok !== true && k.ok !== false) return;
        total.n++; total.ok += k.ok ? 1 : 0; total.p += k.prob;
        s.n++; s.ok += k.ok ? 1 : 0; s.p += k.prob;
        var t = porTipo[k.m.m] = porTipo[k.m.m] || { n: 0, ok: 0, p: 0 }; t.n++; t.ok += k.ok ? 1 : 0; t.p += k.prob;
        if (i === 0) { mejor.n++; mejor.ok += k.ok ? 1 : 0; }
        if (k.cuotaReal) { gan.n++; gan.neto += k.ok ? k.cuotaReal - 1 : -1; }
      });
    });
    function neto(o) { return o.n ? (o.neto >= 0 ? '+' : '−') + Math.abs(o.neto / o.n).toFixed(2) : '—'; }
    function cifra(t, o, sub) { return '<div class="cifra"><span>' + t + '</span><b>' + (o.n ? pct(o.ok / o.n) : '—') + '</b><small>' + sub + '</small></div>'; }
    var claves = Object.keys(semanas).map(Number).sort(function (a, b) { return b - a; });
    var h = '<div class="cab-vista"><h1>Aciertos</h1></div>' +
      '<div class="cifras">' + cifra('Picks acertados', total, total.ok + ' de ' + total.n + (total.n ? ' · anunciaban ' + pct(total.p / total.n) : '')) +
      cifra('Mejor pick de cada partido', mejor, mejor.ok + ' de ' + mejor.n) +
      cifra('Arriesgados', arr, arr.n ? arr.ok + ' de ' + arr.n + ' · anunciaban ' + pct(arr.p / arr.n) : '—') +
      '<div class="cifra"><span>Ganancia por unidad, cuota de la casa</span><b>' + neto(gan) + '</b><small>' + gan.n + ' picks' + (ganArr.n ? ' · arriesgados ' + neto(ganArr) + ' en ' + ganArr.n : '') + '</small></div></div>';
    h += '<div class="dos"><div class="panel"><h3>Por jornada</h3><table><tr><th class="izq">Jornada</th><th>Partidos</th><th>Picks</th><th>Acertados</th><th>Acierto</th><th>Anunciaban</th></tr>' +
      claves.filter(function (c) { return semanas[c].n; }).map(function (c) { var s = semanas[c]; return '<tr><td class="izq">Semana ' + s.sem + '</td><td>' + s.juegos.length + '</td><td>' + s.n + '</td><td>' + s.ok + '</td><td><b>' + pct(s.ok / s.n) + '</b></td><td>' + pct(s.p / s.n) + '</td></tr>'; }).join('') + '</table></div>' +
      '<div class="panel"><h3>Por tipo de pick</h3><table><tr><th class="izq">Tipo</th><th>Picks</th><th>Acierto</th><th>Anunciaban</th></tr>' +
      Object.keys(porTipo).sort(function (a, b) { return porTipo[b].n - porTipo[a].n; }).map(function (t) {
        var o = porTipo[t];
        return '<tr><td class="izq">' + (NOM_TIPO[t] || t) + '</td><td>' + o.n + '</td><td><b>' + pct(o.ok / o.n) + '</b></td><td>' + pct(o.p / o.n) + '</td></tr>'; }).join('') +
      '</table></div></div>';
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
    vista.innerHTML = h;
    vista.querySelectorAll('tr[data-id]').forEach(function (tr) { tr.onclick = function () { abrirPartido(E.porId[tr.getAttribute('data-id')]); }; });
  }

  // ---------- navegación ----------
  var VISTAS = { jornada: vistaJornada, picks: vistaPicks, aciertos: vistaAciertos };
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
