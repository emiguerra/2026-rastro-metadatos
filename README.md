# 2026-rastro-metadatos

herramientas para leer los metadatos de las fotos de los participantes de rastro: inscripción, subida de 7 fotos de la semana, y un visor que convierte esas fotos en un recorrido por comuna y día, sin guardar coordenadas exactas.

la captura del cuerpo (postura, rostro, ojos) está en [2026-tres-analisis-paralelo](https://github.com/emiguerra/2026-tres-analisis-paralelo). la hoja 1 del expediente sale de ahí; la hoja 2, de este repo.

el contenido de fondo (qué trae una imagen, por qué comunas y no direcciones, metodología del testeo) está en el documento *rastro — Sistema de metadatos y metodología de testeo*. el orden y las fechas, en el plan operativo.

| pieza | archivo | qué hace |
| --- | --- | --- |
| inscripción | [appscript-subida/registro.html](appscript-subida/registro.html) | nombre, correo, mayor de 18, RUT (con dígito verificador), disponibilidad y consentimiento |
| subida de fotos | [appscript-subida/fotos.html](appscript-subida/fotos.html) | pide el RUT, confirma asistencia y sube las 7 fotos. no muestra nada sobre metadatos |
| prueba de canal | [appscript-subida/index.html](appscript-subida/index.html) | igual que la subida, pero muestra GPS, fecha y modelo de cada foto. solo para pruebas, no para participantes |
| servidor | [appscript-subida/Code.gs](appscript-subida/Code.gs) | Apps Script: sirve las tres páginas, guarda en Drive y en la planilla, manda los correos y entrega las fotos al visor |
| visor | [visor.html](visor.html) | lee las subidas, agrupa por participante (código P), asigna comuna y arma el recorrido. genera el expediente imprimible |
| lector | [lector-metadatos.html](lector-metadatos.html) | lee fotos sueltas en el navegador, sin subirlas a ningún lado: comuna, fecha, hora y recorrido |
| evaluar canal | [evaluar_canal.py](evaluar_canal.py) | compara qué metadatos sobreviven en cada canal de subida (tabla en Markdown) |
| comunas | [comunas.json](comunas.json) | polígonos de las 346 comunas de Chile, para el cruce punto-polígono |

las páginas leen los metadatos con [exifr](https://github.com/MikeKovarik/exifr) en el navegador. el script de Python usa [ExifTool](https://exiftool.org). la comuna se calcula en el propio computador: las coordenadas no van a ningún servicio externo.

## el recorrido de una foto

1. la persona se inscribe en la página de inscripción. queda en la pestaña **Inscripciones** de la planilla.
2. al seleccionarla, se escribe su código (P1 a P6) en la columna "Código P" y se marca "Enviar enlace". le llega un correo con el enlace a `?p=fotos`.
3. en esa página escribe su RUT, confirma si puede asistir y sube sus 7 fotos. las fotos quedan en Drive, en una subcarpeta con su código. la pestaña **Subidas** guarda una fila por foto con el código, nunca el RUT, y sin coordenadas.
4. el visor pide las fotos al Apps Script (con clave), lee GPS y fecha de cada una, asigna la comuna y ordena por `DateTimeOriginal`: "lunes Santiago → miércoles Providencia → sábado Maipú".
5. el botón «Expediente» del visor arma la hoja imprimible: hoja 1, cuerpo y clasificación; hoja 2, recorrido de la semana.

## antes de empezar: el Apps Script

una sola vez, en [script.google.com](https://script.google.com):

1. crear un proyecto y copiar los cuatro archivos de `appscript-subida/` (los `.html` con el mismo nombre, sin extensión).
2. en `Code.gs`, completar `CARPETA_ID` (carpeta de Drive donde llegan las fotos), `PLANILLA_ID`, `LUGAR`, `HORA_INICIO` y `FIRMA`.
3. desde el editor, correr una vez cada una:
   - `prepararPlanilla` crea las pestañas **Inscripciones** y **Subidas** y pide los permisos
   - `instalarBotonCorreo` instala el disparador que manda el correo al marcar la casilla
   - `crearClaveVisor` genera la clave del visor y la muestra en el registro
4. implementar como aplicación web (ejecutar como: yo; acceso: cualquier persona). copiar la URL que termina en `/exec` a `URL_APP`.

la persona que sube fotos no necesita cuenta de Google.

### páginas (misma URL)

- `/exec` inscripción
- `/exec?p=fotos` subida de fotos. con `PRUEBA` en vez de RUT se puede probar sin estar inscrita
- `/exec?p=prueba` prueba de canal: **muestra metadatos**, no compartir con participantes
- `/exec?accion=lista&clave=…` y `/exec?accion=foto&id=…&clave=…` API del visor

### casillas de la planilla

- `Enviar enlace` manda el primer correo (día, hora, lugar y enlace a las fotos). la fila queda en verde si salió, en rojo si no
- `Enviar lugar y hora` manda un segundo correo solo con eso, para quienes recibieron el primero antes de que hubiera lugar
- si alguien responde que no puede asistir, la fila queda en naranjo y te llega un correo para avisar a una reserva
- `Fotos` y `Carpeta de fotos` se llenan solas al subir

si los correos no llegan, `probarCorreo` (con una dirección en `PRUEBA_A`) manda uno sin enlace y otro con enlace: si llega solo el primero, el filtro de spam está reteniendo el enlace a `script.google.com`.

## visor

```sh
npx serve .        # o Live Server en VS Code, desde esta carpeta
```

antes, una sola vez, crear `.privado/config.js` con la URL del Apps Script (la carpeta está en `.gitignore`):

```js
window.RASTRO_API = 'https://script.google.com/macros/s/…/exec';
```

abrir `visor.html` y escribir la clave del visor. necesita `comunas.json` al lado, por eso no funciona abriendo el archivo con doble clic.

las fotos de cada participante se descargan solo al abrirlo y quedan guardadas en ese navegador.

## lector

abrir `lector-metadatos.html` (también desde un servidor local, por `comunas.json`) y elegir o arrastrar fotos. todo pasa en el navegador. trae una foto de ejemplo real, sin coordenadas.

## evaluar canal

compara canales de subida (Forms, correo, Drive, Apps Script) contra las fotos originales:

```sh
brew install exiftool
python3 evaluar_canal.py ~/Desktop/rastro-prueba-canal
python3 evaluar_canal.py ~/Desktop/rastro-prueba-canal --detalle   # una fila por archivo
```

espera esta estructura, con 3 fotos por teléfono:

```text
rastro-prueba-canal/
  00-original/iphone/   00-original/android/     línea base (cable o AirDrop)
  01-forms/iphone/      01-forms/android/
  05-appscript/iphone/  05-appscript/android/
  ...
```

un canal "conserva" un dato si lo mantiene en al menos 2 de 3 fotos. el script nunca imprime coordenadas, solo si existen.

resultado de la prueba (10 oct): se eligió la página propia en Apps Script. probada con dos iPhone y un Android, las fotos llegan a Drive con GPS y fecha.

## estructura

```text
appscript-subida/
  Code.gs          servidor: páginas, Drive, planilla, correos, API del visor
  registro.html    inscripción
  fotos.html       subida de las 7 fotos con el RUT
  index.html       prueba de canal (muestra metadatos)
visor.html         recorrido por participante + expediente imprimible
lector-metadatos.html   lector de fotos sueltas, solo en el navegador
evaluar_canal.py   tabla de qué sobrevive en cada canal (exiftool)
comunas.json       polígonos comunales (GeoJSON)
```

la comuna se asigna igual en el visor y en el lector: primero se descarta por caja (mínimos y máximos de cada comuna) y después se prueba punto en polígono, respetando los hoyos. si quieres cambiar la fuente de polígonos, cualquier GeoJSON con `Polygon` o `MultiPolygon` y una propiedad `comuna` sirve.

## privacidad

- las fotos traen GPS y pueden revelar dónde vive o trabaja una persona. **ninguna foto entra a este repositorio.**
- la planilla separa datos personales (Inscripciones) de las fotos (Subidas, solo con código P).
- la API del visor no entrega nada sin la clave, y solo archivos de la carpeta de fotos o sus subcarpetas.
- el recorrido se guarda por comuna, fecha y hora. las coordenadas se descartan después de asignar la comuna.
- el RUT se cruza a mano y se muestra al mismo nivel: comuna, nunca una dirección.
- no hay reconocimiento facial: la persona se identifica sola, con su RUT o su código.
- las fotos de la prueba de canal se borran después de probar el script de extracción.
- en el repo, `Code.gs` y `visor.html` llevan valores simulados (`ID_DE_LA_CARPETA_DE_DRIVE`, `ID_DE_LA_PLANILLA`, `ID_DE_LA_APLICACION`, `[lugar]`, `[tu nombre]`). los reales van solo en la copia local o en el editor de Apps Script, nunca en un commit. la carpeta `.privado/` está en `.gitignore` para guardarlos.

## notas

- las capturas de pantalla y las fotos reenviadas por WhatsApp llegan sin metadatos. por eso se piden fotos tomadas con la cámara del teléfono, de esta semana.
- en iPhone, al compartir desde Fotos aparece "Opciones" con un interruptor de "Ubicación". si está apagado, la foto sale sin GPS.
- si una foto no trae ubicación, el expediente usa una línea de tiempo con hora, modelo del teléfono y correlativo del nombre de archivo (IMG_8421 sugiere unas 8.400 fotos).
- `exifr` no lee XMP ni IPTC en HEIC, pero sí GPS y fecha, que es lo que se usa.

## créditos

- polígonos comunales: mapas vectoriales de la Biblioteca del Congreso Nacional, vía [fcortes/Chile-GeoJSON](https://github.com/fcortes/Chile-GeoJSON). ese repo no declara licencia; citar la fuente BCN.
- [exifr](https://github.com/MikeKovarik/exifr) (MIT) y [ExifTool](https://exiftool.org) (Phil Harvey).
