import { numero, porcentaje, escaparHtml } from './formato.js';

const MARGEN = 16;

export function crearTooltip(catalogo, { barrera }) {
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.setAttribute('role', 'tooltip');
  document.body.append(el);

  let pintado = null; // evita regenerar el HTML en cada pointermove

  function contenido(r) {
    const partidos = Object.keys(r.votos).sort(
      (a, b) => (r.escanos[b] ?? 0) - (r.escanos[a] ?? 0) || r.votos[b] - r.votos[a],
    );
    const dentro = partidos.filter((p) => r.elegibles.includes(p));
    const fuera = partidos.filter((p) => !r.elegibles.includes(p));
    const maxCuota = Math.max(...dentro.map((p) => r.votos[p] / r.validos), 0.01);

    const filas = dentro
      .map((p) => {
        const cuota = r.votos[p] / r.validos;
        const esc = r.escanos[p] ?? 0;
        const color = catalogo.color(p);
        const asientos = Array.from({ length: esc }, () => `<i style="background:${color}"></i>`).join('');
        return `
          <div class="tt-fila${esc ? '' : ' tt-fila--sin'}">
            <span class="tt-chip" style="background:${color}"></span>
            <span class="tt-partido">${escaparHtml(catalogo.nombre(p, r.ccaa))}</span>
            <span class="tt-pct">${porcentaje(cuota)}</span>
            <span class="tt-esc">${esc}</span>
            <span class="tt-barra"><b style="width:${(cuota / maxCuota) * 100}%;background:${color}"></b></span>
            <span class="tt-votos">${numero(r.votos[p])} votos</span>
            <span class="tt-asientos">${asientos}</span>
          </div>`;
      })
      .join('');

    const bajoBarrera = fuera.length
      ? `<p class="tt-nota">Bajo el ${porcentaje(barrera).replace(',0', '')}: ${fuera
          .map((p) => `${escaparHtml(catalogo.nombre(p, r.ccaa))} (${porcentaje(r.votos[p] / r.validos)})`)
          .join(', ')}</p>`
      : '';

    const ultimo =
      r.ultimo && r.siguiente
        ? `<p class="tt-ultimo"><strong>Último escaño:</strong> ${escaparHtml(catalogo.nombre(r.ultimo.partido, r.ccaa))}.
           A ${escaparHtml(catalogo.nombre(r.siguiente.partido, r.ccaa))} le faltaron ~${numero(r.siguiente.votosQueFaltan)} votos.</p>`
        : '';

    const coalicion =
      (r.perdidosCoalicion ? `<p class="tt-nota">Fricción de coalición: −${numero(r.perdidosCoalicion)} votos a la abstención.</p>` : '') +
      (r.ganadosCoalicion ? `<p class="tt-nota">Bonificación por unidad: +${numero(r.ganadosCoalicion)} votos a la coalición.</p>` : '');

    return `
      <header class="tt-cabecera" style="--c:${catalogo.color(r.ganador)}">
        <div>
          <h3>${escaparHtml(r.nombre)}</h3>
          <p>${r.escanosEnJuego} ${r.escanosEnJuego === 1 ? 'escaño' : 'escaños'} · participación ${porcentaje(r.participacion)}</p>
        </div>
        <span class="tt-ganador">${escaparHtml(catalogo.nombre(r.ganador, r.ccaa))}</span>
      </header>
      <div class="tt-cols"><span></span><span>Partido</span><span>Voto</span><span>Esc.</span></div>
      ${filas}
      ${ultimo}${bajoBarrera}${coalicion}`;
  }

  function posicionar(x, y) {
    const { width, height } = el.getBoundingClientRect();
    let left = x + MARGEN;
    let top = y + MARGEN;
    if (left + width > window.innerWidth - 8) left = x - width - MARGEN;
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    el.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
  }

  return {
    mostrar(resultado, evento) {
      if (pintado !== resultado) {
        el.innerHTML = contenido(resultado);
        pintado = resultado;
      }
      el.classList.add('tooltip--visible');
      posicionar(evento.clientX, evento.clientY);
    },
    ocultar() {
      el.classList.remove('tooltip--visible');
    },
  };
}
