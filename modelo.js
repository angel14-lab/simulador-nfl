/* Modelo NFL: calificaciones de ataque/defensa + simulación Monte Carlo por series ofensivas.
   Funciona igual en el navegador (window.ModeloNFL) y en Node (module.exports). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.ModeloNFL = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Franquicias que se mudaron: se tratan como el mismo equipo.
  var ALIAS = { OAK: 'LV', SD: 'LAC', STL: 'LA' };

  // Parámetros ajustados con herramientas/ajustar.js (validación 2016-2025, sin mirar el futuro).
  var PARAMS = {
    k: 0.03,           // cuánto pesa cada partido nuevo en el ataque del equipo
    kQB: 0.05,         // ...y en la nota del quarterback titular
    kDef: 0.07,        // ...y en la defensa
    regresion: 0.35,   // cuánto vuelve cada equipo al promedio entre temporadas
    regresionQB: 0.1,  // ídem para los quarterbacks
    qbNuevo: -2,       // nota inicial de un quarterback sin historial (puntos por partido)
    tope: 17,          // sorpresa máxima (puntos) que cuenta por partido: amortigua palizas
    local: 2.2,        // ventaja inicial de jugar en casa (puntos)
    kLocal: 0.002,     // velocidad con la que se reestima la ventaja de local
    kBase: 0.01,       // velocidad con la que se reestima el promedio de puntos de la liga
    base: 21.5,        // puntos promedio por equipo al inicio
    mezclaEPA: 0.3,    // parte de la corrección que usa eficiencia por jugada (EPA) en vez del marcador
    epaA: 22.79, epaB: 0.63, // puntos «merecidos» = epaA + epaB × EPA ofensivo del partido
    descanso: 0.8,     // puntos a favor del equipo que viene de semana libre
    techo: 3,          // puntos extra en el total cuando se juega bajo techo
    bajaAtaque: 0.4,   // puntos que pierde un ataque por cada receptor/corredor/ala cerrada descartado
    bajaLinea: 0.3,    // ...por cada liniero ofensivo descartado
    bajaDefensa: 0.2,  // puntos que regala una defensa por cada defensor descartado
    viento: 0.35,      // puntos menos en el total por cada mph de viento por encima de 10
    sinBajas: { at: 0, li: 0, de: 0 }
  };

  function leerCSV(texto) {
    var filas = [], fila = [], campo = '', enComillas = false, i, c;
    for (i = 0; i < texto.length; i++) {
      c = texto[i];
      if (enComillas) {
        if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else enComillas = false; }
        else campo += c;
      } else if (c === '"') enComillas = true;
      else if (c === ',') { fila.push(campo); campo = ''; }
      else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
      else if (c !== '\r') campo += c;
    }
    if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
    var cab = filas.shift();
    return filas.filter(function (f) { return f.length === cab.length; }).map(function (f) {
      var o = {}; for (var j = 0; j < cab.length; j++) o[cab[j]] = f[j]; return o;
    });
  }

  function num(v) { return v === '' || v === 'NA' || v == null ? null : Number(v); }
  function bajas(v) { // "2|1|0" = descartados de ataque, línea ofensiva y defensa
    if (!v) return null;
    var p = String(v).split('|');
    return { at: Number(p[0]) || 0, li: Number(p[1]) || 0, de: Number(p[2]) || 0 };
  }

  /* Convierte las filas de nflverse en partidos limpios, en orden cronológico.
     extras (opcional): filas de la copia del sitio, que añaden eficiencia (EPA) y lesiones por partido. */
  function prepararPartidos(filas, desde, extras) {
    var lista = [], masPorId = {};
    (extras || []).forEach(function (f) { masPorId[f.game_id] = f; });
    filas.forEach(function (f) {
      var temporada = Number(f.season);
      if (temporada < (desde || 2010)) return;
      var pl = num(f.home_score), pv = num(f.away_score), x = masPorId[f.game_id] || f;
      lista.push({
        id: f.game_id, temporada: temporada, tipo: f.game_type, semana: Number(f.week),
        fecha: f.gameday, hora: f.gametime || '',
        visita: ALIAS[f.away_team] || f.away_team, local: ALIAS[f.home_team] || f.home_team,
        ptsVisita: pv, ptsLocal: pl, jugado: pl !== null && pv !== null,
        neutral: f.location === 'Neutral',
        linea: num(f.spread_line),      // margen esperado del local según el mercado (+ = local favorito)
        lineaTotal: num(f.total_line),
        mlLocal: num(f.home_moneyline), mlVisita: num(f.away_moneyline),
        qbVisita: f.away_qb_name || '', qbLocal: f.home_qb_name || '',
        qbVisitaId: f.away_qb_id || '', qbLocalId: f.home_qb_id || '',
        descansoVisita: num(f.away_rest), descansoLocal: num(f.home_rest),
        bajoTecho: f.roof === 'dome' || f.roof === 'closed', techo: f.roof || '',
        epaVisita: num(x.away_epa), epaLocal: num(x.home_epa),
        bajasVisita: bajas(x.away_bajas), bajasLocal: bajas(x.home_bajas),
        estadio: f.stadium || '', prorroga: f.overtime === '1'
      });
    });
    lista.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id < b.id ? -1 : 1; });
    return lista;
  }

  // Puntos esperados de cada equipo a partir de las calificaciones y de las circunstancias del partido.
  // c: {local, visita, neutral, qbL, qbV, descL, descV, bajoTecho, bajasL, bajasV}
  function esperar(e, c, P) {
    P = P || PARAMS;
    var bL = c.bajasL || P.sinBajas, bV = c.bajasV || P.sinBajas;
    var f = {
      baseLocal: e.base + e.ataque[c.local] - e.defensa[c.visita],
      baseVisita: e.base + e.ataque[c.visita] - e.defensa[c.local],
      casa: c.neutral ? 0 : e.local,
      qbLocal: c.qbL ? (c.qbL in e.qb ? e.qb[c.qbL] : P.qbNuevo) : 0,
      qbVisita: c.qbV ? (c.qbV in e.qb ? e.qb[c.qbV] : P.qbNuevo) : 0,
      descanso: P.descanso * ((c.descL >= 13 ? 1 : 0) - (c.descV >= 13 ? 1 : 0)),
      techo: c.bajoTecho ? P.techo : 0,
      // Lo que cada equipo deja de anotar por sus bajas en ataque, y lo que anota de más por las bajas del rival en defensa.
      bajasLocal: -(P.bajaAtaque * bL.at + P.bajaLinea * bL.li) + P.bajaDefensa * bV.de,
      bajasVisita: -(P.bajaAtaque * bV.at + P.bajaLinea * bV.li) + P.bajaDefensa * bL.de
    };
    var l = f.baseLocal + f.qbLocal + f.casa / 2 + f.descanso / 2 + f.techo / 2 + f.bajasLocal;
    var v = f.baseVisita + f.qbVisita - f.casa / 2 - f.descanso / 2 + f.techo / 2 + f.bajasVisita;
    return { local: l, visita: v, margen: l - v, total: l + v, factores: f };
  }

  // Recorre los partidos en orden. A cada uno le anota la predicción hecha SOLO con partidos
  // anteriores (p.pred) y, si ya se jugó, actualiza las calificaciones con el resultado.
  function calificar(partidos, P) {
    P = P || PARAMS;
    var e = { ataque: {}, defensa: {}, qb: {}, qbPartidos: {}, titular: {}, base: P.base, local: P.local }, temporada = null;
    function tope(x) { return Math.max(-P.tope, Math.min(P.tope, x)); }
    partidos.forEach(function (p) {
      if (p.temporada !== temporada) {
        if (temporada !== null) {
          Object.keys(e.ataque).forEach(function (t) { e.ataque[t] *= 1 - P.regresion; e.defensa[t] *= 1 - P.regresion; });
          Object.keys(e.qb).forEach(function (q) { e.qb[q] *= 1 - P.regresionQB; });
        }
        temporada = p.temporada;
      }
      [p.local, p.visita].forEach(function (t) { if (!(t in e.ataque)) { e.ataque[t] = 0; e.defensa[t] = 0; } });
      // Si aún no se anunció el quarterback de un partido futuro, se asume el último titular del equipo.
      var qbL = p.qbLocalId || (e.titular[p.local] || {}).id || '', qbV = p.qbVisitaId || (e.titular[p.visita] || {}).id || '';
      if (!p.qbLocal && e.titular[p.local]) p.qbLocalSupuesto = e.titular[p.local].nombre;
      if (!p.qbVisita && e.titular[p.visita]) p.qbVisitaSupuesto = e.titular[p.visita].nombre;
      [qbL, qbV].forEach(function (q) { if (q && !(q in e.qb)) { e.qb[q] = P.qbNuevo; e.qbPartidos[q] = 0; } });
      p.pred = esperar(e, { local: p.local, visita: p.visita, neutral: p.neutral, qbL: qbL, qbV: qbV,
        descL: p.descansoLocal, descV: p.descansoVisita, bajoTecho: p.bajoTecho, bajasL: p.bajasLocal, bajasV: p.bajasVisita }, P);
      if (!p.jugado) return;
      // Lo «merecido»: el marcador mezclado con la eficiencia por jugada, que tiene menos suerte dentro.
      var mL = p.ptsLocal, mV = p.ptsVisita;
      if (P.mezclaEPA && p.epaLocal !== null && p.epaVisita !== null) {
        mL = (1 - P.mezclaEPA) * mL + P.mezclaEPA * (P.epaA + P.epaB * p.epaLocal);
        mV = (1 - P.mezclaEPA) * mV + P.mezclaEPA * (P.epaA + P.epaB * p.epaVisita);
      }
      var cL = tope(mL - p.pred.local), cV = tope(mV - p.pred.visita);
      e.ataque[p.local] += P.k * cL; e.defensa[p.visita] -= P.kDef * cL;
      e.ataque[p.visita] += P.k * cV; e.defensa[p.local] -= P.kDef * cV;
      if (qbL) { e.qb[qbL] += P.kQB * cL; e.qbPartidos[qbL]++; }
      if (qbV) { e.qb[qbV] += P.kQB * cV; e.qbPartidos[qbV]++; }
      if (p.qbLocalId) e.titular[p.local] = { id: p.qbLocalId, nombre: p.qbLocal };
      if (p.qbVisitaId) e.titular[p.visita] = { id: p.qbVisitaId, nombre: p.qbVisita };
      e.base += P.kBase * (p.ptsLocal - p.pred.local + p.ptsVisita - p.pred.visita) / 2;
      if (!p.neutral) e.local += P.kLocal * (cL - cV);
    });
    return e;
  }

  // Predicción para un cruce cualquiera con las calificaciones actuales y el último titular de cada equipo.
  function predecir(estado, local, visita, neutral, bajoTecho) {
    return esperar(estado, { local: local, visita: visita, neutral: neutral, bajoTecho: bajoTecho,
      qbL: (estado.titular[local] || {}).id, qbV: (estado.titular[visita] || {}).id });
  }

  // Generador aleatorio con semilla (mulberry32): mismo cruce, mismo resultado.
  function azar(semilla) {
    var a = semilla >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function semillaDe(texto) {
    var h = 2166136261;
    for (var i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Constantes del simulador (promedios reales de la NFL reciente).
  var SIM = {
    series: [10, 11, 11, 12, 12, 13], // series ofensivas por equipo en un partido
    mediaSeries: 11.5,
    parteTD: 0.775,   // fracción de los puntos que llega por touchdowns
    extra: 0.90,      // touchdowns seguidos de patada de punto extra
    extraOk: 0.945,   // acierto del punto extra
    dosOk: 0.48,      // acierto de la conversión de 2 puntos
    ajuste: 1.016,    // compensa los puntos que se pierden al dejar correr el reloj al final
    conformarse: 0.7  // veces que, al final y con el marcador apretado, se patea en vez de buscar el touchdown
  };

  function probsSerie(esperado) {
    var porSerie = Math.max(0.3, esperado) * SIM.ajuste / SIM.mediaSeries;
    var valorTD = 6 + SIM.extra * SIM.extraOk + (1 - SIM.extra) * 2 * SIM.dosOk;
    var td = porSerie * SIM.parteTD / valorTD, gc = porSerie * (1 - SIM.parteTD) / 3;
    if (td + gc > 0.92) { var f = 0.92 / (td + gc); td *= f; gc *= f; }
    return [td, td + gc];
  }
  function serie(r, pr) {
    var u = r();
    if (u < pr[0]) return 6 + (r() < SIM.extra ? (r() < SIM.extraOk ? 1 : 0) : (r() < SIM.dosOk ? 2 : 0));
    return u < pr[1] ? 3 : 0;
  }

  // Última serie: quien va ganando y tiene el balón al final deja correr el reloj; quien está
  // empatado o abajo por 3 o menos suele conformarse con el gol de campo.
  function final(r, pr, dif, ultima) {
    if (ultima && dif > 0) return 0;
    var x = serie(r, pr);
    if (x >= 6 && dif <= 0 && dif >= -3 && r() < SIM.conformarse) return 3;
    return x;
  }

  /* Simula n partidos serie por serie. espL/espV = puntos esperados de cada equipo.
     Devuelve los marcadores de cada simulación (Int16Array) y el resumen. */
  function simular(espL, espV, n, semilla, eliminatoria) {
    var r = azar(semilla || 1), prL = probsSerie(espL), prV = probsSerie(espV);
    var L = new Int16Array(n), V = new Int16Array(n);
    var ganaL = 0, ganaV = 0, empates = 0, prorrogas = 0, sumaL = 0, sumaV = 0, i, s, k, a, b, x;
    for (i = 0; i < n; i++) {
      s = SIM.series[(r() * SIM.series.length) | 0]; a = 0; b = 0;
      var cierraL = r() < 0.5; // quién tiene la última posesión del partido
      for (k = 0; k < s; k++) {
        if (k < s - 1) { a += serie(r, prL); b += serie(r, prV); continue; }
        // Última serie de cada equipo: se juega según el marcador, como en un partido real.
        if (cierraL) { b += final(r, prV, b - a, false); a += final(r, prL, a - b, true); }
        else { a += final(r, prL, a - b, false); b += final(r, prV, b - a, true); }
      }
      if (a === b) {
        prorrogas++;
        // Prórroga (regla actual): una posesión para cada uno y después gana el primero que anota.
        var primeroL = r() < 0.5, ronda = 0, maxRondas = eliminatoria ? 50 : 3;
        while (a === b && ronda < maxRondas) {
          if (ronda === 0) {
            a += serie(r, prL); b += serie(r, prV);
          } else {
            x = serie(r, primeroL ? prL : prV);
            if (x) { if (primeroL) a += x; else b += x; break; }
            x = serie(r, primeroL ? prV : prL);
            if (x) { if (primeroL) b += x; else a += x; break; }
          }
          ronda++;
        }
      }
      L[i] = a; V[i] = b; sumaL += a; sumaV += b;
      if (a > b) ganaL++; else if (b > a) ganaV++; else empates++;
    }
    return {
      n: n, local: L, visita: V,
      pLocal: ganaL / n, pVisita: ganaV / n, pEmpate: empates / n, pProrroga: prorrogas / n,
      mediaLocal: sumaL / n, mediaVisita: sumaV / n
    };
  }

  // Probabilidad de que el local cubra un hándicap (p. ej. -3.5 = debe ganar por 4 o más).
  function cubrir(sim, handicapLocal) {
    var gana = 0, nulo = 0, i, d;
    for (i = 0; i < sim.n; i++) {
      d = sim.local[i] - sim.visita[i] + handicapLocal;
      if (d > 0) gana++; else if (d === 0) nulo++;
    }
    return { local: gana / sim.n, nulo: nulo / sim.n, visita: (sim.n - gana - nulo) / sim.n };
  }
  function totales(sim, linea) {
    var mas = 0, nulo = 0, i, t;
    for (i = 0; i < sim.n; i++) { t = sim.local[i] + sim.visita[i]; if (t > linea) mas++; else if (t === linea) nulo++; }
    return { mas: mas / sim.n, nulo: nulo / sim.n, menos: (sim.n - mas - nulo) / sim.n };
  }

  // Probabilidad implícita de una cuota americana, y sin el margen de la casa.
  function implicita(ml) { return ml == null ? null : ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100); }
  function sinMargen(mlLocal, mlVisita) {
    var a = implicita(mlLocal), b = implicita(mlVisita);
    return a == null || b == null ? null : a / (a + b);
  }

  return {
    PARAMS: PARAMS, SIM: SIM, ALIAS: ALIAS, leerCSV: leerCSV, prepararPartidos: prepararPartidos,
    calificar: calificar, predecir: predecir, esperar: esperar, simular: simular, cubrir: cubrir, totales: totales,
    azar: azar, semillaDe: semillaDe, implicita: implicita, sinMargen: sinMargen
  };
});
