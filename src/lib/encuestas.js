/**
 * Promedio ponderado de encuestas. Módulo puro: lo usa scripts/agregar.mjs
 * y podría usarlo el navegador (p. ej. para cargar un CSV arrastrado).
 */

const COLUMNAS_NO_PARTIDO = new Set(['encuestadora', 'medio', 'inicio_campo', 'fin_campo', 'muestra', 'otros', 'blanco', 'notas']);
const DIA_MS = 86400000;

const numeroCsv = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Convierte filas de CSV (objetos columna -> texto) en encuestas validadas.
 * @returns {{ encuestas: object[], errores: string[] }}
 */
export function parsearEncuestas(filas) {
  const encuestas = [];
  const errores = [];
  filas.forEach((fila, i) => {
    const linea = i + 2; // +1 cabecera, +1 base 1
    const encuestadora = fila.encuestadora?.trim();
    const finCampo = /^\d{4}-\d{2}-\d{2}$/.test(fila.fin_campo ?? '') ? new Date(`${fila.fin_campo}T00:00:00Z`) : null;
    const muestra = numeroCsv(fila.muestra);

    if (!encuestadora) return errores.push(`Línea ${linea}: falta la encuestadora`);
    if (!finCampo || Number.isNaN(finCampo.getTime())) return errores.push(`Línea ${linea}: fin_campo debe ser AAAA-MM-DD`);
    if (!(muestra > 0)) return errores.push(`Línea ${linea}: muestra debe ser un número positivo`);

    const estimacion = {};
    const escanos = {};
    for (const [columna, valor] of Object.entries(fila)) {
      if (COLUMNAS_NO_PARTIDO.has(columna.toLowerCase())) continue;
      // Escaños publicados por la encuestadora (opcional): columna PARTIDO_esc; admite horquillas "135/137" o "135-137".
      const esc = /^(.+)_esc$/i.exec(columna.trim());
      if (esc) {
        if (valor == null || String(valor).trim() === '') continue;
        const extremos = String(valor).split(/[/-]/).map((x) => numeroCsv(x));
        if (extremos.some((x) => !(x >= 0))) return errores.push(`Línea ${linea}: escaños no válidos en ${columna}: "${valor}"`);
        escanos[esc[1]] = extremos.reduce((a, b) => a + b, 0) / extremos.length;
        continue;
      }
      const n = numeroCsv(valor);
      if (n === null) continue; // celda vacía = partido no medido
      if (Number.isNaN(n) || n < 0 || n > 100) return errores.push(`Línea ${linea}: valor no válido en ${columna}: "${valor}"`);
      estimacion[columna.trim()] = n;
    }
    const suma = Object.values(estimacion).reduce((a, b) => a + b, 0);
    if (suma > 105) return errores.push(`Línea ${linea}: los partidos suman ${suma.toFixed(1)} %`);

    const sumaEscanos = Object.values(escanos).reduce((a, b) => a + b, 0);
    if (sumaEscanos > 351) return errores.push(`Línea ${linea}: los escaños publicados suman ${sumaEscanos}`);

    encuestas.push({ encuestadora, medio: fila.medio?.trim() ?? '', finCampo, muestra, estimacion, escanos });
  });
  return { encuestas, errores };
}

function configDe(encuestadora, config) {
  const clave = Object.keys(config.encuestadoras ?? {}).find((k) => k.toLowerCase() === encuestadora.toLowerCase());
  return clave ? config.encuestadoras[clave] : {};
}

/**
 * Peso = 0,5^(antigüedad / vida media) × √(muestra / muestraReferencia) × peso de la encuestadora.
 * @returns {{ fechaReferencia: string, usadas: object[], descartadas: object[], estimacion: Record<string, number> }}
 */
export function agregarEncuestas(encuestas, config, fechaReferencia) {
  const { ventanaDias = 45, vidaMediaDias = 14, muestraReferencia = 1000, unaPorEncuestadora = true } = config;
  const descartadas = [];
  const descartar = (e, motivo) => descartadas.push({ encuestadora: e.encuestadora, finCampo: iso(e.finCampo), motivo });

  let candidatas = [];
  for (const e of encuestas) {
    const edad = (fechaReferencia - e.finCampo) / DIA_MS;
    const cfg = configDe(e.encuestadora, config);
    if (edad < 0) descartar(e, 'posterior a la fecha de referencia');
    else if (edad > ventanaDias) descartar(e, `fuera de la ventana de ${ventanaDias} días`);
    else if (cfg.incluir === false) descartar(e, 'excluida por configuración');
    else candidatas.push({ ...e, edad, pesoEncuestadora: cfg.peso ?? 1 });
  }

  if (unaPorEncuestadora) {
    const ultima = new Map();
    for (const e of candidatas) {
      const clave = e.encuestadora.toLowerCase();
      if (!ultima.has(clave) || e.finCampo > ultima.get(clave).finCampo) ultima.set(clave, e);
    }
    for (const e of candidatas) if (ultima.get(e.encuestadora.toLowerCase()) !== e) descartar(e, 'hay una más reciente de la misma encuestadora');
    candidatas = [...ultima.values()];
  }

  const conPeso = candidatas.map((e) => ({
    ...e,
    peso: 0.5 ** (e.edad / vidaMediaDias) * Math.sqrt(e.muestra / muestraReferencia) * e.pesoEncuestadora,
  }));
  const sumaPesos = conPeso.reduce((a, e) => a + e.peso, 0);

  // Media ponderada por partido, solo entre las encuestas que lo miden.
  const acumulado = {};
  for (const e of conPeso) {
    for (const [p, v] of Object.entries(e.estimacion)) {
      acumulado[p] ??= { suma: 0, pesos: 0 };
      acumulado[p].suma += v * e.peso;
      acumulado[p].pesos += e.peso;
    }
  }
  const estimacion = Object.fromEntries(
    Object.entries(acumulado)
      .map(([p, { suma, pesos }]) => [p, Math.round((suma / pesos) * 100) / 100])
      .sort((a, b) => b[1] - a[1]),
  );

  return {
    escanosPublicados: promediarEscanos(conPeso, config.totalEscanos ?? 350),
    fechaReferencia: iso(fechaReferencia),
    usadas: conPeso
      .sort((a, b) => b.peso - a.peso)
      .map((e) => ({
        encuestadora: e.encuestadora,
        medio: e.medio,
        finCampo: iso(e.finCampo),
        muestra: e.muestra,
        antiguedadDias: Math.round(e.edad),
        peso: sumaPesos ? Math.round((e.peso / sumaPesos) * 1000) / 1000 : 0,
        estimacion: e.estimacion,
        escanos: e.escanos ?? {},
      })),
    descartadas,
    estimacion,
  };
}

/**
 * Escaños publicados por las encuestadoras: media ponderada entre las encuestas que los publican, redondeada
 * a `total` por restos mayores. Null si ninguna publica escaños.
 */
function promediarEscanos(encuestas, total) {
  const conEscanos = encuestas.filter((e) => Object.keys(e.escanos ?? {}).length);
  if (!conEscanos.length) return null;
  // Media por partido solo entre las encuestas que publican sus escaños (como en la estimación de voto).
  const acumulado = {};
  for (const e of conEscanos) {
    for (const [p, n] of Object.entries(e.escanos)) {
      acumulado[p] ??= { suma: 0, pesos: 0 };
      acumulado[p].suma += n * e.peso;
      acumulado[p].pesos += e.peso;
    }
  }
  const media = Object.fromEntries(Object.entries(acumulado).map(([p, a]) => [p, a.suma / a.pesos]));
  const enteros = Object.fromEntries(Object.entries(media).map(([p, v]) => [p, Math.floor(v)]));
  const sumaMedia = Math.round(Object.values(media).reduce((a, b) => a + b, 0));
  let faltan = Math.min(total, sumaMedia) - Object.values(enteros).reduce((a, b) => a + b, 0);
  for (const [p] of Object.entries(media).sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
    if (faltan <= 0) break;
    enteros[p]++;
    faltan--;
  }
  return { escanos: enteros, encuestas: conEscanos.length };
}

/**
 * Traduce la estimación nacional (%) a un swing proporcional sobre un escenario base.
 * - Partido medido y presente en la base: factor = estimación / cuota base nacional.
 * - Partido de la base no medido pero con sucesores medidos (Sumar -> FA, Podemos):
 *   sus votos se reparten entre ellos, conservando su geografía.
 * - Partido de la base no medido y sin sucesores: se mantiene como en la base.
 * - Partido medido sin presencia en la base: se añade con la misma cuota en todas las provincias, salvo
 *   que tenga `ambito` (partido regional): entonces solo se reparte en esas comunidades.
 *
 * @param {Record<string, number>} estimacion  % nacional por partido
 * @param {Record<string, number>} base        cuota nacional (0-1) por partido en el escenario base
 * @param {Record<string, string[]>} [sucesores]
 * @param {Record<string, string[]>} [ambitos]  comunidades de los partidos regionales
 */
export function sondeoDesdeEstimacion(estimacion, base, sucesores = {}, ambitos = {}) {
  const factores = {};
  const transferencias = {};
  const nuevos = {};
  const regionales = {};
  const medido = (p) => estimacion[p] != null;
  const asignados = new Set();

  for (const [partido, cuota] of Object.entries(base)) {
    if (!(cuota > 0)) continue;
    if (medido(partido)) {
      factores[partido] = estimacion[partido] / 100 / cuota;
      asignados.add(partido);
    } else if (sucesores[partido]?.some((s) => medido(s) && !(base[s] > 0))) {
      transferencias[partido] = {};
      for (const s of sucesores[partido]) {
        if (medido(s) && !(base[s] > 0)) {
          transferencias[partido][s] = estimacion[s] / 100 / cuota;
          asignados.add(s);
        }
      }
    }
  }
  for (const [p, v] of Object.entries(estimacion)) {
    if (asignados.has(p)) continue;
    if (ambitos[p]) regionales[p] = v / 100;
    else nuevos[p] = v / 100;
  }

  return { factores, transferencias, nuevos, regionales };
}

const iso = (fecha) => fecha.toISOString().slice(0, 10);
