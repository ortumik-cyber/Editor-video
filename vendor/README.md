# Código de terceros

Copias sin modificar de paquetes publicados en npm, fijadas a una versión. Se incluyen en el repositorio porque la app no tiene paso de build.

| Archivo | Paquete | Versión | Licencia | Autor |
|---|---|---|---|---|
| `mp4-muxer.mjs` | [mp4-muxer](https://www.npmjs.com/package/mp4-muxer) | 5.2.2 | MIT | Vanilagy |
| `webm-muxer.mjs` | [webm-muxer](https://www.npmjs.com/package/webm-muxer) | 5.1.4 | MIT | Vanilagy |

Se revisó que no hacen peticiones de red ni usan `eval`. Para actualizar, descarga el paquete con `npm pack` y copia `build/<nombre>.mjs`.
