// Comprueba el motor sin navegador: suma de escaños, totales por escenario
// y desviación del escenario 2023 frente a los escaños oficiales del 23J.
// Uso: npm run verificar
import { readFileSync, existsSync } from 'node:fs';
import { calcularEscenario, cuotasNacionales } from '../src/lib/datos.js';
import { repartoDHondt } from '../src/lib/dhondt.js';
import { simularConcentracion } from '../src/lib/concentracion.js';

const leer = (ruta) => JSON.parse(readFileSync(new URL(ruta, import.meta.url), 'utf8'));
const { provincias } = leer('../src/data/provincias.json');
const { parametros, perfiles, escenarios, alianzas } = leer('../src/data/escenarios.json');
const rutaAgregado = new URL('../src/data/sondeo-agregado.json', import.meta.url);
const agregado = existsSync(rutaAgregado) ? leer(rutaAgregado) : null;
const { partidos } = leer('../src/data/partidos.json');
const ambitos = Object.fromEntries(partidos.filter((p) => p.ambito).map((p) => [p.id, p.ambito]));
const perfilesProvinciales = Object.fromEntries(partidos.filter((p) => p.perfilProvincial).map((p) => [p.id, p.perfilProvincial]));
const geografia = leer('../src/data/geografia.json');
const fuente = { provincias, perfiles, escenarios, parametros, alianzas, ambitos, perfilesProvinciales, geografia, agregado };

let errores = 0;
const fallo = (msg) => {
  console.error(`✗ ${msg}`);
  errores++;
};

// 1. Caso de manual de D'Hondt (7 escaños): A 340k, B 280k, C 160k, D 60k -> 3/3/1/0
const manual = repartoDHondt({ A: 340000, B: 280000, C: 160000, D: 60000 }, 7, { barrera: 0 });
const esperado = { A: 3, B: 3, C: 1, D: 0 };
if (JSON.stringify(manual.escanos) !== JSON.stringify(esperado)) fallo(`D'Hondt manual: ${JSON.stringify(manual.escanos)}`);
else console.log("✓ D'Hondt: caso de manual correcto");

// 2. Datos base
const sumaEscanos = provincias.reduce((a, p) => a + p.escanos, 0);
if (sumaEscanos !== parametros.totalEscanos) fallo(`Las provincias suman ${sumaEscanos} escaños, no ${parametros.totalEscanos}`);
else console.log(`✓ ${provincias.length} provincias suman ${sumaEscanos} escaños`);

// 3. Escenarios
for (const e of escenarios) {
  if (e.encuestas && !agregado?.usadas?.length) {
    console.log(`\n${e.nombre} (${e.id}) — omitido: no hay promedio de encuestas (npm run agregar)`);
    continue;
  }
  const r = calcularEscenario(e.id, fuente);
  const total = Object.values(r.totales).reduce((a, b) => a + b, 0);
  if (total !== parametros.totalEscanos) fallo(`${e.id}: reparte ${total} escaños`);

  const filas = Object.entries(r.totales)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  console.log(`\n${e.nombre} (${e.id}) — ${total} escaños`);
  for (const [p, n] of filas) {
    const ref = e.referenciaEscanos?.[p];
    const extra = ref === undefined ? '' : `  (oficial ${ref}, Δ ${n - ref >= 0 ? '+' : ''}${n - ref})`;
    console.log(`  ${p.padEnd(8)} ${String(n).padStart(3)}${extra}`);
  }
  if (e.referenciaEscanos) {
    const partidos = new Set([...Object.keys(e.referenciaEscanos), ...Object.keys(r.totales)]);
    const desvio = [...partidos].reduce((a, p) => a + Math.abs((r.totales[p] ?? 0) - (e.referenciaEscanos[p] ?? 0)), 0) / 2;
    console.log(`  → escaños mal asignados frente al 23J oficial: ${desvio}`);
  }
  if (e.encuestas) {
    // El voto nacional simulado debe reproducir el promedio (salvo coaliciones, p. ej. Podemos dentro de ERC en Cataluña).
    const cuotas = cuotasNacionales(r);
    console.log('  Voto nacional simulado vs promedio de encuestas:');
    for (const [p, objetivo] of Object.entries(agregado.estimacion)) {
      const simulado = (cuotas[p] ?? 0) * 100;
      const marca = Math.abs(simulado - objetivo) > 0.5 ? '  ← difiere (¿coalición?)' : '';
      console.log(`    ${p.padEnd(8)} ${simulado.toFixed(1).padStart(5)} % vs ${objetivo.toFixed(1).padStart(5)} %${marca}`);
    }
  }
}

// 4. Concentración del voto de izquierda sobre cada base disponible
const { concentracion } = leer('../src/data/escenarios.json');
for (const baseId of concentracion.bases) {
  if (baseId === 'promedio_encuestas' && !agregado?.usadas?.length) continue;
  const base = calcularEscenario(baseId, fuente);
  const r = simularConcentracion(base, concentracion, { ...concentracion, barrera: parametros.barrera });
  const total = Object.values(r.totales).reduce((a, b) => a + b, 0);
  if (total !== parametros.totalEscanos) fallo(`concentración sobre ${baseId}: reparte ${total} escaños`);
  const { comunidades } = r.escenario.concentracion;
  for (const c of comunidades) {
    if (c.escanosBloqueConcentrado < c.escanosBloqueActual) fallo(`concentración ${baseId}/${c.ccaa}: empeora el bloque`);
  }
  const bloqueDe = (res) => concentracion.bloque.reduce((a, p) => a + (res.totales[p] ?? 0), 0);
  console.log(`\nConcentración izquierda sobre ${baseId} (fricción ${concentracion.friccion * 100} %): bloque ${bloqueDe(base)} → ${bloqueDe(r)}`);
  for (const c of comunidades.filter((c) => c.vehiculo)) {
    console.log(`  ${c.ccaa.padEnd(5)} → ${c.vehiculo.padEnd(8)} ${c.escanosBloqueActual} → ${c.escanosBloqueConcentrado}  (${c.opciones.map((o) => `${o.vehiculo} ${o.escanosBloque}`).join(', ')})`);
  }
}

console.log(errores ? `\n${errores} error(es)` : '\nTodo correcto');
process.exit(errores ? 1 : 0);
