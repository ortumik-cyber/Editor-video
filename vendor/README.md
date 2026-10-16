# Código de terceros

Copias sin modificar de paquetes publicados en npm, fijadas a una versión. Se incluyen en el repositorio porque la app no tiene paso de build.

| Archivo | Paquete | Versión | Licencia | Autor |
|---|---|---|---|---|
| `mp4-muxer.mjs` | [mp4-muxer](https://www.npmjs.com/package/mp4-muxer) | 5.2.2 | MIT | Vanilagy |
| `libheif-bundle.mjs` | [libheif-js](https://www.npmjs.com/package/libheif-js) (`libheif-wasm/libheif-bundle.mjs`) | 1.23.5 | LGPL-3.0 | Strukturag (libheif), catdad (empaquetado) |
| `webm-muxer.mjs` | [webm-muxer](https://www.npmjs.com/package/webm-muxer) | 5.1.4 | MIT | Vanilagy |

Los muxers se revisaron: no hacen peticiones de red ni usan `eval`. `libheif-bundle.mjs` es código generado con Emscripten; contiene rutas genéricas con `fetch`/`XMLHttpRequest` para cargar el `.wasm`, pero aquí el binario viene incrustado y no se usan. Se carga solo al importar una foto HEIC que el navegador no sabe abrir. Es LGPL: el archivo va sin modificar y aparte, de modo que se puede sustituir por otra versión; los textos de licencia están en `libheif.LICENSE` y `libheif-js.LICENSE`. Para actualizar, descarga el paquete con `npm pack` y copia `build/<nombre>.mjs`.
