import { numero, escaparHtml } from './formato.js';

const fmtFecha = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fechaCorta = (iso) => fmtFecha.format(new Date(`${iso}T00:00:00Z`));
const fmtDiaMes = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const diaMes = (iso) => fmtDiaMes.format(new Date(`${iso}T00:00:00Z`));

const pct = (v) => (v == null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/** Tabla de encuestas usadas en el promedio, con su peso y la estimación final. */
export function crearPanelEncuestas(seccion, catalogo) {
  return {
    render(agregado) {
      seccion.innerHTML = agregado?.usadas?.length ? contenido(agregado, catalogo) : '';
    },
    mostrar(visible) {
      seccion.hidden = !visible;
    },
  };
}

function contenido(agregado, catalogo) {
  const partidos = Object.keys(agregado.estimacion);
  const { parametros: p } = agregado;
  const encuestadoras = Object.entries(p.encuestadoras ?? {})
    .map(([nombre, c]) => (c.incluir === false ? `${nombre} excluido` : `${nombre} con peso ×${c.peso ?? 1}`))
    .join(' · ');

  const cabecera = partidos
    .map(
      (id) =>
        `<th scope="col" title="${escaparHtml(catalogo.nombre(id))}"><span class="enc-chip" style="background:${catalogo.color(id)}"></span>${escaparHtml(catalogo.corto(id))}</th>`,
    )
    .join('');

  const filas = agregado.usadas
    .map(
      (e) => `<tr>
        <th scope="row">${escaparHtml(e.encuestadora)}<small>${escaparHtml(e.medio)}</small></th>
        <td>${diaMes(e.finCampo)}<small>n = ${numero(e.muestra)} · ${e.antiguedadDias} d</small></td>
        <td class="enc-peso"><span><b style="width:${e.peso * 100}%"></b></span>${(e.peso * 100).toFixed(0)} %</td>
        ${partidos.map((id) => `<td>${pct(e.estimacion[id])}${e.escanos?.[id] != null ? `<small>${e.escanos[id]} esc.</small>` : ''}</td>`).join('')}
      </tr>`,
    )
    .join('');

  const descartadas = agregado.descartadas.length
    ? `<p class="enc-nota"><strong>Descartadas:</strong> ${agregado.descartadas
        .map((d) => `${escaparHtml(d.encuestadora)} (${fechaCorta(d.finCampo)}): ${escaparHtml(d.motivo)}`)
        .join(' · ')}</p>`
    : '';

  return `
    <h2 id="t-enc">Encuestas utilizadas</h2>
    ${agregado.datosDeEjemplo ? '<p class="enc-aviso">Datos de ejemplo: incluye encuestas ficticias. Carga tus CSV de encuestas reales con el botón «Cargar CSV de encuestas».</p>' : ''}
    <p class="enc-resumen">
      Promedio ponderado de ${agregado.usadas.length} encuestas a ${fechaCorta(agregado.fechaReferencia)}.
      Peso: vida media de ${p.vidaMediaDias} días × √(muestra / ${numero(p.muestraReferencia)})${p.unaPorEncuestadora ? ', una encuesta por empresa' : ''}; ventana de ${p.ventanaDias} días.
      ${encuestadoras ? `Ajustes: ${escaparHtml(encuestadoras)}.` : ''}
    </p>
    <div class="enc-tabla-wrap">
      <table class="enc-tabla">
        <thead><tr><th scope="col">Encuestadora</th><th scope="col">Fin de campo</th><th scope="col">Peso</th>${cabecera}</tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><th scope="row" colspan="3">Promedio ponderado</th>${partidos
          .map((id) => {
            const esc = agregado.escanosPublicados?.escanos[id];
            return `<td>${pct(agregado.estimacion[id])}${esc != null ? `<small>${esc} esc.</small>` : ''}</td>`;
          })
          .join('')}</tr></tfoot>
      </table>
    </div>
    ${descartadas}`;
}
