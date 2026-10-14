# Arquitectura

App en el navegador, sin framework ni paso de build. Módulos ES. Los archivos del usuario no salen del dispositivo.

## Módulos

| # | Módulo | Estado |
|---|--------|--------|
| 1 | Núcleo: modelo, comandos, store, deshacer/rehacer, persistencia | hecho |
| 2 | Biblioteca: importar medios, miniaturas, metadatos, onda de audio | hecho |
| 3 | Línea de tiempo: pistas, clips, arrastrar, recortar, dividir, zoom, cursor | hecho |
| 4 | Motor de previsualización (Canvas/WebGL + WebAudio) | pendiente |
| 5 | Efectos y transiciones | pendiente |
| 6 | Texto y stickers | pendiente |
| 7 | Audio | pendiente |
| 8 | Exportación MP4 (WebCodecs + muxer) | pendiente |
| 9 | Interfaz y PWA | pendiente |

## Núcleo (`src/core`)

- `project.js`: esquema y fábricas (`createProject`, `createClip`, `createAsset`, `createTrack`).
- `commands.js`: `reduce(project, comando)` es una función pura. Valida y lanza `CommandError` con `code`.
- `store.js`: aplica comandos, guarda historial, expone selección y cursor. `dispatch` devuelve `{ ok, error }` y no lanza por errores de dominio.
- `selectors.js`: lecturas derivadas (`projectDuration`, `clipsAt`, `firstFreeStart`).
- `persist.js`: repositorio con backend inyectable (IndexedDB o memoria), autosave y `migrate`.

## Biblioteca (`src/library`)

- `library.js`: `importFiles(files, { onProgress })` valida, inspecciona, guarda el archivo y registra el medio. Devuelve `{ added, rejected }`. Un lote es un solo paso de historial. Importa en serie para no cargar varios archivos grandes a la vez.
- `dom.js`: adaptadores de navegador (`createDomAdapters`). Leen duración y tamaño con elementos `<video>`/`<audio>`, `createImageBitmap` para imágenes, miniatura en WebP de 320 px y picos de onda con `OfflineAudioContext` a 8 kHz.
- `kinds.js`, `waveform.js`: lógica pura (tipo por MIME o extensión, límites, picos).
- Las miniaturas se guardan en el repositorio con la clave `<assetId>:thumb`. Los picos (0-255) viajan dentro del medio.
- Quitar un medio no borra su archivo, para poder deshacer. `collectGarbage()` lo borra al abrir un proyecto.
- Límites: sin decodificar audio por encima de 150 MB o 15 min. En ese caso un vídeo se da por «con audio» y no tiene onda.
- Un `hasAudio: false` significa que el navegador no pudo decodificar audio del archivo (sin pista, o códec de audio no soportado).
- Los códecs los decide el navegador. H.264/AAC va en Chrome, Edge y Safari. El Chromium de pruebas no los incluye.

## Línea de tiempo (`src/timeline`)

Tres capas. Las dos primeras son puras y se prueban en Node.

- `geometry.js`, `edit.js`: zoom, regla, onda; imán, recorte con límites y colocación sin solapes.
- `actions.js`: añadir medios, dividir en el cursor, duplicar, borrar, mover con flechas. Operan sobre el store.
- `timeline.js` + `timeline.css`: DOM y gestos. Lee el store y escribe solo con comandos.

Comportamiento:
- Un gesto (mover o recortar) es un solo comando al soltar, y por tanto un solo paso de historial. Durante el arrastre el clip se mueve con `transform`.
- Soltar sobre otro clip lo deja en el hueco libre más cercano. Nunca solapa.
- Un clip no pasa a una pista de otro tipo ni a una bloqueada.
- Imán de 8 px a bordes de clips, cursor e inicio, con una guía visible.
- Táctil: un clip sin seleccionar deja que el dedo desplace la línea. Toca para seleccionar, y entonces se arrastra y se recorta.
- Teclado: `S` dividir, `D` duplicar, `Supr` eliminar (con `Mayús`, cierra el hueco), `←` `→` mover un fotograma (con `Mayús`, un segundo), `+` `-` zoom, `Inicio` `Fin`, `Ctrl+Z` y `Ctrl+Mayús+Z`.
- Zoom con botones o Ctrl+rueda, anclado al puntero. No hay pellizco táctil todavía.
- `timeline.follow = true` hace que la vista siga al cursor. El reproductor (módulo 4) lo activará.
- `dev/timeline.html` es una página de desarrollo: importar medios, ponerlos en la línea y probar los gestos.

## Reglas del modelo

- Tiempo en segundos, con precisión de milisegundo (`snap`).
- Una pista admite ciertos tipos de clip: `video` (vídeo e imagen), `text`, `audio`.
- Los clips de una misma pista no se solapan. Para superponer, usa otra pista de vídeo (las superiores se dibujan encima).
- `in` es el punto de entrada en el medio de origen. El tramo consumido es `duration * speed`.
- Los medios binarios viven en el repositorio, no en el proyecto JSON.
- Para arrastres, manda `coalesce: 'drag:<id>'` en cada comando. Se fusionan en una entrada de historial.

## Comandos

`project/rename`, `project/settings`, `asset/add`, `asset/remove`, `track/add`, `track/update`, `track/reorder`, `track/remove`, `clip/add`, `clip/move`, `clip/trim`, `clip/split`, `clip/duplicate`, `clip/remove`, `clip/update`, `effect/add`, `effect/update`, `effect/remove`, `effect/reorder`.

## Tests

`npm test` (Node 20 o superior, sin dependencias).

`npm run test:browser` prueba biblioteca y línea de tiempo en Chromium real (importación, IndexedDB, ratón, teclado, táctil). Necesita `ffmpeg` y `playwright` global.

`npm start` sirve la carpeta en http://localhost:5173.
