import { escaparHtml } from './formato.js';

/**
 * Panel del escenario de concentración: controles (escenario base, fricción, receptor del voto)
 * y tabla por comunidad con la candidatura receptora y los escaños que gana o pierde el bloque.
 *
 * Receptor: 'auto' (mejor opción en cada comunidad, sin PSOE), 'auto_psoe' (mejor opción, PSOE incluido)
 * o un partido concreto, en el que se concentra allí donde se presenta.
 */
export function crearPanelConcentracion(seccion, catalogo, nombresCcaa, { opciones, receptores, onCambio }) {
  seccion.innerHTML = `
    <h2 id="t-conc">Concentración del voto de izquierda por comunidad</h2>
    <form class="conc-controles">
      <label>Escenario base <select name="base"></select></label>
      <label>Concentrar en
        <select name="receptor">
          <option value="auto">Mejor opción en cada comunidad</option>
          <option value="auto_psoe">Mejor opción, PSOE incluido</option>
          <optgroup label="Siempre en"></optgroup>
        </select>
      </label>
      <label>Fricción (votos que se pierden) <span class="conc-friccion"><input type="range" name="friccion" min="0" max="40" step="5" /><output></output></span></label>
    </form>
    <div class="conc-resultado"></div>`;

  const form = seccion.querySelector('form');
  const salida = form.querySelector('output');
  const zona = seccion.querySelector('.conc-resultado');

  const grupoReceptores = form.receptor.querySelector('optgroup');
  form.friccion.value = Math.round(opciones.friccion * 100);
  salida.textContent = `${form.friccion.value} %`;

  form.addEventListener('input', () => {
    salida.textContent = `${form.friccion.value} %`;
    const valor = form.receptor.value;
    onCambio({
      base: form.base.value,
      friccion: Number(form.friccion.value) / 100,
      receptor: valor.startsWith('auto') ? 'auto' : valor,
      permitirPSOE: valor === 'auto_psoe',
    });
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  return {
    /**
     * @param {{id: string, nombre: string}[]} bases  escenarios base disponibles
     * @param {string[]} presentes  partidos receptores que concurren en la base (p. ej. sin Sumar en 2026)
     */
    render(resultado, bases, baseActual, mayoriaAbsoluta, presentes) {
      form.base.innerHTML = bases
        .map((b) => `<option value="${b.id}"${b.id === baseActual ? ' selected' : ''}>${escaparHtml(b.nombre)}</option>`)
        .join('');
      grupoReceptores.innerHTML = receptores
        .filter((p) => presentes.includes(p))
        .map((p) => `<option value="${p}">${escaparHtml(catalogo.nombre(p))}</option>`)
        .join('');
      form.receptor.value = opciones.receptor === 'auto' ? (opciones.permitirPSOE ? 'auto_psoe' : 'auto') : opciones.receptor;

      const { comunidades } = resultado.escenario.concentracion;
      const antes = comunidades.reduce((a, c) => a + c.escanosBloqueActual, 0);
      const despues = comunidades.reduce((a, c) => a + c.escanosBloqueConcentrado, 0);
      const orden = [...comunidades].sort(
        (a, b) => b.escanosBloqueConcentrado - b.escanosBloqueActual - (a.escanosBloqueConcentrado - a.escanosBloqueActual) || b.escanosEnJuego - a.escanosEnJuego,
      );

      const chip = (id) => `<span class="enc-chip" style="background:${catalogo.color(id)}"></span>${escaparHtml(catalogo.nombre(id))}`;
      const filas = orden
        .map((c) => {
          const gana = c.escanosBloqueConcentrado - c.escanosBloqueActual;
          const alternativas = c.opciones
            .map((o) => `<span class="${o.vehiculo === c.vehiculo ? 'conc-alt conc-alt--mejor' : 'conc-alt'}">${escaparHtml(catalogo.corto(o.vehiculo))} ${o.escanosBloque}</span>`)
            .join('');
          return `<tr>
            <th scope="row">${escaparHtml(nombresCcaa[c.ccaa] ?? c.ccaa)}<small>${c.escanosEnJuego} escaños</small></th>
            <td class="conc-vehiculo">${
              c.vehiculo
                ? chip(c.vehiculo) +
                  (c.empatados.length
                    ? `<small class="conc-empate">o, con el mismo resultado: ${c.empatados.map((p) => escaparHtml(catalogo.nombre(p))).join(', ')}</small>`
                    : '')
                : c.noSePresenta
                  ? '<span class="conc-igual">No se presenta en esta comunidad: sin cambio</span>'
                  : '<span class="conc-igual">Sin cambio: concentrar no suma escaños</span>'
            }</td>
            <td>${c.escanosBloqueActual} → <strong>${c.escanosBloqueConcentrado}</strong></td>
            <td>${
              gana > 0
                ? `<span class="delta delta--sube">+${gana}</span>`
                : gana < 0
                  ? `<span class="delta delta--baja">−${-gana}</span>`
                  : '<span class="delta delta--igual">=</span>'
            }</td>
            <td class="conc-alts">${alternativas || '—'}</td>
          </tr>`;
        })
        .join('');

      zona.innerHTML = `
        <p class="enc-resumen">
          El bloque de izquierdas (${escaparHtml(resultado.escenario.bloque.map((p) => catalogo.corto(p)).join(', '))}) pasa de
          <strong>${antes}</strong> a <strong>${despues}</strong> escaños (${despues - antes >= 0 ? '+' : ''}${despues - antes})
          ${despues >= mayoriaAbsoluta ? '· <strong class="conc-ok">alcanza la mayoría absoluta</strong>' : `· le faltan ${mayoriaAbsoluta - despues} para la mayoría absoluta`}.
          ${
            resultado.escenario.receptor && resultado.escenario.receptor !== 'auto'
              ? `Todo el voto de la izquierda alternativa se concentra en ${escaparHtml(catalogo.nombre(resultado.escenario.receptor))} allí donde se presenta, aunque el bloque pierda escaños.`
              : 'En cada comunidad se elige la candidatura receptora que más escaños da al bloque.'
          }
          La última columna muestra qué pasaría con cada receptora posible.
        </p>
        <p class="enc-nota">
          Este bloque no incluye PNV, Junts ni CC, que sí suman en el bloque del hemiciclo. La base es el cálculo del
          modelo provincial (en «Encuestas», no los escaños publicados), y las variaciones del hemiciclo se miden
          frente a esa base.
        </p>
        <div class="enc-tabla-wrap">
          <table class="enc-tabla conc-tabla">
            <thead><tr><th scope="col">Comunidad</th><th scope="col">Concentrar en</th><th scope="col">Bloque</th><th scope="col">Gana</th><th scope="col">Escaños del bloque según la candidatura receptora</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>`;
    },
    mostrar(visible) {
      seccion.hidden = !visible;
    },
  };
}
