const fmtNum = new Intl.NumberFormat('es-ES');
const fmtPct = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const numero = (n) => fmtNum.format(Math.round(n));
export const porcentaje = (x) => fmtPct.format(x);

export const COLOR_NEUTRO = '#94a3b8';

/** Catálogo de partidos con acceso por id y etiqueta regional. */
export function crearCatalogo(lista) {
  const porId = new Map(lista.map((p) => [p.id, p]));
  return {
    color: (id) => porId.get(id)?.color ?? COLOR_NEUTRO,
    nombre: (id, ccaa) => {
      const p = porId.get(id);
      return p?.etiquetas?.[ccaa] ?? p?.nombre ?? id;
    },
    corto: (id) => porId.get(id)?.corto ?? porId.get(id)?.nombre ?? id,
    posicion: (id) => porId.get(id)?.posicion ?? 999,
  };
}

export function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
