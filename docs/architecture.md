# Arquitectura

App en el navegador, sin framework ni paso de build. Módulos ES. Los archivos del usuario no salen del dispositivo.

## Módulos

| # | Módulo | Estado |
|---|--------|--------|
| 1 | Núcleo: modelo, comandos, store, deshacer/rehacer, persistencia | hecho |
| 2 | Biblioteca: importar medios, miniaturas, metadatos | pendiente |
| 3 | Línea de tiempo | pendiente |
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
