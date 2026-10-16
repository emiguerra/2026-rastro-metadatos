// Lectura compartida para las páginas locales. Conserva la fecha EXIF como hora de pared
// junto con su offset; no transforma una fecha sin zona horaria a UTC.
window.RastroExif = {
  async leer(blob) {
    let tags;
    try {
      tags = await exifr.parse(blob, {
        tiff: true, exif: true, gps: true, ifd1: false, interop: false,
        xmp: false, icc: false, iptc: false, makerNote: false, userComment: false,
        reviveValues: false,
      });
    } catch (error) {
      return { estado: 'error', lat: null, lon: null, gps: false, fecha: null, zona: null, error: null, modelo: null };
    }
    let pos = null;
    try { pos = await exifr.gps(blob); } catch (error) {}
    const lat = pos && typeof pos.latitude === 'number' ? pos.latitude : null;
    const lon = pos && typeof pos.longitude === 'number' ? pos.longitude : null;
    return {
      estado: 'ok', lat, lon, gps: lat != null && lon != null,
      fecha: tags && tags.DateTimeOriginal != null ? String(tags.DateTimeOriginal) : null,
      zona: tags && tags.OffsetTimeOriginal ? String(tags.OffsetTimeOriginal) : null,
      error: tags && typeof tags.GPSHPositioningError === 'number' ? tags.GPSHPositioningError : null,
      modelo: tags && tags.Model ? `${tags.Make || ''} ${tags.Model}`.trim() : null,
    };
  },
};
