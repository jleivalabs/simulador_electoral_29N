import * as d3 from 'd3';
import { escaparHtml } from './formato.js';

const ANCHO = 600;
const RADIO = 280;
const CX = ANCHO / 2;
const CY = 300;

/** Posiciones de los escaños en filas concéntricas, ordenadas de izquierda a derecha. */
function layout(total, filas = 12, radioInterno = 0.38) {
  const radios = d3.range(filas).map((i) => radioInterno + ((1 - radioInterno) * i) / (filas - 1));
  const sumaRadios = d3.sum(radios);
  const porFila = radios.map((r) => Math.round((total * r) / sumaRadios));
  porFila[filas - 1] += total - d3.sum(porFila);

  const puntos = [];
  radios.forEach((r, i) => {
    const n = porFila[i];
    for (let j = 0; j < n; j++) {
      const angulo = n === 1 ? Math.PI / 2 : Math.PI * (1 - j / (n - 1));
      puntos.push({ angulo, r, x: CX + r * RADIO * Math.cos(angulo), y: CY - r * RADIO * Math.sin(angulo) });
    }
  });
  puntos.sort((a, b) => b.angulo - a.angulo || a.r - b.r);
  return { puntos, radioPunto: (((1 - radioInterno) / (filas - 1)) * RADIO) * 0.42 };
}

export function crearHemiciclo(contenedor, catalogo, { totalEscanos, mayoriaAbsoluta, bloques }) {
  contenedor.innerHTML = `
    <svg class="hemi-svg" viewBox="0 0 ${ANCHO} ${CY + 12}" role="img" aria-label="Hemiciclo del Congreso"></svg>
    <div class="hemi-barra" aria-hidden="true"><div class="hemi-barra__segmentos"></div><span class="hemi-barra__mayoria"></span></div>
    <div class="hemi-bloques"></div>
    <ul class="hemi-lista"></ul>`;

  const { puntos, radioPunto } = layout(totalEscanos);
  const svg = d3.select(contenedor).select('svg');
  const escanos = svg
    .append('g')
    .selectAll('circle')
    .data(puntos)
    .join('circle')
    .attr('cx', (d) => d.x)
    .attr('cy', (d) => d.y)
    .attr('r', radioPunto)
    .attr('fill', '#e2e8f0');

  const textoMayoria = svg.append('text').attr('class', 'hemi-centro').attr('x', CX).attr('y', CY - 34);
  const textoSub = svg.append('text').attr('class', 'hemi-centro-sub').attr('x', CX).attr('y', CY - 8);

  contenedor.querySelector('.hemi-barra__mayoria').style.left = `${(mayoriaAbsoluta / totalEscanos) * 100}%`;

  const segmentos = d3.select(contenedor).select('.hemi-barra__segmentos');
  const zonaBloques = d3.select(contenedor).select('.hemi-bloques');
  const lista = d3.select(contenedor).select('.hemi-lista');

  return {
    /** Estado sin datos: escaños en gris, sin barras ni lista. */
    vaciar() {
      escanos.interrupt().transition().duration(300).attr('fill', '#e2e8f0');
      textoMayoria.text('');
      textoSub.text('Sin datos');
      segmentos.selectAll('span').interrupt().transition().duration(300).style('width', '0%');
      zonaBloques.selectAll('.bloque').remove();
      lista.html('');
    },
    /**
     * @param {Record<string, number>} totales  escaños por partido
     * @param {Record<string, number>|null} previos  escaños del escenario anterior (para los deltas)
     */
    actualizar(totales, previos) {
      const orden = Object.keys(totales)
        .filter((p) => totales[p] > 0)
        .sort((a, b) => catalogo.posicion(a) - catalogo.posicion(b));

      const colores = orden.flatMap((p) => Array(totales[p]).fill(catalogo.color(p)));
      escanos
        .transition()
        .delay((_, i) => i * 2.5)
        .duration(450)
        .attr('fill', (_, i) => colores[i] ?? '#e2e8f0');

      const lider = orden.reduce((a, b) => (totales[b] > totales[a] ? b : a), orden[0]);
      textoMayoria.text(`${totales[lider]}`).attr('fill', catalogo.color(lider));
      textoSub.text(
        totales[lider] >= mayoriaAbsoluta
          ? `${catalogo.nombre(lider)} · mayoría absoluta`
          : `${catalogo.nombre(lider)} · mayoría en ${mayoriaAbsoluta}`,
      );

      // Barra apilada con la línea de mayoría absoluta.
      segmentos
        .selectAll('span')
        .data(orden, (p) => p)
        .join((enter) => enter.append('span').style('width', '0%'))
        .attr('title', (p) => `${catalogo.nombre(p)}: ${totales[p]}`)
        .style('background', (p) => catalogo.color(p))
        .transition()
        .duration(700)
        .style('width', (p) => `${(totales[p] / totalEscanos) * 100}%`);

      // Bloques: ¿alcanzan los 176?
      const datosBloques = bloques.map((b) => ({ ...b, escanos: d3.sum(b.partidos, (p) => totales[p] ?? 0) }));
      const filasBloque = zonaBloques
        .selectAll('.bloque')
        .data(datosBloques, (b) => b.nombre)
        .join((enter) => {
          const div = enter.append('div').attr('class', 'bloque');
          div.html(`<div class="bloque__cab"><span class="bloque__nombre"></span><strong class="bloque__num">0</strong></div>
                    <div class="bloque__pista"><b></b><i></i></div>`);
          div.select('.bloque__pista i').style('left', `${(mayoriaAbsoluta / totalEscanos) * 100}%`);
          return div;
        });
      filasBloque.classed('bloque--mayoria', (b) => b.escanos >= mayoriaAbsoluta);
      filasBloque.select('.bloque__nombre').text((b) => b.nombre);
      filasBloque
        .select('.bloque__num')
        .transition()
        .duration(700)
        .textTween(function (b) {
          const desde = Number(this.textContent) || 0;
          return (t) => `${Math.round(desde + (b.escanos - desde) * t)}`;
        });
      filasBloque
        .select('.bloque__pista b')
        .transition()
        .duration(700)
        .style('width', (b) => `${(b.escanos / totalEscanos) * 100}%`);

      // Lista de partidos con variación respecto al escenario anterior.
      const todos = new Set([...orden, ...Object.keys(previos ?? {}).filter((p) => previos[p] > 0)]);
      const filas = [...todos].sort((a, b) => (totales[b] ?? 0) - (totales[a] ?? 0) || (previos?.[b] ?? 0) - (previos?.[a] ?? 0));
      lista.html(
        filas
          .map((p) => {
            const n = totales[p] ?? 0;
            const delta = previos ? n - (previos[p] ?? 0) : 0;
            const chip = delta
              ? `<span class="delta ${delta > 0 ? 'delta--sube' : 'delta--baja'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span>`
              : '<span class="delta delta--igual">=</span>';
            return `<li class="${n ? '' : 'hemi-lista--fuera'}">
                <span class="hemi-chip" style="background:${catalogo.color(p)}"></span>
                <span class="hemi-nombre">${escaparHtml(catalogo.nombre(p))}</span>
                <strong>${n}</strong>${previos ? chip : ''}
              </li>`;
          })
          .join(''),
      );
    },
  };
}
