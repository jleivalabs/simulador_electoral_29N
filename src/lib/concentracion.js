import { repartirProvincia, montarResultado } from './datos.js';
import { sumar } from './dhondt.js';

/**
 * Concentración del voto de izquierda por comunidad autónoma.
 *
 * Para cada comunidad prueba, uno a uno, cada partido de la izquierda que se presenta allí como
 * "vehículo": los votos del resto de partidos de la izquierda pasan a él (menos una fricción, que se
 * trata como abstención) en todas las provincias de la comunidad, y se recalcula D'Hondt.
 * Con `receptor: 'auto'` se queda con el vehículo que da más escaños al bloque; si ninguno mejora el reparto
 * actual, la comunidad no cambia. Con un partido concreto como `receptor`, concentra en él allí donde se presenta
 * (aunque el bloque pierda escaños) y deja igual las comunidades donde no se presenta.
 *
 * @param {object} base  resultado de calcularEscenario (escenario de partida)
 * @param {{ izquierda: string[], bloque: string[], friccion: number, receptor?: string, permitirPSOE: boolean, barrera: number }} opciones
 *   izquierda: partidos cuyos votantes se concentran; bloque: partidos cuyos escaños se maximizan.
 */
export function simularConcentracion(base, escenario, { izquierda, bloque, friccion, receptor = 'auto', permitirPSOE, barrera }) {
  const escanosBloque = (provincias) => sumar(provincias.flatMap((r) => bloque.map((p) => r.escanos[p] ?? 0)));

  const porComunidad = new Map();
  for (const r of base.provincias) {
    if (!porComunidad.has(r.ccaa)) porComunidad.set(r.ccaa, []);
    porComunidad.get(r.ccaa).push(r);
  }

  const comunidades = [];
  const nuevas = new Map();

  for (const [ccaa, provincias] of porComunidad) {
    // Se calculan todas las alternativas (PSOE incluido) para poder compararlas en la tabla.
    const candidatos = [...izquierda, 'PSOE'].filter((p) => provincias.some((r) => (r.votos[p] ?? 0) > 0));
    const actual = escanosBloque(provincias);

    const opciones = candidatos.map((vehiculo) => {
      const resultado = provincias.map((r) => concentrar(r, vehiculo, izquierda, friccion, barrera));
      return {
        vehiculo,
        escanosBloque: escanosBloque(resultado),
        escanosVehiculo: sumar(resultado.map((r) => r.escanos[vehiculo] ?? 0)),
        provincias: resultado,
      };
    });
    // Mejor opción: más escaños del bloque; a igualdad, el vehículo con más votos de partida.
    const votosDe = (p) => sumar(provincias.map((r) => r.votos[p] ?? 0));
    opciones.sort((a, b) => b.escanosBloque - a.escanosBloque || votosDe(b.vehiculo) - votosDe(a.vehiculo));

    let elegida = null;
    if (receptor === 'auto') {
      const mejor = opciones.find((o) => permitirPSOE || o.vehiculo !== 'PSOE');
      if (mejor && mejor.escanosBloque > actual) elegida = mejor;
    } else {
      elegida = opciones.find((o) => o.vehiculo === receptor) ?? null;
    }
    (elegida ? elegida.provincias : provincias).forEach((r) => nuevas.set(r.ine, r));

    comunidades.push({
      ccaa,
      escanosEnJuego: sumar(provincias.map((r) => r.escanosEnJuego)),
      escanosBloqueActual: actual,
      vehiculo: elegida?.vehiculo ?? null,
      // El receptor elegido a mano no se presenta en esta comunidad (p. ej. FA en Valencia, dentro de Compromís-FV).
      noSePresenta: receptor !== 'auto' && !elegida,
      // Otras candidaturas que dan los mismos escaños al bloque: la elección entre ellas es indiferente.
      empatados:
        receptor === 'auto' && elegida
          ? opciones
              .filter((o) => o !== elegida && (permitirPSOE || o.vehiculo !== 'PSOE') && o.escanosBloque === elegida.escanosBloque)
              .map((o) => o.vehiculo)
          : [],
      escanosBloqueConcentrado: elegida ? elegida.escanosBloque : actual,
      opciones: opciones.map(({ vehiculo, escanosBloque: e, escanosVehiculo }) => ({ vehiculo, escanosBloque: e, escanosVehiculo })),
    });
  }

  const provincias = base.provincias.map((r) => nuevas.get(r.ine));
  const resultado = montarResultado(escenario.id, { ...escenario, concentracion: { base: base.id, comunidades } }, provincias);
  return resultado;
}

/** Traslada a `vehiculo` los votos del resto de la izquierda en una provincia y recalcula D'Hondt. */
function concentrar(r, vehiculo, izquierda, friccion, barrera) {
  const votos = { ...r.votos };
  let trasladados = 0;
  for (const p of izquierda) {
    if (p === vehiculo || !votos[p]) continue;
    trasladados += votos[p];
    delete votos[p];
  }
  if (!trasladados) return r;

  const llegan = Math.round(trasladados * (1 - friccion));
  const perdidos = trasladados - llegan;
  votos[vehiculo] = (votos[vehiculo] ?? 0) + llegan;
  const validos = r.validos - perdidos;
  const votantes = r.votantes - perdidos;

  return {
    ...r,
    votos,
    validos,
    votantes,
    participacion: votantes / r.censo,
    perdidosCoalicion: r.perdidosCoalicion + perdidos,
    ...repartirProvincia(votos, r.escanosEnJuego, validos, barrera),
  };
}
