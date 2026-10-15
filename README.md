# editor-video

Editor de vídeo e imagen en el navegador (PWA). Cortar, efectos, texto, música y exportación a MP4.

Arquitectura y estado de cada módulo: [docs/architecture.md](docs/architecture.md).

```bash
npm test
```

## Publicar

`.github/workflows/pages.yml` publica la web en GitHub Pages con cada subida a `main`. Pasos, una sola vez:

1. En el repositorio: Settings → Pages → Source: **GitHub Actions**.
2. Sube a `main` (o lanza el flujo a mano desde la pestaña Actions).
3. La dirección será `https://<usuario>.github.io/editor-video/`. Ábrela en el móvil y usa «Añadir a pantalla de inicio».

Todas las rutas son relativas, así que funciona en esa subcarpeta (comprobado con servidor en `/editor-video/`).
