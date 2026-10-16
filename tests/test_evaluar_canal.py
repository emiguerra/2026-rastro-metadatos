"""Pruebas unitarias para los helpers del informe de canales de subida."""

import unittest

from evaluar_canal import canal_y_telefono, celda, dimensiones, gps_igual, stem, tiene_gps


class MetadatosTest(unittest.TestCase):
    def test_tiene_gps_requiere_latitud_y_longitud(self):
        self.assertTrue(tiene_gps({"GPSLatitude": -33.4, "GPSLongitude": -70.6}))
        self.assertFalse(tiene_gps({"GPSLatitude": -33.4}))
        self.assertFalse(tiene_gps({}))

    def test_gps_igual_acepta_diferencias_menores_a_uno_e_menos_cinco_grados(self):
        original = {"GPSLatitude": -33.4, "GPSLongitude": -70.6}
        cercano = {"GPSLatitude": -33.400009, "GPSLongitude": -70.600009}
        lejano = {"GPSLatitude": -33.40002, "GPSLongitude": -70.6}

        self.assertTrue(gps_igual(original, cercano))
        self.assertFalse(gps_igual(original, lejano))
        self.assertFalse(gps_igual(original, {"GPSLatitude": -33.4}))

    def test_dimensiones_ignora_rotacion_y_rechaza_dimensiones_ausentes(self):
        self.assertEqual(dimensiones({"ImageWidth": 3024, "ImageHeight": 4032}), (3024, 4032))
        self.assertEqual(dimensiones({"ImageWidth": 4032, "ImageHeight": 3024}), (3024, 4032))
        self.assertIsNone(dimensiones({"ImageWidth": 0, "ImageHeight": 3024}))

    def test_stem_normaliza_mayusculas_y_extension(self):
        self.assertEqual(stem({"FileName": "IMG_1234.HEIC"}), "img_1234")
        self.assertEqual(stem({}), "")

    def test_canal_y_telefono_toma_los_dos_niveles_iniciales(self):
        self.assertEqual(
            canal_y_telefono("/captura/01-forms/iphone/IMG_1234.jpg", "/captura"),
            ("01-forms", "iphone"),
        )

    def test_celda_escapa_separadores_y_quita_saltos_de_linea(self):
        self.assertEqual(celda("foto|uno\n dos\r"), "foto\\|uno  dos ")


if __name__ == "__main__":
    unittest.main()
