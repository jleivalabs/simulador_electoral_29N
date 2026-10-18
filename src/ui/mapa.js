import * as d3 from 'd3';
import { feature } from 'topojson-client';
import { geoConicConformalSpain } from 'd3-composite-projections';

const ANCHO = 800;
const ALTO = 600;

const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Mapa provincial. La provincia se identifica por el código INE del TopoJSON
 * (es-atlas usa el código INE como id) y, si no cuadra, por nombre/alias.
 */
export function crearMapa(contenedor, topologia, provincias, catalogo, eventos) {
  const svg = d3
    .select(contenedor)
    .append('svg')
    .attr('viewBox', `0 0 ${ANCHO} ${ALTO}`)
    .attr('role', 'img')
    .attr('aria-label', 'Mapa de España por provincias coloreado según el partido ganador');

  const proyeccion = geoConicConformalSpain().scale(3200).translate([ANCHO / 2, ALTO / 2]);
  const ruta = d3.geoPath(proyeccion);
  const features = feature(topologia, topologia.objects.provinces).features;

  const porNombre = provincias.map((p) => ({ ine: p.ine, claves: [p.nombre, ...(p.alias ?? [])].map(normalizar) }));
  const ineDe = (f) => {
    const id = String(f.id ?? '').padStart(2, '0');
    if (provincias.some((p) => p.ine === id)) return id;
    const nombre = normalizar(f.properties?.name);
    return porNombre.find((p) => p.claves.some((c) => nombre.includes(c)))?.ine ?? null;
  };
  features.forEach((f) => (f.ine = ineDe(f)));

  const sinCruce = features.filter((f) => !f.ine).map((f) => f.properties?.name);
  if (sinCruce.length) console.warn('Provincias del mapa sin cruce con los datos:', sinCruce);

  let resultadoActual = null;
  const resultadoDe = (f) => resultadoActual?.porIne.get(f.ine);

  const paths = svg
    .append('g')
    .selectAll('path')
    .data(features)
    .join('path')
    .attr('class', 'provincia')
    .attr('d', ruta)
    .attr('fill', '#e2e8f0')
    .attr('tabindex', 0)
    .on('pointerenter pointermove', (event, f) => {
      const r = resultadoDe(f);
      if (r) eventos.mostrar(r, event);
    })
    .on('pointerleave blur', () => eventos.ocultar())
    .on('focus', function (event, f) {
      const r = resultadoDe(f);
      if (!r) return;
      const caja = this.getBoundingClientRect();
      eventos.mostrar(r, { clientX: caja.left + caja.width / 2, clientY: caja.top + caja.height / 2 });
    });

  // Recuadro que separa Canarias de la península.
  svg.append('path').attr('class', 'borde-canarias').attr('d', proyeccion.getCompositionBorders());

  // La intensidad del color refleja el porcentaje del ganador (mapa de "fuerza").
  const opacidad = d3.scaleLinear().domain([0.25, 0.5]).range([0.55, 1]).clamp(true);

  return {
    /** Estado sin datos: provincias en gris y sin tooltip. */
    vaciar() {
      resultadoActual = null;
      paths
        .attr('aria-label', (f) => f.properties?.name)
        .transition()
        .duration(400)
        .attr('fill', '#e2e8f0')
        .attr('fill-opacity', 1);
    },
    actualizar(resultado) {
      resultadoActual = resultado;
      paths
        .attr('aria-label', (f) => {
          const r = resultadoDe(f);
          return r ? `${r.nombre}: gana ${catalogo.nombre(r.ganador, r.ccaa)}` : f.properties?.name;
        })
        .transition()
        .duration(650)
        .attr('fill', (f) => {
          const r = resultadoDe(f);
          return r ? catalogo.color(r.ganador) : '#e2e8f0';
        })
        .attr('fill-opacity', (f) => {
          const r = resultadoDe(f);
          return r ? opacidad(r.cuotaGanador) : 1;
        });
    },
  };
}
