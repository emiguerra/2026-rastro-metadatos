#!/usr/bin/env python3
"""Prueba de canal de subida (paso 1 del plan operativo).

Recorre la carpeta de la prueba, lee los metadatos con exiftool y entrega
la tabla resumen en Markdown: cuántas fotos conservan GPS, fecha/hora,
modelo y nombre de archivo, por canal y teléfono.

Estructura esperada (ver plan-operativo-rastro.md):

    rastro-prueba-canal/
      00-original/iphone/   00-original/android/
      01-forms/iphone/      01-forms/android/
      ...

La carpeta 00-original es la línea base: sus nombres, software y
dimensiones se usan para detectar qué cambió en cada canal.

El script nunca imprime coordenadas, solo si existen.

Uso:
    python3 evaluar_canal.py ruta/a/rastro-prueba-canal
    python3 evaluar_canal.py ruta/a/rastro-prueba-canal --detalle
"""

import argparse
import json
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ORIGINAL = "00-original"
CAMPOS = [
    "FileName", "FileType", "Make", "Model", "Software",
    "DateTimeOriginal", "OffsetTimeOriginal",
    "GPSLatitude", "GPSLongitude", "ImageWidth", "ImageHeight",
]
EXTENSIONES = {".jpg", ".jpeg", ".heic", ".heif", ".png", ".dng", ".webp"}


def leer_metadatos(carpeta):
    if not shutil.which("exiftool"):
        sys.exit("No se encontró exiftool. Instálalo con: brew install exiftool")
    archivos = [p for p in carpeta.rglob("*") if p.suffix.lower() in EXTENSIONES]
    if not archivos:
        sys.exit(f"No hay imágenes en {carpeta}")
    salida = subprocess.run(
        ["exiftool", "-json", "-n", *[f"-{c}" for c in CAMPOS], *map(str, archivos)],
        capture_output=True, text=True,
    )
    # exiftool devuelve código 1 si algún archivo no se pudo leer, pero igual entrega el JSON
    if not salida.stdout.strip():
        sys.exit(salida.stderr)
    return json.loads(salida.stdout)


def canal_y_telefono(ruta, raiz):
    partes = Path(ruta).relative_to(raiz).parts
    if len(partes) < 3:
        return None
    return partes[0], partes[1]


def tiene_gps(m):
    return "GPSLatitude" in m and "GPSLongitude" in m


def dimensiones(m):
    w, h = m.get("ImageWidth"), m.get("ImageHeight")
    if not w or not h:
        return None
    return tuple(sorted((w, h)))  # ignora la rotación


def evaluar(raiz, detalle):
    grupos = defaultdict(list)
    for m in leer_metadatos(raiz):
        clave = canal_y_telefono(m["SourceFile"], raiz)
        if clave:
            grupos[clave].append(m)

    # Línea base por teléfono
    base = {}
    for (canal, tel), fotos in grupos.items():
        if canal == ORIGINAL:
            base[tel] = {
                "nombres": {Path(f["FileName"]).stem for f in fotos},
                "software": {str(f.get("Software", "")) for f in fotos},
                "dims": {dimensiones(f) for f in fotos},
                "formato": {f.get("FileType", "?") for f in fotos},
            }
            sin_gps = [f["FileName"] for f in fotos if not tiene_gps(f)]
            if sin_gps:
                print(f"⚠️  Línea base {tel}: sin GPS en {', '.join(sin_gps)}. "
                      "Reemplaza esas fotos antes de seguir.\n")

    if not base:
        print(f"⚠️  No hay carpeta {ORIGINAL}/: no se puede comparar nombre, software ni dimensiones.\n")

    filas = []
    for (canal, tel) in sorted(grupos):
        fotos = grupos[(canal, tel)]
        n = len(fotos)
        b = base.get(tel)
        gps = sum(tiene_gps(f) for f in fotos)
        fecha = sum("DateTimeOriginal" in f for f in fotos)
        zona = sum("OffsetTimeOriginal" in f for f in fotos)
        modelo = sum("Model" in f for f in fotos)
        formatos = sorted({f.get("FileType", "?") for f in fotos})

        obs = []
        if b:
            nombre = sum(any(o in f["FileName"] for o in b["nombres"]) for f in fotos)
            nombre_txt = f"{nombre}/{n}"
            if set(formatos) != b["formato"]:
                obs.append(f"formato cambió ({'/'.join(sorted(b['formato']))} → {'/'.join(formatos)})")
            soft = {str(f.get("Software", "")) for f in fotos} - b["software"]
            if soft - {""}:
                obs.append(f"software distinto: {', '.join(sorted(soft - {''}))}")
            dims = {dimensiones(f) for f in fotos} - b["dims"]
            if dims - {None}:
                obs.append("dimensiones cambiaron (posible recorte o compresión)")
        else:
            nombre_txt = "?"
        if zona < fecha:
            obs.append(f"zona horaria solo en {zona}/{n}")
        if n != 3:
            obs.append(f"{n} fotos (se esperaban 3)")

        nombre_canal = f"{canal} (control)" if canal == ORIGINAL else canal
        filas.append((nombre_canal, tel, f"{gps}/{n}", f"{fecha}/{n}", f"{modelo}/{n}",
                      nombre_txt, "/".join(formatos), "; ".join(obs)))

    print("| Canal | Teléfono | GPS | Fecha/hora | Modelo | Nombre conservado | Formato llegada | Observaciones |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for f in filas:
        print("| " + " | ".join(f) + " |")

    print("\nUn canal conserva un dato si lo mantiene en al menos 2 de 3 fotos.")
    for canal in sorted({c for c, _ in grupos} - {ORIGINAL}):
        tels = {t: grupos[(canal, t)] for c, t in grupos if c == canal}
        ok_gps = all(sum(tiene_gps(f) for f in fs) >= 2 for fs in tels.values())
        ok_fecha = all(sum("DateTimeOriginal" in f for f in fs) >= 2 for fs in tels.values())
        print(f"- {canal}: GPS {'sí' if ok_gps else 'no'}, fecha/hora {'sí' if ok_fecha else 'no'} "
              f"(en {', '.join(sorted(tels))})")

    if detalle:
        print("\n## Detalle por archivo\n")
        print("| Canal | Teléfono | Archivo | GPS | Fecha | Zona | Modelo | Software | Formato |")
        print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
        for (canal, tel) in sorted(grupos):
            for f in sorted(grupos[(canal, tel)], key=lambda x: x["FileName"]):
                print(f"| {canal} | {tel} | {f['FileName']} | {'sí' if tiene_gps(f) else 'no'} | "
                      f"{f.get('DateTimeOriginal', '—')} | {f.get('OffsetTimeOriginal', '—')} | "
                      f"{f.get('Make', '')} {f.get('Model', '—')} | {f.get('Software', '—')} | "
                      f"{f.get('FileType', '?')} |")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("carpeta", type=Path, help="carpeta rastro-prueba-canal")
    p.add_argument("--detalle", action="store_true", help="agrega una fila por archivo (sin coordenadas)")
    args = p.parse_args()
    if not args.carpeta.is_dir():
        sys.exit(f"No existe la carpeta {args.carpeta}")
    evaluar(args.carpeta.resolve(), args.detalle)


if __name__ == "__main__":
    main()
