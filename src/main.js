import './styles.css';
import topologia from 'es-atlas/es/provinces.json';
import csvIncluido from '../data/encuestas.csv?raw';
import configAgregacion from '../data/agregacion.json';
import { provincias } from './data/provincias.json';
import { partidos } from './data/partidos.json';
import { parametros, perfiles, escenarios, bloques, concentracion, alianzas } from './data/escenarios.json';
import nombresCcaa from './data/ccaa.json';
import geografia from './data/geografia.json';
import { calcularEscenario } from './lib/datos.js';
import { simularConcentracion } from './lib/concentracion.js';
import { crearPanelConcentracion } from './ui/panelConcentracion.js';
import { crearCatalogo, numero } from './ui/formato.js';
import { crearMapa } from './ui/mapa.js';
import { crearTooltip } from './ui/tooltip.js';
import { crearHemiciclo } from './ui/hemiciclo.js';
import { crearLeyenda } from './ui/leyenda.js';
import { crearPanelEncuestas } from './ui/panelEncuestas.js';
import { crearCargaEncuestas } from './ui/cargaEncuestas.js';
import { crearHistorico } from './ui/historico.js';

const catalogo = crearCatalogo(partidos);
const ambitos = Object.fromEntries(partidos.filter((p) => p.ambito).map((p) => [p.id, p.ambito]));
const perfilesProvinciales = Object.fromEntries(partidos.filter((p) => p.perfilProvincial).map((p) => [p.id, p.perfilProvincial]));
const fuente = { provincias, perfiles, escenarios, parametros, alianzas, ambitos, perfilesProvinciales, geografia, agregado: null };
const escenarioEncuestas = escenarios.find((e) => e.encuestas);

// Los escenarios fijos se calculan una sola vez; el de encuestas, cada vez que cambian los CSV o la ponderación.
const resultados = new Map(escenarios.filter((e) => !e.encuestas).map((e) => [e.id, calcularEscenario(e.id, fuente)]));

const tooltip = crearTooltip(catalogo, parametros);
const mapa = crearMapa(document.querySelector('#mapa'), topologia, provincias, catalogo, tooltip);
const leyenda = crearLeyenda(document.querySelector('#leyenda'), catalogo);
const hemiciclo = crearHemiciclo(document.querySelector('#hemiciclo'), catalogo, { ...parametros, bloques });
const panelEncuestas = crearPanelEncuestas(document.querySelector('#encuestas'), catalogo);

// Escenario derivado: se recalcula al cambiar sus controles o su escenario base (p. ej. nuevas encuestas).
const pestanas = [...escenarios, concentracion];
const opcionesConc = { base: concentracion.bases[0], friccion: concentracion.friccion, receptor: 'auto', permitirPSOE: concentracion.permitirPSOE };
const panelConc = crearPanelConcentracion(document.querySelector('#concentracion'), catalogo, nombresCcaa, {
  opciones: opcionesConc,
  receptores: ['PSOE', ...concentracion.izquierda],
  onCambio(cambios) {
    Object.assign(opcionesConc, cambios);
    recalcularConcentracion();
  },
});

function recalcularConcentracion() {
  const bases = concentracion.bases.filter((id) => resultados.has(id)).map((id) => pestanas.find((e) => e.id === id));
  if (!bases.some((b) => b.id === opcionesConc.base)) opcionesConc.base = bases[0]?.id;
  if (!opcionesConc.base) return resultados.delete(concentracion.id);

  // Solo se ofrecen como receptores los partidos que concurren en la base (Sumar no existe en 2026).
  const base = resultados.get(opcionesConc.base);
  const presentes = ['PSOE', ...concentracion.izquierda].filter((p) => (base.votosNacionales[p] ?? 0) > 0);
  if (opcionesConc.receptor !== 'auto' && !presentes.includes(opcionesConc.receptor)) opcionesConc.receptor = 'auto';

  const resultado = simularConcentracion(base, { ...concentracion, receptor: opcionesConc.receptor }, {
    ...concentracion,
    ...opcionesConc,
    barrera: parametros.barrera,
  });
  resultados.set(concentracion.id, resultado);
  panelConc.render(resultado, bases.map((b) => ({ id: b.id, nombre: nombreEscenario(b) })), opcionesConc.base, parametros.mayoriaAbsoluta, presentes);
  if (actual === concentracion.id) mostrarEscenario(concentracion.id, true);
}

const botonera = document.querySelector('#escenarios');
const descripcion = document.querySelector('#descripcion');
const resumen = document.querySelector('#resumen');
const zonaCarga = document.querySelector('#carga');
const selectorEscanos = document.querySelector('#fuente-escanos');
let modoEscanos = 'encuesta';
selectorEscanos.addEventListener('click', (e) => {
  const boton = e.target.closest('button[data-modo]');
  if (!boton || boton.dataset.modo === modoEscanos) return;
  modoEscanos = boton.dataset.modo;
  mostrarEscenario(actual, true);
});

let actual = null;
let totalesMostrados = null;

const nombreEscenario = (e) => e.nombre;

function pintarBotonera() {
  // La pestaña de encuestas se muestra siempre: es donde se cargan los CSV, aunque aún no haya promedio.
  botonera.innerHTML = pestanas
    .filter((e) => resultados.has(e.id) || e.id === escenarioEncuestas?.id)
    .map((e) => `<button type="button" role="tab" data-id="${e.id}" aria-selected="${e.id === actual}">${nombreEscenario(e)}</button>`)
    .join('');
}

function mostrarEscenario(id, forzar = false) {
  if (id === actual && !forzar) return;
  const resultado = resultados.get(id);

  actual = id;
  botonera.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === id)));
  zonaCarga.hidden = id !== escenarioEncuestas?.id;

  historico.mostrar(id === escenarioEncuestas?.id);

  if (!resultado) {
    // Pestaña de encuestas sin promedio: todo en blanco hasta que se carguen CSV.
    descripcion.textContent = 'Carga uno o varios CSV de encuestas para calcular el promedio y aplicarlo al mapa.';
    resumen.textContent = 'Sin encuestas cargadas';
    selectorEscanos.hidden = true;
    mapa.vaciar();
    leyenda.vaciar();
    hemiciclo.vaciar();
    panelEncuestas.mostrar(false);
    panelConc.mostrar(false);
    tooltip.ocultar();
    totalesMostrados = null;
    return;
  }
  descripcion.textContent = resultado.escenario.descripcion ?? '';

  // En «Encuestas», el hemiciclo puede mostrar los escaños que publican las propias encuestadoras.
  const publicados = id === escenarioEncuestas?.id ? fuente.agregado?.escanosPublicados : null;
  selectorEscanos.hidden = !publicados;
  const usarPublicados = publicados && modoEscanos === 'encuesta';
  selectorEscanos.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.modo === (usarPublicados ? 'encuesta' : 'modelo'))));
  const totales = usarPublicados ? publicados.escanos : resultado.totales;

  const totalEscanos = Object.values(totales).reduce((a, b) => a + b, 0);
  const votantes = resultado.provincias.reduce((a, r) => a + r.votantes, 0);
  resumen.textContent = usarPublicados
    ? `${totalEscanos} escaños publicados por ${publicados.encuestas === 1 ? 'la encuesta' : `las ${publicados.encuestas} encuestas que los publican (promedio ponderado)`}. El mapa muestra el modelo provincial.`
    : `${totalEscanos} escaños repartidos en ${resultado.provincias.length} circunscripciones · ${numero(votantes)} votantes estimados`;

  mapa.actualizar(resultado);
  leyenda.actualizar(resultado);
  // Variaciones del hemiciclo: en «Voto útil», frente a su escenario base; en el resto, frente a lo que se veía justo antes.
  const baseConc = resultado.escenario.concentracion ? resultados.get(resultado.escenario.concentracion.base) : null;
  hemiciclo.actualizar(totales, baseConc ? baseConc.totales : totalesMostrados);
  panelEncuestas.mostrar(Boolean(resultado.escenario.encuestas));
  panelConc.mostrar(Boolean(resultado.escenario.concentracion));
  tooltip.ocultar();
  totalesMostrados = totales;
}

function aplicarEncuestas(agregado, origen) {
  if (!escenarioEncuestas) return;
  fuente.agregado = agregado;
  const hayPromedio = agregado.usadas.length > 0;
  if (hayPromedio) resultados.set(escenarioEncuestas.id, calcularEscenario(escenarioEncuestas.id, fuente));
  else resultados.delete(escenarioEncuestas.id);

  panelEncuestas.render(agregado);
  historico.setActual(hayPromedio ? fotoPromedio(agregado, resultados.get(escenarioEncuestas.id)) : null);
  recalcularConcentracion();
  pintarBotonera();

  if (!actual) return; // carga inicial: se muestra el primer escenario más abajo
  if (origen === 'usuario' || actual === escenarioEncuestas.id) mostrarEscenario(escenarioEncuestas.id, true);
}

/** Lo que se guarda en el histórico: archivos y ponderación (para poder repetirlo) y el resultado. */
function fotoPromedio(agregado, resultado) {
  return {
    fechaReferencia: agregado.fechaReferencia,
    encuestas: agregado.usadas.length,
    encuestadoras: agregado.usadas.map((u) => u.encuestadora),
    archivos: carga.archivos(),
    parametros: agregado.parametros,
    estimacion: agregado.estimacion,
    escanos: Object.fromEntries(Object.entries(resultado.totales).filter(([, n]) => n > 0)),
    bloques: bloques.map((b) => ({
      nombre: b.nombre,
      corto: b.corto ?? b.nombre,
      escanos: b.partidos.reduce((a, p) => a + (resultado.totales[p] ?? 0), 0),
    })),
    mayoria: parametros.mayoriaAbsoluta,
  };
}

const historico = crearHistorico(document.querySelector('#historico'), catalogo, {
  onRestaurar: (entrada) => carga.restaurar(entrada),
});

botonera.addEventListener('click', (e) => {
  const boton = e.target.closest('button[data-id]');
  if (boton) mostrarEscenario(boton.dataset.id);
});

const carga = crearCargaEncuestas(zonaCarga, {
  csvIncluido,
  configBase: configAgregacion,
  onCambio: aplicarEncuestas,
});
carga.recalcular('inicial');
mostrarEscenario(escenarios[0].id);
