/**
 * Reparto D'Hondt de una circunscripción (LOREG art. 163).
 *
 * - Barrera: solo entran los partidos con votos >= barrera * votosValidos
 *   (los votos válidos incluyen el voto en blanco).
 * - Empates de cociente: gana el partido con más votos totales; si persiste,
 *   la ley prevé sorteo; aquí se resuelve por orden alfabético para que el
 *   resultado sea determinista.
 *
 * @param {Record<string, number>} votos   votos por candidatura
 * @param {number} escanos                 escaños de la circunscripción
 * @param {{barrera?: number, votosValidos?: number}} [opciones]
 * @returns {{
 *   escanos: Record<string, number>,
 *   elegibles: string[],
 *   ultimo: {partido: string, cociente: number} | null,
 *   siguiente: {partido: string, cociente: number, votosQueFaltan: number} | null
 * }}
 */
export function repartoDHondt(votos, escanos, { barrera = 0.03, votosValidos } = {}) {
  const validos = votosValidos ?? sumar(Object.values(votos));
  const resultado = Object.fromEntries(Object.keys(votos).map((p) => [p, 0]));
  const elegibles = Object.keys(votos).filter((p) => votos[p] > 0 && votos[p] / validos >= barrera);

  if (!escanos || elegibles.length === 0) {
    return { escanos: resultado, elegibles, ultimo: null, siguiente: null };
  }

  const cociente = (p) => votos[p] / (resultado[p] + 1);
  // > 0 si `a` tiene prioridad sobre `b` para el próximo escaño
  const prioridad = (a, b) => cociente(a) - cociente(b) || votos[a] - votos[b] || b.localeCompare(a);
  const mejorDe = (lista) => lista.reduce((mejor, p) => (prioridad(p, mejor) > 0 ? p : mejor));

  let ultimo = null;
  for (let i = 0; i < escanos; i++) {
    const p = mejorDe(elegibles);
    ultimo = { partido: p, cociente: cociente(p) };
    resultado[p]++;
  }

  // Partido que se quedó más cerca de arrebatar el último escaño.
  const rivales = elegibles.filter((p) => p !== ultimo.partido);
  let siguiente = null;
  if (rivales.length) {
    const s = mejorDe(rivales);
    const necesarios = ultimo.cociente * (resultado[s] + 1);
    siguiente = {
      partido: s,
      cociente: cociente(s),
      votosQueFaltan: Math.max(0, Math.floor(necesarios - votos[s]) + 1),
    };
  }

  return { escanos: resultado, elegibles, ultimo, siguiente };
}

/** Suma de escaños por partido de una lista de repartos. */
export function sumarEscanos(listaEscanos) {
  const total = {};
  for (const escanos of listaEscanos) {
    for (const [p, n] of Object.entries(escanos)) total[p] = (total[p] ?? 0) + n;
  }
  return total;
}

export const sumar = (valores) => valores.reduce((a, b) => a + b, 0);
