# Simulador NFL

Sitio estático con los picks más probables de cada partido de la NFL: https://angel14-lab.github.io/simulador-nfl/

- **Partidos**: la jornada por días, con probabilidad de victoria, línea del mercado y el mejor pick de cada partido.
  Al abrir un partido se ven sus 10 picks más probables y, plegado, el análisis (diferencia de puntos, total, equipos, bajas).
- **Mejores picks**: los más probables de toda la jornada.
- **Aciertos**: cada pick se guarda antes del partido y se califica al terminar.
- **Equipos** y **Método**: calificaciones del modelo y la validación de los picks.

## Cómo se calculan

1. Puntos esperados de cada equipo: 85% línea del mercado y 15% modelo propio (equipos, quarterbacks, eficiencia y lesiones).
2. 100 000 simulaciones por partido, serie ofensiva por serie.
3. Picks en mercados validados (ganador, hándicap y total alternativos, touchdowns del partido y de cada equipo, yardas
   de jugadores y pases de touchdown), solo entre 65% y 80% de probabilidad. Se muestran los 10 mejores por partido.

`node herramientas/validar-picks.js` repite la prueba con los partidos de 2016 a 2025 (74.5% de acierto en 20 823 picks)
y guarda el resumen en `datos/validacion-picks.json`.

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
