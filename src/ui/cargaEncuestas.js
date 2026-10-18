import { csvParse, dsvFormat } from 'd3';
import { parsearEncuestas, agregarEncuestas } from '../lib/encuestas.js';
import { escaparHtml } from './formato.js';

const CLAVE_GUARDADO = 'simulador-electoral:encuestas:v1';
const parsearPuntoYComa = dsvFormat(';').parse;

const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Excel en español suele exportar CSV con ";" como separador. */
function leerCsv(texto) {
  const limpio = texto.replace(/^﻿/, '');
  const fin = limpio.indexOf('\n');
  const cabecera = fin === -1 ? limpio : limpio.slice(0, fin);
  return cabecera.split(';').length > cabecera.split(',').length ? parsearPuntoYComa(limpio) : csvParse(limpio);
}

function leerGuardado() {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_GUARDADO));
    return Array.isArray(datos) && datos.length ? datos : null;
  } catch {
    return null;
  }
}

function guardar(archivos) {
  try {
    localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(archivos.map(({ id, nombre, texto, ejemplo }) => ({ id, nombre, texto, ejemplo }))));
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): los archivos solo duran esta sesión.
  }
}

/**
 * Carga de uno o varios CSV de encuestas desde la página (botón o arrastrar y soltar).
 * Combina todos los archivos, elimina duplicados, pondera y avisa con `onCambio(agregado, origen)`.
 */
export function crearCargaEncuestas(contenedor, { csvIncluido, configBase, onCambio }) {
  const incluido = () => ({ id: 'incluido', nombre: 'encuestas.csv (incluido)', texto: csvIncluido, ejemplo: Boolean(configBase.datosDeEjemplo) });
  let archivos = leerGuardado() ?? [incluido()];
  let fecha = configBase.fechaReferencia ?? hoyLocal();
  const config = structuredClone(configBase);
  config.encuestadoras ??= {};
  config.encuestadoras.CIS ??= { incluir: true, peso: 1 };

  contenedor.innerHTML = `
    <div class="carga__fila">
      <label class="carga__boton">Cargar CSV de encuestas<input type="file" accept=".csv,text/csv" multiple hidden /></label>
      <span class="carga__ayuda">o arrastra uno o varios archivos a la página</span>
      <button type="button" class="carga__enlace" data-accion="restaurar">Restaurar ejemplo</button>
    </div>
    <ul class="carga__archivos"></ul>
    <details class="carga__ajustes">
      <summary>Ponderación</summary>
      <form class="carga__controles">
        <label>Fecha de referencia <input type="date" name="fecha" /></label>
        <label>Vida media (días) <input type="number" name="vidaMediaDias" min="1" max="120" /></label>
        <label>Ventana (días) <input type="number" name="ventanaDias" min="1" max="365" /></label>
        <label>Muestra de referencia <input type="number" name="muestraReferencia" min="100" step="100" /></label>
        <label class="carga__check"><input type="checkbox" name="unaPorEncuestadora" /> Una encuesta por empresa</label>
        <label class="carga__check"><input type="checkbox" name="cisIncluir" /> Incluir CIS</label>
        <label>Peso del CIS <input type="number" name="cisPeso" min="0" max="3" step="0.1" /></label>
      </form>
    </details>
    <p class="carga__estado" aria-live="polite"></p>`;

  const inputArchivo = contenedor.querySelector('input[type=file]');
  const lista = contenedor.querySelector('.carga__archivos');
  const form = contenedor.querySelector('form');
  const estado = contenedor.querySelector('.carga__estado');

  function pintarFormulario() {
    form.fecha.value = fecha;
    form.vidaMediaDias.value = config.vidaMediaDias;
    form.ventanaDias.value = config.ventanaDias;
    form.muestraReferencia.value = config.muestraReferencia;
    form.unaPorEncuestadora.checked = config.unaPorEncuestadora;
    form.cisIncluir.checked = config.encuestadoras.CIS.incluir !== false;
    form.cisPeso.value = config.encuestadoras.CIS.peso ?? 1;
    form.cisPeso.disabled = !form.cisIncluir.checked;
  }
  pintarFormulario();

  form.addEventListener('input', () => {
    if (form.fecha.value) fecha = form.fecha.value;
    for (const campo of ['vidaMediaDias', 'ventanaDias', 'muestraReferencia']) {
      const n = Number(form[campo].value);
      if (n > 0) config[campo] = n;
    }
    config.unaPorEncuestadora = form.unaPorEncuestadora.checked;
    config.encuestadoras.CIS = { incluir: form.cisIncluir.checked, peso: Math.max(0, Number(form.cisPeso.value) || 0) };
    form.cisPeso.disabled = !form.cisIncluir.checked;
    recalcular('usuario');
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  async function anadir(ficheros) {
    const csvs = [...ficheros].filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv');
    if (!csvs.length) {
      estado.textContent = 'Solo se aceptan archivos .csv';
      return;
    }
    // Si solo estaba el ejemplo, los archivos del usuario lo sustituyen.
    if (archivos.length === 1 && archivos[0].id === 'incluido') archivos = [];
    for (const f of csvs) {
      archivos = archivos.filter((a) => a.nombre !== f.name); // recargar un archivo lo reemplaza
      archivos.push({ id: `${Date.now()}-${f.name}`, nombre: f.name, texto: await f.text(), ejemplo: false });
    }
    guardar(archivos);
    recalcular('usuario');
  }

  inputArchivo.addEventListener('change', () => {
    anadir(inputArchivo.files);
    inputArchivo.value = '';
  });

  contenedor.addEventListener('click', (e) => {
    const quitar = e.target.closest('[data-quitar]');
    if (quitar) {
      archivos = archivos.filter((a) => a.id !== quitar.dataset.quitar);
      guardar(archivos);
      recalcular('usuario');
    }
    if (e.target.closest('[data-accion=restaurar]')) {
      archivos = [incluido()];
      try {
        localStorage.removeItem(CLAVE_GUARDADO);
      } catch {}
      recalcular('usuario');
    }
  });

  // Arrastrar y soltar en toda la página.
  let profundidad = 0;
  const conArchivos = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!conArchivos(e)) return;
    profundidad++;
    document.body.classList.add('arrastrando');
  });
  document.addEventListener('dragleave', () => {
    if (--profundidad <= 0) {
      profundidad = 0;
      document.body.classList.remove('arrastrando');
    }
  });
  document.addEventListener('dragover', (e) => conArchivos(e) && e.preventDefault());
  document.addEventListener('drop', (e) => {
    if (!conArchivos(e)) return;
    e.preventDefault();
    profundidad = 0;
    document.body.classList.remove('arrastrando');
    anadir(e.dataTransfer.files);
  });

  function recalcular(origen = 'inicial') {
    const errores = [];
    const porClave = new Map();
    let duplicadas = 0;

    for (const a of archivos) {
      let filas;
      try {
        filas = leerCsv(a.texto);
      } catch {
        errores.push(`${a.nombre}: no se pudo leer el archivo`);
        a.encuestas = 0;
        continue;
      }
      const r = parsearEncuestas(filas);
      r.errores.forEach((err) => errores.push(`${a.nombre} · ${err}`));
      a.encuestas = r.encuestas.length;
      for (const e of r.encuestas) {
        // Misma encuestadora y misma fecha de fin de campo = misma encuesta: gana el último archivo.
        const clave = `${e.encuestadora.toLowerCase()}|${e.finCampo.toISOString().slice(0, 10)}`;
        if (porClave.has(clave)) duplicadas++;
        porClave.set(clave, { ...e, ejemplo: a.ejemplo });
      }
    }

    const unicas = [...porClave.values()];
    const resultado = agregarEncuestas(unicas, config, new Date(`${fecha}T00:00:00Z`));
    const usadas = new Set(resultado.usadas.map((u) => `${u.encuestadora.toLowerCase()}|${u.finCampo}`));
    const agregado = {
      ...resultado,
      datosDeEjemplo: unicas.some((e) => e.ejemplo && usadas.has(`${e.encuestadora.toLowerCase()}|${e.finCampo.toISOString().slice(0, 10)}`)),
      parametros: structuredClone(config),
      errores,
      duplicadas,
    };

    lista.innerHTML = archivos
      .map(
        (a) => `<li>
          <span>${escaparHtml(a.nombre)}</span><small>${a.encuestas} ${a.encuestas === 1 ? 'encuesta' : 'encuestas'}</small>
          <button type="button" data-quitar="${escaparHtml(a.id)}" aria-label="Quitar ${escaparHtml(a.nombre)}">×</button>
        </li>`,
      )
      .join('');

    const partes = [
      archivos.length ? `${resultado.usadas.length} encuestas usadas en el promedio` : 'No hay archivos cargados',
      duplicadas ? `${duplicadas} duplicadas ignoradas` : '',
      errores.length ? `${errores.length} filas con errores: ${errores.slice(0, 3).join(' · ')}${errores.length > 3 ? '…' : ''}` : '',
    ].filter(Boolean);
    estado.textContent = partes.join(' · ');
    estado.classList.toggle('carga__estado--error', errores.length > 0 || (archivos.length > 0 && !resultado.usadas.length));

    onCambio(agregado, origen);
  }

  return {
    recalcular,
    /** Archivos cargados (nombre y texto), p. ej. para guardarlos en el histórico. */
    archivos: () => archivos.map(({ nombre, texto }) => ({ nombre, texto })),
    /** Vuelve a cargar unos archivos y una ponderación guardados (histórico). */
    restaurar({ archivos: guardados, parametros, fechaReferencia }) {
      archivos = guardados.map((a, i) => ({ id: `${Date.now()}-${i}-${a.nombre}`, nombre: a.nombre, texto: a.texto, ejemplo: false }));
      if (parametros) {
        Object.assign(config, structuredClone(parametros));
        config.encuestadoras ??= {};
        config.encuestadoras.CIS ??= { incluir: true, peso: 1 };
      }
      if (fechaReferencia) fecha = fechaReferencia;
      pintarFormulario();
      guardar(archivos);
      recalcular('usuario');
    },
  };
}
