import { escaparHtml } from './formato.js';

/** Leyenda del mapa: partidos que ganan al menos una provincia y cuántas. */
export function crearLeyenda(contenedor, catalogo) {
  return {
    vaciar() {
      contenedor.innerHTML = '<p class="leyenda__titulo"><span>Sin datos: carga encuestas para pintar el mapa.</span></p>';
    },
    actualizar(resultado) {
      const conteo = {};
      for (const r of resultado.provincias) conteo[r.ganador] = (conteo[r.ganador] ?? 0) + 1;
      const partidos = Object.keys(conteo).sort((a, b) => conteo[b] - conteo[a]);

      contenedor.innerHTML = `
        <p class="leyenda__titulo">Ganador por provincia <span>· intensidad = % del ganador</span></p>
        <ul class="leyenda__items">
          ${partidos
            .map(
              (p) => `<li>
                <span class="leyenda__chip" style="background:${catalogo.color(p)}"></span>
                ${escaparHtml(catalogo.nombre(p))}
                <span class="leyenda__n">${conteo[p]}</span>
              </li>`,
            )
            .join('')}
        </ul>
        <div class="leyenda__escala" aria-hidden="true"><span>25 %</span><b></b><span>50 %+</span></div>`;
    },
  };
}
