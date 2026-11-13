# Simulador NFL

Sitio estático que estima los resultados de los partidos de la NFL con datos reales y miles de simulaciones.
Publicado con GitHub Pages en https://angel14-lab.github.io/simulador-nfl/

- **Jornada**: probabilidad de victoria, marcador medio, hándicap estimado, línea real del mercado y los tres picks más probables de cada partido.
- **Mejores picks**: los picks más probables de toda la jornada (ganador, hándicap, total, yardas, recepciones y touchdowns de jugadores) con su cuota justa.
- **Detalle del partido**: picks, anotadores probables, hándicaps y totales a cualquier línea, proyección de cada jugador con calculadora de líneas, comparación de equipos y parte de lesiones.
- **Aciertos**: cada pronóstico se congela 10 minutos antes del inicio (con la última actualización previa) y al terminar se marca como acertado, fallado o anulado.
- **Cruce libre**: cualquier equipo contra cualquier otro, en casa o en campo neutral.
- **Equipos**: calificaciones de ataque, defensa y quarterback, marca contra el hándicap y contra el total.
- **Precisión y método**: comparación con los resultados reales y con el mercado desde 2016, y calibración de las proyecciones de jugadores.

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
