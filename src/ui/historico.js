import { escaparHtml } from './formato.js';
import { fechaCorta } from './panelEncuestas.js';

const CLAVE = 'simulador-electoral:historico:v1';
const fmtHora = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const pct = (v) => (v == null ? '' : v.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

function leer() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE));
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

function escribir(entradas) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(entradas));
    return true;
  } catch {
    return false; // sin almacenamiento o cuota llena
  }
}

const celdaCsv = (v) => {
  let s = String(v ?? '');
  // Inyección de fórmulas: un texto que empiece por = + - @ (p. ej. un nombre de encuestadora del CSV cargado)
  // se ejecutaría como fórmula al abrirlo en Excel; se antepone un apóstrofo. Los números no se tocan.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Histórico de promedios de encuestas: guarda una foto de cada ponderación probada
 * (archivos, parámetros, estimación y escaños), permite volver a cargarla y exportarlo a CSV.
 * Se guarda en el navegador (localStorage).
 */
export function crearHistorico(seccion, catalogo, { onRestaurar }) {
  let entradas = leer();
  let actual = null;

  seccion.innerHTML = `
    <div class="hist-cab">
      <h2 id="t-hist">Histórico de promedios</h2>
      <div class="hist-acciones">
        <button type="button" class="carga__boton hist-guardar" data-accion="guardar">Guardar promedio actual</button>
        <button type="button" class="carga__enlace" data-accion="exportar">Descargar CSV</button>
      </div>
    </div>
    <p class="hist-estado enc-resumen" aria-live="polite"></p>
    <div class="hist-zona"></div>`;

  const botonGuardar = seccion.querySelector('[data-accion=guardar]');
  const botonExportar = seccion.querySelector('[data-accion=exportar]');
  const estado = seccion.querySelector('.hist-estado');
  const zona = seccion.querySelector('.hist-zona');

  function render() {
    botonGuardar.disabled = !actual;
    botonExportar.disabled = !entradas.length;
    if (!entradas.length) {
      zona.innerHTML = '<p class="enc-nota">Todavía no hay promedios guardados. Pulsa «Guardar promedio actual» después de cada prueba.</p>';
      return;
    }
    // Columnas: partidos con escaños en alguna entrada, por escaños de la más reciente.
    const ultima = entradas[0];
    const partidos = [...new Set(entradas.flatMap((e) => Object.keys(e.escanos).filter((p) => e.escanos[p] > 0)))].sort(
      (a, b) => (ultima.escanos[b] ?? 0) - (ultima.escanos[a] ?? 0) || catalogo.posicion(a) - catalogo.posicion(b),
    );
    const cab = partidos
      .map((p) => `<th scope="col" title="${escaparHtml(catalogo.nombre(p))}"><span class="enc-chip" style="background:${catalogo.color(p)}"></span>${escaparHtml(catalogo.corto(p))}</th>`)
      .join('');
    const filas = entradas
      .map(
        (e) => `<tr>
          <th scope="row">${fmtHora.format(new Date(e.guardado))}<small>${escaparHtml(e.archivos.map((a) => a.nombre).join(', '))}</small></th>
          <td>${fechaCorta(e.fechaReferencia)}<small>${e.encuestas} encuestas</small></td>
          ${partidos.map((p) => `<td title="${pct(e.estimacion[p])} %">${e.escanos[p] ?? 0}<small>${pct(e.estimacion[p])}</small></td>`).join('')}
          ${e.bloques.map((b) => `<td class="${b.escanos >= e.mayoria ? 'hist-mayoria' : ''}">${b.escanos}</td>`).join('')}
          <td class="hist-btns">
            <button type="button" class="carga__enlace" data-cargar="${e.id}">Cargar</button>
            <button type="button" class="hist-borrar" data-borrar="${e.id}" aria-label="Borrar entrada">×</button>
          </td>
        </tr>`,
      )
      .join('');
    const cabBloques = ultima.bloques.map((b) => `<th scope="col" title="${escaparHtml(b.nombre)}">${escaparHtml(b.corto)}</th>`).join('');
    zona.innerHTML = `
      <div class="enc-tabla-wrap">
        <table class="enc-tabla hist-tabla">
          <thead><tr><th scope="col">Guardado</th><th scope="col">Referencia</th>${cab}${cabBloques}<th scope="col"></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <p class="enc-nota">Escaños y, debajo, % de voto estimado. Se guarda solo en este navegador.</p>`;
  }

  seccion.addEventListener('click', (ev) => {
    const accion = ev.target.closest('[data-accion]')?.dataset.accion;
    if (accion === 'guardar' && actual) {
      entradas = [{ ...actual, id: `${Date.now()}`, guardado: new Date().toISOString() }, ...entradas];
      estado.textContent = escribir(entradas) ? 'Promedio guardado en el histórico.' : 'No se pudo guardar: el navegador no permite almacenamiento.';
      render();
    }
    if (accion === 'exportar' && entradas.length) exportar();

    const cargar = ev.target.closest('[data-cargar]')?.dataset.cargar;
    if (cargar) {
      const e = entradas.find((x) => x.id === cargar);
      if (e) {
        onRestaurar(e);
        estado.textContent = `Cargadas las encuestas guardadas el ${fmtHora.format(new Date(e.guardado))}.`;
      }
    }
    const borrar = ev.target.closest('[data-borrar]')?.dataset.borrar;
    if (borrar) {
      entradas = entradas.filter((x) => x.id !== borrar);
      escribir(entradas);
      estado.textContent = 'Entrada borrada.';
      render();
    }
  });

  function exportar() {
    const partidos = [...new Set(entradas.flatMap((e) => [...Object.keys(e.escanos), ...Object.keys(e.estimacion)]))];
    const nombresBloques = [...new Set(entradas.flatMap((e) => e.bloques.map((b) => b.nombre)))];
    const cabecera = ['guardado', 'fecha_referencia', 'n_encuestas', 'encuestadoras', 'archivos', ...partidos.flatMap((p) => [`${p}_pct`, `${p}_escanos`]), ...nombresBloques];
    const lineas = entradas.map((e) =>
      [
        e.guardado,
        e.fechaReferencia,
        e.encuestas,
        e.encuestadoras.join(' | '),
        e.archivos.map((a) => a.nombre).join(' | '),
        ...partidos.flatMap((p) => [e.estimacion[p] ?? '', e.escanos[p] ?? 0]),
        ...nombresBloques.map((n) => e.bloques.find((b) => b.nombre === n)?.escanos ?? ''),
      ]
        .map(celdaCsv)
        .join(','),
    );
    const blob = new Blob(['﻿' + [cabecera.join(','), ...lineas].join('\n')], { type: 'text/csv;charset=utf-8' });
    const enlace = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `historico_promedios_${new Date().toISOString().slice(0, 10)}.csv` });
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  render();

  return {
    /** Foto del promedio que se está viendo (o null si no hay encuestas): lo que guardará el botón. */
    setActual(foto) {
      actual = foto;
      botonGuardar.disabled = !actual;
    },
    mostrar(visible) {
      seccion.hidden = !visible;
    },
  };
}
