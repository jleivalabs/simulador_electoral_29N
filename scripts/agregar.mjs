// Calcula el promedio ponderado de data/encuestas.csv y lo guarda en
// src/data/sondeo-agregado.json, que la web usa en la pestaña "Promedio de encuestas".
// Uso: npm run agregar            (fecha de referencia: la de agregacion.json o hoy)
//      npm run agregar -- --fecha 2026-10-16
import { readFileSync, writeFileSync } from 'node:fs';
import { csvParse } from 'd3';
import { parsearEncuestas, agregarEncuestas } from '../src/lib/encuestas.js';

const ruta = (r) => new URL(r, import.meta.url);
const config = JSON.parse(readFileSync(ruta('../data/agregacion.json'), 'utf8'));
const { partidos } = JSON.parse(readFileSync(ruta('../src/data/partidos.json'), 'utf8'));

const argFecha = process.argv.indexOf('--fecha');
const textoFecha = argFecha > -1 ? process.argv[argFecha + 1] : config.fechaReferencia;
// Sin fecha explícita se usa el día local (no UTC: en Ecuador por la noche UTC ya es el día siguiente).
const hoy = new Date();
const hoyLocal = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
const fechaReferencia = new Date(`${textoFecha || hoyLocal}T00:00:00Z`);
if (Number.isNaN(fechaReferencia.getTime())) {
  console.error(`Fecha de referencia no válida: ${textoFecha} (usa AAAA-MM-DD)`);
  process.exit(1);
}

const filas = csvParse(readFileSync(ruta('../data/encuestas.csv'), 'utf8').replace(/^﻿/, ''));
const { encuestas, errores } = parsearEncuestas(filas);
errores.forEach((e) => console.warn(`⚠ ${e}`));

const conocidos = new Set(partidos.map((p) => p.id));
const desconocidos = [...new Set(encuestas.flatMap((e) => Object.keys(e.estimacion)))].filter((p) => !conocidos.has(p));
if (desconocidos.length) console.warn(`⚠ Columnas sin partido en partidos.json (saldrán en gris): ${desconocidos.join(', ')}`);

const resultado = agregarEncuestas(encuestas, config, fechaReferencia);
const salida = {
  generado: new Date().toISOString(),
  datosDeEjemplo: Boolean(config.datosDeEjemplo),
  parametros: {
    ventanaDias: config.ventanaDias,
    vidaMediaDias: config.vidaMediaDias,
    muestraReferencia: config.muestraReferencia,
    unaPorEncuestadora: config.unaPorEncuestadora,
    encuestadoras: config.encuestadoras,
  },
  ...resultado,
};
writeFileSync(ruta('../src/data/sondeo-agregado.json'), JSON.stringify(salida, null, 2) + '\n');

console.log(`Promedio a ${resultado.fechaReferencia}: ${resultado.usadas.length} encuestas usadas, ${resultado.descartadas.length} descartadas`);
for (const e of resultado.usadas) console.log(`  ${e.encuestadora.padEnd(16)} ${e.finCampo}  n=${String(e.muestra).padEnd(5)} peso ${(e.peso * 100).toFixed(1)} %`);
for (const d of resultado.descartadas) console.log(`  ✗ ${d.encuestadora} (${d.finCampo}): ${d.motivo}`);
console.log('  Estimación:', Object.entries(resultado.estimacion).map(([p, v]) => `${p} ${v}`).join(' · '));
if (config.datosDeEjemplo) console.log('  (datosDeEjemplo = true: la web mostrará un aviso de datos ficticios)');
if (!resultado.usadas.length) console.warn('⚠ Ninguna encuesta entra en la ventana: la pestaña de promedio no se mostrará.');
