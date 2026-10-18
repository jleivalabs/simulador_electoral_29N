# Encuestas reales de prueba (consultadas el 16/10/2026)

Fuente: tabla de estimación de voto de Wikipedia, «Opinion polling for the 2026 Spanish general election»
(licencia CC BY-SA). Cada fila de la tabla enlaza a la publicación original del medio o de la encuestadora.
Las cifras se copiaron de la tabla tal cual. **Antes de publicarlas, contrástalas con la fuente original.**

| Archivo | Contenido |
|---|---|
| `1_privadas_semana_6-11oct.csv` | 10 encuestas de empresas privadas con campo cerrado entre el 6 y el 11 de octubre |
| `2_cis_octubre.csv` | Estimación oficial del CIS, barómetro de octubre (estudio 3582), campo del 1 al 6 de octubre |
| `3_reestimaciones_cis_octubre.csv` | Reestimaciones de Opina 360 y del Ateneo del Dato **sobre la misma muestra del CIS** |
| `4_electomania_panel.csv` | ElectoPanel de Electomanía (panel online, no probabilístico): dos oleadas |
| `5_semana_anterior_1-3oct.csv` | SocioMétrica (1–3 oct) y Data10 (2 oct) |
| `6_electopanel_18oct_tras_alianzas.csv` | ElectoPanel del 18/10 (campo 15–17 oct, n = 3.141): **primer sondeo con las candidaturas definitivas del 29-N**. Fuente: electomania.es, contrastado con Wikipedia (tabla «2026 (after FA)»). Columnas FA y ERC adaptadas al modelo; el detalle está en `notas` |

Criterios:

- Las celdas con «?» o «–» en Wikipedia se dejan vacías (partido no publicado o no medido).
- Sumar incluye a Compromís, según las notas de la tabla.
- Adelante Andalucía va en la columna `AA`. Es un partido regional (`ambito: ["AND"]` en `partidos.json`): su %
  nacional se reparte solo entre las provincias andaluzas.
- Se ha excluido InvyMark/laSexta (5–8 oct), porque no publica el tamaño de la muestra.
- Si cargas a la vez el archivo 2 y el 3, el mismo barómetro del CIS cuenta tres veces. Para ver el efecto, quita
  uno de los dos.
- Los archivos 4 y 5 sirven para probar las reglas de ponderación: al usar una encuesta por empresa, las oleadas
  anteriores de EM-Analytics y SocioMétrica se descartan.
