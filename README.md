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
3. Picks en mercados validados: ganador, hándicap y «más de X puntos» con líneas alternativas, y yardas de jugadores
   con rol fijo y sin restricciones en el parte de lesiones. Solo entre 65% y 80% (cuota de 1.25 o más), hasta 10 por partido.
   Con líneas reales de la casa, los de jugadores promedian el modelo calibrado y la casa sin margen.
4. Arriesgados aparte: de 55% a 65% y cuota de 1.55 o más, hasta 3 por partido.

## Validación, fuera de muestra

Los parámetros se eligieron solo con 2016-2022 (`herramientas/ajustar-fuera-de-muestra.js`) y el acierto se mide en
2023-2025, años que no se usaron para elegirlos.

| Prueba | Picks | Acertaron | Anunciaban |
|---|---|---|---|
| Picks de partido mostrados, 2023-2025 (`validar-picks.js`) | 2 772 | 74.7% | 71.3% |
| Yardas de jugador de 65% o más, 2023-2025, línea estimada (`calibrar-jugadores.js`) | 1 079 | 68.8% | 68.8% |
| Arriesgados, 2016-2025 (`validar-riesgo.js`) | 8 250 | 58.2% | 57.2% |

La prueba de jugadores usa como línea la mediana de sus últimos 10 partidos, no la de la casa: contra la línea real el
modelo solo resultó sobreconfiado (87 picks de las semanas 10-11 anunciaban 56% y acertaron 42.5%), y por eso ahí se
promedia con la casa. `datos/validacion-picks.json` guarda el resumen de la prueba de partido.

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
| `herramientas/actualizar-datos.js` | Actualiza la copia local de los datos (partidos, eficiencia y lesiones). |

Las probabilidades son estimaciones estadísticas: el modelo no lee noticias ni distingue a una estrella lesionada de un suplente.
