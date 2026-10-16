// rastro — inscripción, subida de fotos, correo a voluntarios y API del visor (Apps Script).
//
// Páginas (misma URL /exec):
//   sin p        → inscripción de voluntarios (registro.html).
//   ?p=fotos     → subida de las 7 fotos con el RUT (fotos.html). No muestra metadatos.
//   ?p=prueba    → página de prueba de canal (index.html). Muestra GPS/fecha/modelo:
//                  no compartir con participantes.
//   ?accion=…    → API del visor local (metadatos/visor.html), protegida con clave.
//
// Todo queda en una sola planilla, en dos pestañas:
//   Inscripciones → datos personales. "Código P" (P1–P6) y "Horario" se llenan a mano al
//                   seleccionar. Marcar "Enviar enlace" manda el correo a esa persona.
//                   "Fotos" y "Carpeta de fotos" se llenan solas al subir (cantidad y enlace a Drive).
//                   "Asistencia" la llena la persona en la página de fotos, antes de subirlas.
//                   Marcar "Enviar lugar y hora" manda un segundo correo solo con eso (para quienes
//                   recibieron el primero antes de que hubiera lugar confirmado).
//   Subidas       → una fila por foto, con el Código P (nunca el RUT) y sin coordenadas.
// La persona sube sus fotos con su RUT; el script busca su Código P y guarda las fotos
// en una subcarpeta con ese código.
//
// Correr una vez desde el editor: prepararPlanilla, instalarBotonCorreo y crearClaveVisor.

// ID de la carpeta de Drive donde llegan las fotos (está en la URL de la carpeta,
// después de /folders/).
const CARPETA_ID = 'ID_DE_LA_CARPETA_DE_DRIVE';

// ID de la planilla (está en la URL, después de /d/).
const PLANILLA_ID = 'ID_DE_LA_PLANILLA';

// URL publicada de esta aplicación (termina en /exec). El correo enlaza a URL_APP + '?p=fotos'.
const URL_APP = 'https://script.google.com/macros/s/ID_DE_LA_APLICACION/exec';

// Datos que aparecen en el correo a los voluntarios. Completar antes de enviar.
// Mientras empiece con "[", el correo no nombra el lugar y avisa que se confirmará.
const LUGAR = '[lugar]';
// Hora que se usa cuando la persona no tiene una propia en la columna "Horario"
const HORA_INICIO = '10:30';
const FIRMA = '[tu nombre]';

// Lo que acepta la página de fotos en el campo RUT, para probarla sin inscripción
const CODIGO_PRUEBA = 'PRUEBA';

const ENCABEZADOS = [
  'Subida', 'Teléfono', 'Archivo', 'Tipo', 'MB',
  'GPS en teléfono', 'Fecha de captura', 'Modelo', 'Navegador',
  'Archivo en Drive', 'Código P', 'Zona horaria de captura', 'Lectura de metadatos',
];

const ENCABEZADOS_INSCRIPCION = [
  'Inscripción', 'Nombres', 'Primer apellido', 'Segundo apellido', 'Correo',
  'Mayor de 18', 'RUT', 'Disponible 14 oct AM', 'Consentimiento', 'Estado',
  'Código P', 'Horario', 'Enviar enlace', 'Enlace enviado', 'Fotos', 'Carpeta de fotos',
  'Asistencia', 'Enviar lugar y hora', 'Lugar y hora enviados',
];
// Posición (desde 0) de cada columna de Inscripciones, por nombre
const COL = Object.fromEntries(ENCABEZADOS_INSCRIPCION.map((h, i) => [h, i]));

const PAGINAS = {
  registro: { archivo: 'registro', titulo: 'rastro — inscripción' },
  fotos: { archivo: 'fotos', titulo: 'rastro — tus fotos' },
  prueba: { archivo: 'index', titulo: 'rastro — prueba de canal' },
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.accion) return api_(p);
  const pagina = PAGINAS[p.p] || PAGINAS.registro;
  return HtmlService.createTemplateFromFile(pagina.archivo).evaluate()
    .setTitle(pagina.titulo)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Permite que las páginas de Apps Script compartan la misma rutina EXIF.
function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

// ---- Inscripción ----

function registrar(d) {
  const limpio = v => String(v || '').trim().replace(/\s+/g, ' ');
  const nombres = mayusculaInicial_(limpio(d.nombres));
  const apellido1 = mayusculaInicial_(limpio(d.apellido1));
  const apellido2 = mayusculaInicial_(limpio(d.apellido2));
  const correo = limpio(d.correo).toLowerCase();
  const rut = normalizarRut_(d.rut);
  if (!nombres || !apellido1 || !apellido2) throw new Error('Escribe tus nombres y tus dos apellidos.');
  if (!correoValido_(correo)) throw new Error('El correo no es válido.');
  if (d.mayor !== 'sí') throw new Error('Este testeo es solo para personas mayores de 18 años.');
  if (!rutValido_(rut)) throw new Error('El RUT no es válido. Revisa el dígito verificador.');
  if (d.disponibilidad !== 'sí' && d.disponibilidad !== 'no') throw new Error('Responde si puedes asistir el miércoles 14 de octubre.');
  if (!d.consentimiento) throw new Error('Para inscribirte tienes que aceptar las condiciones.');

  const hoja = hojaInscripciones_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (filaDeRut_(hoja, rut)) return { repetida: true };
    hoja.appendRow([
      new Date(), nombres, apellido1, apellido2, correo,
      'sí', rut, d.disponibilidad, 'sí', 'inscrita/o',
      '', '', false, '', '', '',
    ]);
    hoja.getRange(hoja.getLastRow(), COL['Enviar enlace'] + 1).insertCheckboxes();
    return { repetida: false };
  } finally {
    lock.releaseLock();
  }
}

// "ana maría" → "Ana María"; "maría de la paz" → "María de la Paz" (las partículas quedan en minúscula)
function mayusculaInicial_(texto) {
  const particulas = ['de', 'del', 'la', 'las', 'los', 'y', 'van', 'von'];
  return texto.toLowerCase().split(' ').map((p, i) =>
    i > 0 && particulas.includes(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)
  ).join(' ');
}

function correoValido_(c) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
}

function normalizarRut_(r) {
  const limpio = String(r || '').replace(/[.\s-]/g, '').toUpperCase();
  return limpio.length > 1 ? limpio.slice(0, -1) + '-' + limpio.slice(-1) : limpio;
}

function rutValido_(rut) {
  const m = rut.match(/^(\d{7,8})-([\dK])$/);
  if (!m) return false;
  let suma = 0, factor = 2;
  for (let i = m[1].length - 1; i >= 0; i--) {
    suma += Number(m[1][i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === m[2];
}

function filaDeRut_(hoja, rut) {
  if (hoja.getLastRow() < 2) return null;
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_INSCRIPCION.length).getValues()
    .find(r => String(r[COL['RUT']]).toUpperCase() === rut) || null;
}

// Estado de una persona para la página de fotos:
//   { estado: 'ok', codigo: 'P1' } · { estado: 'pendiente' } (inscrita, sin Código P) · { estado: 'no' }
function estadoDeRut_(rutEscrito) {
  const texto = String(rutEscrito || '').trim().toUpperCase();
  if (texto === CODIGO_PRUEBA) return { estado: 'ok', codigo: CODIGO_PRUEBA };
  const rut = normalizarRut_(texto);
  if (!rutValido_(rut)) return { estado: 'no' };
  // Las 7 fotos llegan seguidas: el Código P se recuerda 10 minutos para no leer la planilla cada vez
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('rut:' + rut);
  if (guardado) return { estado: 'ok', codigo: guardado };
  const fila = filaDeRut_(hojaInscripciones_(), rut);
  if (!fila) return { estado: 'no' };
  const codigo = String(fila[COL['Código P']] || '').trim().toUpperCase();
  if (!codigo) return { estado: 'pendiente' };
  cache.put('rut:' + rut, codigo, 600);
  return { estado: 'ok', codigo };
}

// La página de fotos lo usa antes de elegir fotos. No devuelve el código ni datos personales:
// solo el estado y, si está confirmada, cuándo y dónde es su sesión (para el aviso final).
function verificarRut(rut) {
  const e = estadoDeRut_(rut);
  if (e.estado !== 'ok') return { estado: e.estado };
  let horario = '';
  if (e.codigo !== CODIGO_PRUEBA) {
    const hoja = hojaInscripciones_();
    const fila = filaDeRut_(hoja, normalizarRut_(rut));
    horario = fila ? horarioTexto_(fila[COL['Horario']], hoja) : '';
  }
  return { estado: 'ok', cuando: cuandoTexto_(horario), lugar: LUGAR };
}

// "10:15" aunque Sheets haya guardado la hora como fecha
function horarioTexto_(valor, hoja) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, hoja.getParent().getSpreadsheetTimeZone(), 'HH:mm');
  }
  return String(valor || '').trim();
}

function cuandoTexto_(horario) {
  return 'el miércoles 14 de octubre' + (horario ? ` a las ${horario}` : ` desde las ${HORA_INICIO}`);
}

// ---- Confirmación de asistencia (página de fotos, antes de subirlas) ----
// Escribe "sí · 13/10 21:30" o "no · …" en Asistencia. Si no puede, la fila queda en naranjo
// y te llega un correo para avisar a una reserva.
function confirmarAsistencia(rutEscrito, respuesta) {
  if (respuesta !== 'sí' && respuesta !== 'no') throw new Error('Respuesta no válida.');
  const e = estadoDeRut_(rutEscrito);
  if (e.estado !== 'ok') throw new Error('Ese RUT no está confirmado.');
  if (e.codigo === CODIGO_PRUEBA) return { ok: true };
  const hoja = hojaInscripciones_();
  const rut = normalizarRut_(String(rutEscrito).trim().toUpperCase());
  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, ENCABEZADOS_INSCRIPCION.length).getValues();
  const i = datos.findIndex(r => String(r[COL['RUT']]).toUpperCase() === rut);
  if (i < 0) throw new Error('No encontré la inscripción.');
  const fila = i + 2;
  const zona = hoja.getParent().getSpreadsheetTimeZone();
  hoja.getRange(fila, COL['Asistencia'] + 1).setValue(`${respuesta} · ${Utilities.formatDate(new Date(), zona, 'dd/MM HH:mm')}`);
  hoja.getRange(fila, COL['Estado'] + 1).setValue(respuesta === 'sí' ? 'confirmó asistencia' : 'no puede asistir');
  if (respuesta === 'no') {
    hoja.getRange(fila, 1, 1, ENCABEZADOS_INSCRIPCION.length).setBackground('#ffd9a8');
    let yo = '';
    try { yo = Session.getEffectiveUser().getEmail(); } catch (err) {}
    if (yo) MailApp.sendEmail({ to: yo, subject: `rastro · ${e.codigo} no puede asistir`, name: 'rastro',
      body: `${e.codigo} respondió en la página de fotos que no puede asistir el miércoles 14 de octubre. Revisa la planilla para avisar a una reserva:\n${SpreadsheetApp.openById(PLANILLA_ID).getUrl()}` });
  }
  return { ok: true };
}

// ---- Correo al voluntario: casilla "Enviar enlace" ----

// Correr una vez desde el editor: pide el permiso para enviar correos e instala el disparador
// que envía el correo al marcar la casilla. Volver a correrlo si aparece
// "You do not have permission to call MailApp.sendEmail".
function instalarBotonCorreo() {
  const quedan = MailApp.getRemainingDailyQuota(); // hace que Google pida el permiso de correo
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'alEditarPlanilla')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('alEditarPlanilla').forSpreadsheet(PLANILLA_ID).onEdit().create();
  const hoja = hojaInscripciones_();
  if (hoja.getLastRow() > 1) {
    hoja.getRange(2, COL['Enviar enlace'] + 1, hoja.getLastRow() - 1, 1).insertCheckboxes();
    hoja.getRange(2, COL['Enviar lugar y hora'] + 1, hoja.getLastRow() - 1, 1).insertCheckboxes();
  }
  Logger.log(`Listo: al marcar "Enviar enlace" en Inscripciones se envía el correo. Correos disponibles hoy: ${quedan}.`);
}

// Se ejecuta con cada edición de la planilla. Solo actúa al marcar una casilla de "Enviar enlace".
function alEditarPlanilla(e) {
  const rango = e && e.range;
  if (!rango || rango.getSheet().getName() !== 'Inscripciones' || rango.getRow() < 2) return;
  const columna = rango.getColumn();
  const esEnlace = columna === COL['Enviar enlace'] + 1, esLugar = columna === COL['Enviar lugar y hora'] + 1;
  if (!esEnlace && !esLugar) return;
  if (String(e.value).toUpperCase() !== 'TRUE') return;

  const hoja = rango.getSheet();
  const fila = rango.getRow();
  const celdaResultado = hoja.getRange(fila, COL[esEnlace ? 'Enlace enviado' : 'Lugar y hora enviados'] + 1);
  const filaEntera = hoja.getRange(fila, 1, 1, ENCABEZADOS_INSCRIPCION.length);
  try {
    const { correo, codigo } = esEnlace ? enviarCorreo_(hoja, fila) : enviarLugar_(hoja, fila);
    celdaResultado.setValue(new Date());
    if (esEnlace) hoja.getRange(fila, COL['Estado'] + 1).setValue('enlace enviado');
    // Señales visibles: fila en verde y aviso en la esquina de la planilla (además de la copia en tu correo)
    filaEntera.setBackground('#e6f9b0');
    e.source.toast(`Correo enviado a ${correo} (${codigo}). Te llegó una copia.`, 'rastro · enviado', 8);
  } catch (err) {
    celdaResultado.setValue('No enviado: ' + err.message);
    filaEntera.setBackground('#ffd6cc');
    e.source.toast(`No se envió: ${err.message}`, 'rastro · ERROR', 15);
  } finally {
    rango.setValue(false);
  }
}

function enviarCorreo_(hoja, fila) {
  const r = hoja.getRange(fila, 1, 1, ENCABEZADOS_INSCRIPCION.length).getValues()[0];
  const nombres = String(r[COL['Nombres']]).trim();
  const correo = String(r[COL['Correo']]).trim();
  const codigo = String(r[COL['Código P']]).trim();
  if (!correoValido_(correo)) throw new Error('falta un correo válido.');
  if (!codigo) throw new Error('falta el Código P.');

  const cuando = cuandoTexto_(horarioTexto_(r[COL['Horario']], hoja));
  // Mientras LUGAR siga como "[lugar]", el correo no lo nombra y avisa que se confirmará
  const hayLugar = !LUGAR.startsWith('[');
  const dondeTxt = hayLugar ? `, en ${LUGAR}` : '';
  const pendienteTxt = hayLugar ? '' : ' Te confirmaré el lugar por este mismo correo.';
  const enlace = URL_APP + '?p=fotos';
  const primerNombre = mayusculaInicial_(nombres.split(' ')[0]);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const texto = [
    `Hola ${primerNombre}:`,
    '',
    `Gracias por inscribirte en el testeo de rastro. Te espero ${cuando}${dondeTxt}. La sesión dura unos 30 minutos.${pendienteTxt}`,
    '',
    'En el enlace, primero confirma si puedes asistir. Después sube 7 fotos de esta semana tomadas con la cámara de tu teléfono, idealmente de días distintos. No sirven capturas de pantalla ni fotos que te enviaron por WhatsApp.',
    '',
    `Confirma y sube tus fotos aquí (te pedirá tu RUT): ${enlace}`,
    '',
    'Si no puedes asistir, responde este correo.',
    '',
    FIRMA,
  ].join('\n');

  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0b0b0b;max-width:520px">
      <p>Hola ${esc(primerNombre)}:</p>
      <p>Gracias por inscribirte en el testeo de rastro. Te espero <b>${esc(cuando)}</b>${esc(dondeTxt)}. La sesión dura unos 30 minutos.${esc(pendienteTxt)}</p>
      <p>En el enlace, primero <b>confirma si puedes asistir</b>. Después sube <b>7 fotos de esta semana</b> tomadas con la cámara de tu teléfono, idealmente de días distintos. No sirven capturas de pantalla ni fotos que te enviaron por WhatsApp.</p>
      <p><a href="${enlace}" style="display:inline-block;background:#c6f21c;color:#0b0b0b;border:1.5px solid #0b0b0b;border-radius:999px;padding:12px 22px;font-weight:600;text-decoration:none">Confirmar y subir mis fotos</a></p>
      <p style="color:#666;font-size:13px">Te pedirá tu RUT. Si el botón no funciona, copia este enlace: ${enlace}</p>
      <p>Si no puedes asistir, responde este correo.</p>
      <p>${FIRMA}</p>
    </div>`;

  // Copia oculta a la cuenta dueña del script: cada envío queda también en tu bandeja.
  // Si Google no entrega la dirección, el correo al participante sale igual, sin copia.
  let copia = '';
  try { copia = Session.getEffectiveUser().getEmail(); } catch (err) {}
  const mensaje = { to: correo, subject: 'rastro · tu testeo del miércoles 14 de octubre', body: texto, htmlBody: html, name: FIRMA };
  if (copia) mensaje.bcc = copia;
  MailApp.sendEmail(mensaje);
  return { correo, codigo };
}

// Segundo correo: solo el lugar y la hora confirmados, con el enlace por si todavía no sube sus fotos
function enviarLugar_(hoja, fila) {
  const r = hoja.getRange(fila, 1, 1, ENCABEZADOS_INSCRIPCION.length).getValues()[0];
  const correo = String(r[COL['Correo']]).trim();
  const codigo = String(r[COL['Código P']]).trim();
  if (!correoValido_(correo)) throw new Error('falta un correo válido.');
  if (!codigo) throw new Error('falta el Código P.');
  if (LUGAR.startsWith('[')) throw new Error('todavía no hay lugar: completa LUGAR en Code.gs.');
  const cuando = cuandoTexto_(horarioTexto_(r[COL['Horario']], hoja));
  const enlace = URL_APP + '?p=fotos';
  const primerNombre = mayusculaInicial_(String(r[COL['Nombres']]).trim().split(' ')[0]);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yaSubio = Number(r[COL['Fotos']]) > 0;

  const texto = [
    `Hola ${primerNombre}:`,
    '',
    `Te confirmo el lugar y la hora del testeo de rastro: ${cuando}, en ${LUGAR}. La sesión dura unos 30 minutos.`,
    '',
    yaSubio ? 'Ya recibí tus fotos, no necesitas hacer nada más.' : `Si todavía no subes tus 7 fotos de esta semana, hazlo aquí (te pedirá tu RUT): ${enlace}`,
    '',
    'Si no puedes asistir, responde este correo.',
    '',
    FIRMA,
  ].join('\n');
  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0b0b0b;max-width:520px">
      <p>Hola ${esc(primerNombre)}:</p>
      <p>Te confirmo el lugar y la hora del testeo de rastro: <b>${esc(cuando)}</b>, en <b>${esc(LUGAR)}</b>. La sesión dura unos 30 minutos.</p>
      ${yaSubio ? '<p>Ya recibí tus fotos, no necesitas hacer nada más.</p>'
        : `<p>Si todavía no subes tus 7 fotos de esta semana, hazlo aquí:</p>
      <p><a href="${enlace}" style="display:inline-block;background:#c6f21c;color:#0b0b0b;border:1.5px solid #0b0b0b;border-radius:999px;padding:12px 22px;font-weight:600;text-decoration:none">Confirmar y subir mis fotos</a></p>`}
      <p>Si no puedes asistir, responde este correo.</p>
      <p>${FIRMA}</p>
    </div>`;

  let copia = '';
  try { copia = Session.getEffectiveUser().getEmail(); } catch (err) {}
  const mensaje = { to: correo, subject: 'rastro · lugar y hora de tu testeo (miércoles 14)', body: texto, htmlBody: html, name: FIRMA };
  if (copia) mensaje.bcc = copia;
  MailApp.sendEmail(mensaje);
  return { correo, codigo };
}

// ---- Diagnóstico de correo ----
// Correr desde el editor después de escribir una dirección en PRUEBA_A. Envía dos correos:
// uno simple (sin enlace) y uno con el mismo enlace del correo real. Si llega solo el simple,
// el filtro de spam del destino está reteniendo el enlace a script.google.com.
const PRUEBA_A = '';
function probarCorreo() {
  if (!PRUEBA_A) throw new Error('Escribe una dirección en PRUEBA_A (arriba de esta función) y vuelve a ejecutar.');
  Logger.log(`Correos disponibles hoy: ${MailApp.getRemainingDailyQuota()}. Remitente: ${Session.getEffectiveUser().getEmail()}`);
  MailApp.sendEmail({ to: PRUEBA_A, subject: 'rastro · prueba 1 (sin enlace)', body: 'Prueba de envío desde Apps Script, sin enlaces.', name: FIRMA });
  MailApp.sendEmail({ to: PRUEBA_A, subject: 'rastro · prueba 2 (con enlace)', name: FIRMA,
    body: `Prueba con el enlace del correo real: ${URL_APP}?p=fotos`,
    htmlBody: `<p>Prueba con el enlace del correo real:</p><p><a href="${URL_APP}?p=fotos">Confirmar y subir mis fotos</a></p>` });
  Logger.log(`Listo: se enviaron 2 correos a ${PRUEBA_A}. Revisa bandeja, Spam y la cuarentena del correo institucional.`);
}

// ---- Subida de fotos ----

function subir(archivo) {
  if (!archivo || typeof archivo !== 'object') throw new Error('La subida no tiene datos válidos.');
  const e = estadoDeRut_(archivo.rut);
  if (e.estado === 'no') throw new Error('Ese RUT no está inscrito.');
  if (e.estado === 'pendiente') throw new Error('Tu inscripción todavía no está confirmada.');
  const codigo = e.codigo;
  const nombre = String(archivo.nombre || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180);
  const tiposExtension = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif' };
  const extension = nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : '';
  const tipoInformado = String(archivo.tipo || '').toLowerCase().split(';')[0];
  const tipo = tipoInformado.startsWith('image/') ? tipoInformado : tiposExtension[extension];
  const datos = String(archivo.datos || '').replace(/^data:[^,]*,/, '');
  if (!Object.values(tiposExtension).includes(tipo)) throw new Error('El archivo debe ser una imagen compatible.');
  if (!nombre || !datos || datos.length > 21 * 1024 * 1024) throw new Error('La imagen supera el límite de 15 MB o está vacía.');
  if (!archivo.visto || typeof archivo.visto !== 'object') throw new Error('No se pudieron leer los datos de la imagen.');
  let bytes;
  try { bytes = Utilities.base64Decode(datos); } catch (err) { throw new Error('La imagen llegó dañada.'); }
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('La imagen supera el límite de 15 MB o está vacía.');
  const blob = Utilities.newBlob(bytes, tipo, nombre);

  // Las fotos llegan en paralelo: el candado evita crear dos carpetas con el mismo nombre
  const raiz = DriveApp.getFolderById(CARPETA_ID);
  const nombreCarpeta = codigo;
  let carpeta, f;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sub = raiz.getFoldersByName(nombreCarpeta);
    carpeta = sub.hasNext() ? sub.next() : raiz.createFolder(nombreCarpeta);
    const existentes = carpeta.getFiles();
    let total = 0;
    while (existentes.hasNext()) { existentes.next(); total++; }
    if (total >= 10) throw new Error('Esta carpeta ya alcanzó el límite de 10 fotos.');
    f = carpeta.createFile(blob);
    f.setDescription(JSON.stringify({ gps: archivo.visto.gps === true, fecha: String(archivo.visto.fecha || '').slice(0, 40) }));
  } finally {
    lock.releaseLock();
  }

  const v = archivo.visto;
  hoja_().appendRow([
    new Date(), String(archivo.telefono || '').slice(0, 80), nombre, tipo, Math.round(bytes.length / 1e4) / 100,
    v.gps === true ? 'sí' : 'no', String(v.fecha || 'no').slice(0, 40), String(v.modelo || 'no').slice(0, 120), String(v.navegador || '').slice(0, 240),
    f.getUrl(), codigo, String(v.zona || 'no').slice(0, 8), String(v.lectura || 'desconocida').slice(0, 20),
  ]);

  if (codigo && codigo !== CODIGO_PRUEBA) vincularCarpeta_(codigo, carpeta);

  return { nombre: f.getName(), bytes: f.getSize() };
}

// Escribe en Inscripciones cuántas fotos hay en la carpeta de esa persona y el enlace a la carpeta.
// Las fotos llegan en paralelo: con el candado, la última en escribir cuenta todas.
function vincularCarpeta_(codigo, carpeta) {
  const hoja = hojaInscripciones_();
  if (hoja.getLastRow() < 2) return;
  const codigos = hoja.getRange(2, COL['Código P'] + 1, hoja.getLastRow() - 1, 1).getValues();
  const i = codigos.findIndex(r => String(r[0]).trim().toUpperCase() === codigo);
  if (i < 0) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let n = 0;
    const archivos = carpeta.getFiles();
    while (archivos.hasNext()) { archivos.next(); n++; }
    hoja.getRange(i + 2, COL['Fotos'] + 1).setValue(n);
    hoja.getRange(i + 2, COL['Carpeta de fotos'] + 1).setRichTextValue(
      SpreadsheetApp.newRichTextValue().setText(`Ver fotos de ${codigo}`).setLinkUrl(carpeta.getUrl()).build()
    );
  } finally {
    lock.releaseLock();
  }
}

// Correr una vez desde el editor: llena "Fotos" y "Carpeta de fotos" para quienes ya subieron
// antes de que existieran esas columnas. Se puede volver a correr cuando quieras.
function vincularFotosExistentes() {
  prepararPlanilla();
  const raiz = DriveApp.getFolderById(CARPETA_ID);
  const hoja = hojaInscripciones_();
  if (hoja.getLastRow() < 2) return;
  const codigos = hoja.getRange(2, COL['Código P'] + 1, hoja.getLastRow() - 1, 1).getValues()
    .map(r => String(r[0]).trim().toUpperCase()).filter(Boolean);
  let listos = 0;
  codigos.forEach(codigo => {
    const sub = raiz.getFoldersByName(codigo);
    if (sub.hasNext()) { vincularCarpeta_(codigo, sub.next()); listos++; }
  });
  Logger.log(`Listo: ${listos} de ${codigos.length} personas con Código P tienen carpeta de fotos.`);
}

// ---- Planilla: pestañas "Subidas" e "Inscripciones" ----

// Correr una vez desde el editor: pide los permisos y prepara las dos pestañas.
function prepararPlanilla() {
  hoja_();
  hojaInscripciones_();
  Logger.log('Planilla: ' + SpreadsheetApp.openById(PLANILLA_ID).getUrl());
}

function hoja_() {
  const ss = SpreadsheetApp.openById(PLANILLA_ID);
  let hoja = ss.getSheetByName('Subidas');
  if (!hoja) {
    // La primera pestaña ya tiene las subidas de la prueba de canal: se renombra
    const primera = ss.getSheets()[0];
    const a1 = primera.getLastRow() ? String(primera.getRange(1, 1).getValue()) : '';
    hoja = (a1 === '' || a1 === 'Subida') ? primera.setName('Subidas') : ss.insertSheet('Subidas');
  }
  return prepararHoja_(hoja, ENCABEZADOS);
}

function hojaInscripciones_() {
  const ss = SpreadsheetApp.openById(PLANILLA_ID);
  const hoja = ss.getSheetByName('Inscripciones') || ss.insertSheet('Inscripciones');
  return prepararHoja_(hoja, ENCABEZADOS_INSCRIPCION);
}

// Deja la primera fila igual a los encabezados (mismo orden de columnas)
function prepararHoja_(hoja, encabezados) {
  const actual = hoja.getLastColumn() ? hoja.getRange(1, 1, 1, encabezados.length).getValues()[0] : [];
  if (encabezados.some((h, i) => actual[i] !== h)) {
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

// ---- API para el visor local ----
// Las fotos traen GPS: sin la clave no se entrega nada.

// Correr una vez desde el editor: crea la clave del visor y la muestra en el registro.
function crearClaveVisor() {
  const clave = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('CLAVE_VISOR', clave);
  Logger.log('Clave del visor: ' + clave);
}

function api_(p) {
  const clave = PropertiesService.getScriptProperties().getProperty('CLAVE_VISOR');
  if (!clave || p.clave !== clave) return json_({ error: 'Clave incorrecta. Revisa la clave del visor.' });

  if (p.accion === 'lista') {
    const valores = hoja_().getDataRange().getValues();
    const enc = valores.shift() || [];
    const filas = valores.map(r => {
      const o = {};
      enc.forEach((h, i) => { o[h] = r[i]; });
      const m = String(o['Archivo en Drive'] || '').match(/\/d\/([^/?]+)/);
      o.id = m ? m[1] : null;
      return o;
    }).filter(o => o.id);
    return json_({ filas });
  }

  if (p.accion === 'foto') {
    let f;
    try { f = DriveApp.getFileById(p.id); } catch (err) { return json_({ error: 'No se encontró el archivo.' }); }
    if (!dentroDeCarpeta_(f)) return json_({ error: 'El archivo no está en la carpeta de la prueba.' });
    const b = f.getBlob();
    return json_({ nombre: f.getName(), tipo: b.getContentType(), datos: Utilities.base64Encode(b.getBytes()) });
  }

  return json_({ error: 'Acción desconocida.' });
}

// Solo entrega archivos de la carpeta de la prueba o de sus subcarpetas
function dentroDeCarpeta_(f) {
  const padres = f.getParents();
  while (padres.hasNext()) {
    const p = padres.next();
    if (p.getId() === CARPETA_ID) return true;
    const abuelos = p.getParents();
    while (abuelos.hasNext()) if (abuelos.next().getId() === CARPETA_ID) return true;
  }
  return false;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
