# Simulador NFL

Sitio estático con los picks más probables de cada partido de la NFL: https://angel14-lab.github.io/simulador-nfl/

- **Partidos**: la jornada por días, con probabilidad de victoria, línea del mercado y el mejor pick de cada partido.
  Al abrir un partido se ven sus 10 picks más probables y, plegado, el análisis (diferencia de puntos, total, equipos, bajas).
- **Mejores picks**: los más probables de toda la jornada.
- **Aciertos**: cada pick se guarda antes del partido y se califica al terminar.
- **Equipos** y **Método**: calificaciones del modelo y la validación de los picks.

## Cómo se calculan

1. Puntos esperados de cada equipo: los que implica la línea del mercado (hándicap y total). El modelo propio
   (equipos, quarterbacks, eficiencia y lesiones) se usa solo si no hay línea.
2. 100 000 simulaciones por partido, serie ofensiva por serie.
3. Picks en mercados validados: ganador, hándicap y «más de X puntos» con líneas alternativas; puntos y touchdowns
   de cada equipo («más de X»); primera mitad (ganador, hándicap y total); y yardas y recepciones de jugadores con rol
   fijo y sin restricciones en el parte de lesiones. Solo entre 65% y 80% (cuota de 1.25 o más), hasta 10 por partido y
   como mucho uno por mercado. Con líneas reales de la casa, los de jugadores promedian el modelo calibrado y la casa sin margen.
4. Arriesgados aparte: de 55% a 65% y cuota de 1.55 o más, hasta 3 por partido.

## Validación, fuera de muestra

Los parámetros se eligieron solo con 2016-2022 (`herramientas/ajustar-fuera-de-muestra.js`) y el acierto se mide en
2023-2025, años que no se usaron para elegirlos.

| Prueba | Picks | Acertaron | Anunciaban |
|---|---|---|---|
| Picks de partido mostrados, 2023-2025 (`validar-picks.js`) | 5 322 | 75.0% | 72.8% |
| — antes de la segunda tanda (sin los mercados nuevos) | 2 772 | 74.7% | 71.3% |
| Recepciones de 65-80%, 2023-2025, línea estimada (`probar-mercados-jugador.js`) | 1 778 | 71.7% | 70.9% |
| Yardas de jugador de 65% o más, 2023-2025, línea estimada (`calibrar-jugadores.js`) | 1 079 | 68.8% | 68.8% |
| Arriesgados, 2016-2025 (`validar-riesgo.js`) | 8 250 | 58.2% | 57.2% |

La prueba de jugadores usa como línea la mediana de sus últimos 10 partidos, no la de la casa: contra la línea real el
modelo solo resultó sobreconfiado (87 picks de las semanas 10-11 anunciaban 56% y acertaron 42.5%), y por eso ahí se
promedia con la casa. `datos/validacion-picks.json` guarda el resumen de la prueba de partido.

## Segunda tanda: qué entró y qué se descartó

Regla: cada cambio se ajusta solo con 2016-2022 y entra si mejora 2023-2025. Si no, queda descartado aunque suene lógico.

**Factores de contexto** (`herramientas/probar-factores.js`). Como los picks usan la línea del mercado, cada factor se
probó sobre lo que esa línea no explica (resultado real − línea): se ajusta su peso con 2016-2022 y se aplica a la línea en
2023-2025. Entraba si bajaba el error y subía el acierto de los picks (74.75% sin factores). Ninguno lo logró:

| Factor | Error² diferencia | Error² total | Acierto de los picks | |
|---|---|---|---|---|
| Lesiones contadas por posición (como en `modelo.js`) | 161.77 → 161.56 | 168.04 → 167.83 | 74.57% | descartado |
| Lesiones ponderadas por importancia (parte de yardas; % de jugadas en línea y defensa) | 161.77 → 161.08 | 168.04 → 167.12 | 74.53% | descartado |
| Estilo y ritmo (jugadas por partido, proporción de carreras) | — | 168.04 → 168.05 | 74.82% | descartado |
| Choque de eficiencias en carrera y pase | 161.77 → 161.61 | 168.04 → 168.23 | 74.69% | descartado |
| Calendario (semana corta, husos horarios, antes de la semana libre) | 161.77 → 162.37 | — | 74.86% | descartado |
| Partido divisional | 161.77 → 161.66 | 168.04 → 168.17 | 74.75% | descartado |
| Viento y frío (la lluvia prevista no está en los datos históricos) | — | 168.04 → 168.32 | 74.85% | descartado |
| Quarterback suplente o debutante | 161.77 → 162.47 | 168.04 → 168.76 | 74.80% | descartado |

La línea de cierre ya los recoge. Con el quarterback: a los equipos con titular nuevo les va 0.4-0.7 puntos mejor que su
línea (dentro del ruido), así que el ajuste del mercado basta; el del modelo propio castiga de más (~2 puntos), pero solo se
usa cuando no hay línea.

**Mercados nuevos** (`herramientas/probar-mercados.js` y `probar-mercados-jugador.js`). Calibración ajustada con 2016-2022;
entran si en 2023-2025 los picks de 65-80% aciertan al menos lo que anuncian (1 punto de tolerancia, 100 picks o más):

| Mercado | Picks 2023-2025 | Acertaron | Anunciaban | |
|---|---|---|---|---|
| Puntos de un equipo, más de X | 1 710 | 74.0% | 72.4% | entra |
| Touchdowns de un equipo, más de X | 720 | 75.7% | 75.2% | entra |
| 1ª mitad: ganador (el empate anula) | 168 | 71.4% | 70.6% | entra |
| 1ª mitad: hándicap | 1 700 | 73.6% | 72.6% | entra |
| 1ª mitad: total, más de X | 855 | 75.8% | 72.6% | entra |
| Recepciones de jugadores | 1 778 | 71.7% | 70.9% | entra |
| Yardas por tierra del QB | 21 | 90.5% | 68.1% | descartado: pocos picks; sin calibrar 66.0% anunciando 69.6% |
| Equipo que anota primero | 22 | 81.8% | 66.6% | descartado: casi nunca llega al 65%; 2016-2022 66.4% anunciando 68.7% |

Las líneas de equipo y de primera mitad son estimadas (no se bajan de la casa: con 500 créditos al mes de The Odds API no
alcanza). Las recepciones sí se bajan con las yardas (7 créditos por partido, ~480 al mes). Para la primera mitad, el
simulador reparte las series entre las dos mitades (en 2016-2022 la primera mitad se llevó el 50.5% de los puntos) y el
marcador al descanso sale del play-by-play de nflverse (`datos/mitades.csv`).

## Datos

Todo viene de [nflverse](https://github.com/nflverse): resultados, calendario, líneas de cierre y quarterbacks
([nfldata](https://github.com/nflverse/nfldata)), eficiencia por jugada (EPA), parte oficial de lesiones y estadísticas de jugadores
([nflverse-data](https://github.com/nflverse/nflverse-data)).

- Al abrirse, la página baja en vivo los partidos, las líneas y los quarterbacks anunciados.
- La eficiencia, las lesiones y los jugadores no se pueden bajar desde el navegador, así que salen de la copia de `datos/`,
  que el flujo `.github/workflows/actualizar-nfl.yml` renueva cada hora (también se puede lanzar a mano desde Actions).

Para renovar la copia a mano:

```bash
node herramientas/actualizar-datos.js
```

## Qué tiene en cuenta el modelo

Ataque y defensa de cada equipo, la nota del quarterback titular, eficiencia por jugada, descartados por lesión
según su posición, ventaja de local, semana libre previa y estadio techado. En cada partido se pueden añadir a mano
puntos por equipo y el viento previsto. Validado de 2016 a 2025: acierta el ganador el 64.7% de las veces
(el mercado, 66.1%) con un error medio de 10.05 puntos (el mercado, 9.78).

## Archivos

| Archivo | Qué hace |
|---|---|
| `modelo.js` | Calificaciones de ataque/defensa y simulador Monte Carlo serie por serie. |
| `app.js`, `estilos.css`, `index.html` | La interfaz. |
| `herramientas/ajustar.js` | Valida el modelo contra resultados reales (`--buscar` prueba otros parámetros). |
| `herramientas/validar-jugadores.js` | Comprueba las proyecciones de jugadores contra partidos reales (116 000 predicciones, 2023-2025). |
| `picks.js` | Picks de cada partido y su calificación; lo comparten la página y el registro automático. |
| `herramientas/registrar-picks.js` | Congela los picks antes de cada partido y los califica al terminar (`datos/historial.json`). |
| `herramientas/actualizar-datos.js` | Actualiza la copia local de los datos (partidos, eficiencia, lesiones y marcador al descanso). |
| `herramientas/probar-factores.js` | Prueba factores de contexto sobre lo que la línea del mercado no explica (segunda tanda). |
| `herramientas/probar-mercados.js`, `probar-mercados-jugador.js` | Prueban mercados candidatos y su calibración (segunda tanda). |

Las probabilidades son estimaciones estadísticas. El modelo no lee noticias; lo que pesa una baja importante entra a través de
la línea del mercado (ponderar las lesiones por importancia no mejoró la prueba).
