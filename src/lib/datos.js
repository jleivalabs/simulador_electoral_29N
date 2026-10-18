import { repartoDHondt, sumarEscanos, sumar } from './dhondt.js';
import { sondeoDesdeEstimacion } from './encuestas.js';

/**
 * Construye los votos de cada provincia para un escenario y aplica D'Hondt.
 * Módulo puro (sin DOM): lo usan tanto la web como scripts/verificar.mjs.
 */

function cuotasBase(provincia, perfiles) {
  const perfil = perfiles[provincia.ccaa];
  if (!perfil) throw new Error(`Sin perfil para la comunidad "${provincia.ccaa}" (${provincia.nombre})`);
  const cuotas = { ...perfil.cuotas };
  for (const [p, delta] of Object.entries(provincia.ajustes ?? {})) {
    cuotas[p] = Math.max(0, (cuotas[p] ?? 0) + delta);
  }
  return cuotas;
}

/**
 * Swing proporcional: factores por partido, trasvases y partidos nuevos.
 * `regionales`: partidos nuevos que solo se presentan en su `ambito` (cuota nacional); dentro de él su
 * cuota se divide entre la fracción del electorado nacional que vota allí (p. ej. 1,1 % nacional / 0,18 ≈ 6 % en Andalucía).
 */
function aplicarSondeo(cuotas, { factores = {}, transferencias = {}, nuevos = {}, regionales = {} }, provincia, regionalesEnAmbito, geografia) {
  const salida = {};
  const anadir = (p, v) => (salida[p] = (salida[p] ?? 0) + v);
  for (const [p, c] of Object.entries(cuotas)) {
    if (transferencias[p]) {
      for (const [destino, fraccion] of Object.entries(transferencias[p])) anadir(destino, c * fraccion);
    } else {
      anadir(p, c * (factores[p] ?? 1) * (geografia[p]?.[provincia.ine] ?? 1));
    }
  }
  for (const [p, c] of Object.entries(nuevos)) anadir(p, c);
  for (const [p, c] of Object.entries(regionales)) {
    const r = regionalesEnAmbito[p];
    if (r?.ambito.includes(provincia.ccaa)) anadir(p, (c / r.fraccion) * (r.multiplicador[provincia.ine] ?? 1));
  }
  return salida;
}

/**
 * Para cada partido regional: fracción del electorado nacional (censo × participación) que vota en su
 * ámbito y, si tiene `perfilProvincial`, un multiplicador por provincia (su % allí dividido por su media
 * ponderada en el ámbito), de modo que el total del ámbito no cambia y el voto se concentra donde es más fuerte.
 */
function fraccionesRegionales(regionales, ambitos, perfilesProvinciales, provincias, perfiles) {
  const peso = (p) => p.censo * perfiles[p.ccaa].participacion;
  const total = sumar(provincias.map(peso));
  return Object.fromEntries(
    Object.keys(regionales).map((partido) => {
      const ambito = ambitos[partido];
      if (!ambito) throw new Error(`El partido regional ${partido} necesita "ambito" en partidos.json`);
      const enAmbito = provincias.filter((p) => ambito.includes(p.ccaa));
      const pesoAmbito = sumar(enAmbito.map(peso));
      const perfil = perfilesProvinciales[partido];
      const multiplicador = {};
      if (perfil) {
        const media = sumar(enAmbito.map((p) => (perfil[p.ine] ?? 0) * peso(p))) / pesoAmbito;
        for (const p of enAmbito) multiplicador[p.ine] = (perfil[p.ine] ?? 0) / media;
      }
      return [partido, { ambito, fraccion: pesoAmbito / total, multiplicador }];
    }),
  );
}

/** Garantiza que candidaturas + blanco <= 1; el resto es "otros" (sin escaño). */
function normalizar(cuotas, blanco) {
  const maximo = 1 - blanco;
  const total = sumar(Object.values(cuotas));
  const factor = total > maximo ? maximo / total : 1;
  const ajustadas = Object.fromEntries(Object.entries(cuotas).map(([p, c]) => [p, c * factor]));
  return { cuotas: ajustadas, otros: maximo - total * factor };
}

/**
 * Multiplicadores por provincia del swing de un partido (`geografia.json`). Parte de su cuota base (2023) y:
 * 1. dentro de cada comunidad con datos, lleva el reparto entre provincias al de unas autonómicas recientes,
 *    conservando la media de la comunidad;
 * 2. entre comunidades, sube o baja cada comunidad según lo que creció en sus autonómicas de 2025-2026
 *    frente a la media de las comunidades con dato (amortiguado con `pesoEntreComunidades`);
 * 3. normaliza para que el voto nacional del partido no cambie: el nivel lo fija el sondeo.
 */
function multiplicadoresGeografia(geografia, provincias, perfiles) {
  const peso = (p) => p.censo * perfiles[p.ccaa].participacion;
  const salida = {};
  for (const [partido, g] of Object.entries(geografia)) {
    if (partido.startsWith('_')) continue;
    const base = new Map(provincias.map((p) => [p.ine, cuotasBase(p, perfiles)[partido] ?? 0]));
    const m = new Map(provincias.map((p) => [p.ine, 1]));
    const porComunidad = agrupar(provincias, (p) => p.ccaa);
    const mediaBase = (lista) => sumar(lista.map((p) => base.get(p.ine) * peso(p))) / sumar(lista.map(peso));

    // 1. Forma dentro de la comunidad.
    for (const lista of porComunidad.values()) {
      if (!lista.every((p) => g.dentroComunidad?.[p.ine] != null) || lista.length < 2) continue;
      const mediaRef = sumar(lista.map((p) => g.dentroComunidad[p.ine] * peso(p))) / sumar(lista.map(peso));
      const mb = mediaBase(lista);
      for (const p of lista) {
        const objetivo = mb * (g.dentroComunidad[p.ine] / mediaRef);
        if (base.get(p.ine) > 0) m.set(p.ine, objetivo / base.get(p.ine));
      }
    }

    // 2. Crecimiento relativo entre comunidades.
    const crec = Object.entries(g.crecimientoComunidad ?? {})
      .filter(([ccaa]) => porComunidad.has(ccaa))
      .map(([ccaa, pct]) => {
        const lista = porComunidad.get(ccaa);
        return { ccaa, ratio: pct / 100 / mediaBase(lista), peso: sumar(lista.map(peso)) };
      });
    if (crec.length) {
      const ref = sumar(crec.map((c) => c.ratio * c.peso)) / sumar(crec.map((c) => c.peso));
      const intensidad = g.pesoEntreComunidades ?? 1;
      for (const c of crec) {
        const indice = 1 + intensidad * (c.ratio / ref - 1);
        for (const p of porComunidad.get(c.ccaa)) m.set(p.ine, m.get(p.ine) * indice);
      }
    }

    // 3. Mismo voto nacional que sin corrección.
    const antes = sumar(provincias.map((p) => base.get(p.ine) * peso(p)));
    const despues = sumar(provincias.map((p) => base.get(p.ine) * m.get(p.ine) * peso(p)));
    const k = despues > 0 ? antes / despues : 1;
    salida[partido] = Object.fromEntries([...m].map(([ine, v]) => [ine, v * k]));
  }
  return salida;
}

// Los multiplicadores solo dependen de los datos de entrada: se calculan una vez por objeto `geografia`.
const cacheGeografia = new WeakMap();
function calcularGeografia({ geografia, provincias, perfiles }) {
  const m = multiplicadoresGeografia(geografia, provincias, perfiles);
  cacheGeografia.set(geografia, m);
  return m;
}

function agrupar(lista, clave) {
  const mapa = new Map();
  for (const x of lista) {
    const k = clave(x);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(x);
  }
  return mapa;
}

function resolverEscenario(escenarios, id, alianzas = {}) {
  const definido = escenarios.find((e) => e.id === id);
  if (!definido) throw new Error(`Escenario desconocido: ${id}`);
  // `alianzas`: referencia a un conjunto de acuerdos electorales compartido (p. ej. "29N"), que va antes que las coaliciones propias.
  if (definido.alianzas && !alianzas[definido.alianzas]) throw new Error(`Alianzas desconocidas: ${definido.alianzas}`);
  const escenario = {
    ...definido,
    coaliciones: [...(alianzas[definido.alianzas]?.coaliciones ?? []), ...(definido.coaliciones ?? [])],
  };
  if (!escenario.base) return escenario;
  const base = resolverEscenario(escenarios, escenario.base, alianzas);
  return {
    ...base,
    ...escenario,
    sondeo: escenario.sondeo ?? base.sondeo,
    // Las coaliciones del escenario base se aplican antes que las propias.
    coaliciones: [...base.coaliciones, ...escenario.coaliciones],
  };
}

function calcularProvincia(provincia, escenario, { perfiles, parametros, regionalesEnAmbito, geografia }) {
  const { blanco, nulos, barrera } = parametros;
  let cuotas = cuotasBase(provincia, perfiles);
  let participacion = perfiles[provincia.ccaa].participacion + (provincia.ajusteParticipacion ?? 0);

  if (escenario.sondeo) {
    cuotas = aplicarSondeo(cuotas, escenario.sondeo, provincia, regionalesEnAmbito, geografia);
    participacion += escenario.sondeo.deltaParticipacion ?? 0;
  }

  const normal = normalizar(cuotas, blanco);
  let votantes = Math.round(provincia.censo * participacion);
  let validos = Math.round(votantes * (1 - nulos));
  const votos = Object.fromEntries(
    Object.entries(normal.cuotas)
      .map(([p, c]) => [p, Math.round(validos * c)])
      .filter(([, v]) => v > 0),
  );

  let perdidosCoalicion = 0;
  let ganadosCoalicion = 0;
  for (const { marca, miembros, friccion = 0, ambito, traspasos = {} } of escenario.coaliciones ?? []) {
    // `ambito`: comunidades donde rige la coalición; fuera de ellas cada partido va por su cuenta.
    if (ambito && !ambito.includes(provincia.ccaa)) continue;
    const suma = sumar(miembros.map((p) => votos[p] ?? 0));
    if (suma > 0) {
      miembros.forEach((p) => delete votos[p]);
      // `escalas`: ajuste de calibración de las listas de coalición nuevas (ver calibrarConEncuestas).
      votos[marca] = Math.round(suma * (1 - friccion) * (escenario.escalas?.[marca] ?? 1));
      const diferencia = votos[marca] - suma;
      if (diferencia < 0) {
        // Fricción positiva: esos votantes se abstienen.
        perdidosCoalicion -= diferencia;
        votantes += diferencia;
        validos += diferencia;
      } else if (diferencia > 0) {
        // Fricción negativa (bonificación por unidad): una parte sale de otros partidos (`traspasos`,
        // fracción de la ganancia por partido) y el resto son abstencionistas que vuelven a votar.
        let movilizados = diferencia;
        for (const [p, fraccion] of Object.entries(traspasos)) {
          const tomados = Math.min(votos[p] ?? 0, Math.round(diferencia * fraccion));
          if (tomados) votos[p] -= tomados;
          movilizados -= tomados;
        }
        ganadosCoalicion += diferencia;
        votantes += movilizados;
        validos += movilizados;
      }
    }
  }

  return {
    ine: provincia.ine,
    nombre: provincia.nombre,
    ccaa: provincia.ccaa,
    escanosEnJuego: provincia.escanos,
    censo: provincia.censo,
    votantes,
    participacion: votantes / provincia.censo,
    validos,
    votosBlanco: Math.round(validos * blanco),
    votosOtros: Math.round(validos * normal.otros),
    perdidosCoalicion,
    ganadosCoalicion,
    votos,
    ...repartirProvincia(votos, provincia.escanos, validos, barrera),
  };
}

/** D'Hondt de una provincia más el ganador (por escaños y, a igualdad, por votos). */
export function repartirProvincia(votos, escanos, validos, barrera) {
  const reparto = repartoDHondt(votos, escanos, { barrera, votosValidos: validos });
  const ganador = Object.keys(votos).reduce((a, b) => {
    const ea = reparto.escanos[a] ?? 0;
    const eb = reparto.escanos[b] ?? 0;
    if (ea !== eb) return ea > eb ? a : b;
    return votos[a] >= votos[b] ? a : b;
  });
  return { ...reparto, ganador, cuotaGanador: votos[ganador] / validos };
}

/** Agrega los resultados provinciales en el objeto de escenario que consume la UI. */
export function montarResultado(id, escenario, provincias) {
  const votosNacionales = {};
  for (const r of provincias) {
    for (const [p, v] of Object.entries(r.votos)) votosNacionales[p] = (votosNacionales[p] ?? 0) + v;
  }
  return {
    id,
    escenario,
    provincias,
    porIne: new Map(provincias.map((r) => [r.ine, r])),
    totales: sumarEscanos(provincias.map((r) => r.escanos)),
    votosNacionales,
  };
}

/** Cuota nacional (0-1) de cada partido sobre los votos válidos. */
export function cuotasNacionales(resultado) {
  const validos = sumar(resultado.provincias.map((r) => r.validos));
  return Object.fromEntries(Object.entries(resultado.votosNacionales).map(([p, v]) => [p, v / validos]));
}

/**
 * Escenario "encuestas": convierte el promedio en un swing sobre el escenario base y lo calibra.
 *
 * Las encuestas dan el voto de cada candidatura tal como se presenta: el 2,0 % de Podemos es solo donde va en
 * solitario, ERC es la lista ERC-Podemos, Compromís-FV solo existe en Valencia... Por eso, tras el swing inicial,
 * se simula con las coaliciones y se ajustan los factores (o la escala de cada lista de coalición) hasta que
 * el voto nacional simulado de cada candidatura coincide con la encuesta.
 */
function calibrarConEncuestas(escenario, fuente) {
  const estimacion = fuente.agregado?.estimacion;
  if (!estimacion || !Object.keys(estimacion).length) {
    throw new Error(`El escenario "${escenario.id}" necesita el promedio de encuestas (npm run agregar)`);
  }
  const { base, sucesores, deltaParticipacion = 0 } = escenario.encuestas;
  const cuotasBase = cuotasNacionales(calcularEscenario(base, fuente));
  // Las listas de coalición que no existían en la base (p. ej. Compromís-FV) no entran en el swing inicial:
  // salen de sumar a sus miembros y se calibran con su escala.
  const marcas = new Set((escenario.coaliciones ?? []).map((c) => c.marca));
  const esMarcaNueva = (p) => marcas.has(p) && !(cuotasBase[p] > 0);
  const inicial = Object.fromEntries(Object.entries(estimacion).filter(([p]) => !esMarcaNueva(p)));
  const sondeo = { ...sondeoDesdeEstimacion(inicial, cuotasBase, sucesores, fuente.ambitos ?? {}), deltaParticipacion };
  const escalas = {};

  for (let i = 0; i < 25; i++) {
    const cuotas = cuotasNacionales(simular(escenario.id, { ...escenario, sondeo, escalas }, fuente));
    let desviacion = 0;
    for (const [p, pct] of Object.entries(estimacion)) {
      const simulado = cuotas[p];
      if (!(simulado > 0)) continue;
      const ratio = pct / 100 / simulado;
      desviacion = Math.max(desviacion, Math.abs(ratio - 1));
      if (esMarcaNueva(p)) escalas[p] = (escalas[p] ?? 1) * ratio;
      else if (p in sondeo.factores) sondeo.factores[p] *= ratio;
      else if (p in sondeo.nuevos) sondeo.nuevos[p] *= ratio;
      else if (p in sondeo.regionales) sondeo.regionales[p] *= ratio;
      else for (const destinos of Object.values(sondeo.transferencias)) if (p in destinos) destinos[p] *= ratio;
    }
    if (desviacion < 0.002) break;
  }
  return { ...escenario, sondeo, escalas };
}

/**
 * @param {string} id
 * @param {{ provincias, perfiles, escenarios, parametros, alianzas?, ambitos?, agregado? }} fuente
 *   ambitos: { partido: [ccaa...] } de los partidos que solo se presentan en algunas comunidades.
 *   perfilesProvinciales: { partido: { ine: % } } para repartir su voto dentro del ámbito.
 *   geografia: contenido de geografia.json (corrección geográfica del swing por partido).
 * @returns {{ id, escenario, provincias: object[], porIne: Map, totales: Record<string, number>, votosNacionales: Record<string, number> }}
 */
export function calcularEscenario(id, fuente) {
  let escenario = resolverEscenario(fuente.escenarios, id, fuente.alianzas);
  if (escenario.encuestas) escenario = calibrarConEncuestas(escenario, fuente);
  return simular(id, escenario, fuente);
}

/** Simula un escenario ya resuelto (swing, coaliciones y D'Hondt en cada provincia). */
function simular(id, escenario, fuente) {
  const { provincias, perfiles, parametros } = fuente;
  const regionalesEnAmbito = fraccionesRegionales(
    escenario.sondeo?.regionales ?? {},
    fuente.ambitos ?? {},
    fuente.perfilesProvinciales ?? {},
    provincias,
    perfiles,
  );
  const geografia = fuente.geografia ? (cacheGeografia.get(fuente.geografia) ?? calcularGeografia(fuente)) : {};
  const resultados = provincias.map((p) => calcularProvincia(p, escenario, { perfiles, parametros, regionalesEnAmbito, geografia }));
  return montarResultado(id, escenario, resultados);
}
