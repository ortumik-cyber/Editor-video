# Arquitectura

App en el navegador, sin framework ni paso de build. Módulos ES. Los archivos del usuario no salen del dispositivo.

## Módulos

| # | Módulo | Estado |
|---|--------|--------|
| 1 | Núcleo: modelo, comandos, store, deshacer/rehacer, persistencia | hecho |
| 2 | Biblioteca: importar medios, miniaturas, metadatos, onda de audio | hecho |
| 3 | Línea de tiempo: pistas, clips, arrastrar, recortar, dividir, zoom, cursor | hecho |
| 4 | Reproductor: composición en canvas, audio sincronizado, controles | hecho |
| 5 | Efectos, filtros, transiciones, recorte, volteo y giro | hecho |
| 6 | Texto, tipografías, animaciones, stickers, emoji y manipulación directa | hecho |
| 7 | Audio: sonido, separar audio, efectos, locución, mezcla y medidor | hecho |
| 8 | Exportación (WebCodecs + muxers): MP4/H.264, WebM/VP9 | hecho |
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

## Reproductor (`src/player`)

- `plan.js` (puro): qué se ve y qué suena en cada instante. Capas de abajo arriba, tiempo de origen con velocidad, fundidos, ganancia de audio (volumen x fundido x silencio de pista).
- `compose.js`: `composeFrame(ctx, ajustes, capas, getSource)`. No sabe de dónde vienen las imágenes: `getSource(clip)` devuelve `{ image, width, height }`. La vista previa le da un `<video>`; la exportación (módulo 8) le dará un `VideoFrame`. Así los dos se ven igual.
- `audio.js`: grafo de Web Audio. Cada elemento pasa por su ganancia hacia una salida con medidor de nivel (`player.getLevel()`). Permite volumen hasta 4x.
- `pool.js`: un `<video>`/`<audio>` por clip activo o que empieza en el próximo segundo. Descarta los que llevan 2,5 s sin uso. `seekTo` agrupa saltos seguidos: gana el último.
- `player.js`: reloj con `performance.now`. Los elementos lo siguen y se corrigen si se desvían más de 250 ms. Pausado, dibuja un fotograma fijo esperando a que cada vídeo llegue a su instante.
- `preview.js`: lienzo con la proporción del proyecto (unidades de contenedor), reproducir, pausar, ir al inicio, reloj `m:ss.d` y Espacio.

Unidades de la transformación de un clip: `x` e `y` son fracciones del ancho y alto del lienzo desde el centro; `scale` multiplica el tamaño tras el ajuste; `rotation` en grados; `opacity` de 0 a 1. `fit` es `contain` o `cover`. El fondo es `settings.background`.

La vista previa se dibuja a un máximo de 960 px de lado. El texto se dibuja con la fuente indicada y, si no está cargada, con la del sistema (las fuentes llegan con el módulo 6).


## Efectos y transiciones (`src/core/effects.js`, `src/render`, `src/effects`)

- `core/effects.js` (datos puros): 10 efectos de un solo valor (brillo, contraste, saturación, temperatura, tono, sepia, viñeta, desenfoque, nitidez, mosaico), 7 filtros y 8 transiciones. Un clip tiene a lo sumo un efecto de cada tipo; `foldEffects` los reúne para el renderizador.
- Comandos: `effect/set` (crea, actualiza y quita al volver al neutro; usa `effectType`, no `type`), `effect/preset` (con intensidad), `effect/clear`. En `clip/update`: `crop`, `flip` y `transition`, todos validados.
- `render/gl.js` + `render/shaders.js`: renderizador WebGL. Capas con efectos, recorte, volteo, giro, texto y transiciones. El desenfoque va en dos pasadas con buffers intermedios. Las imágenes pasan por un lienzo 2D antes de subirse a la GPU. Devuelve su lienzo para usarlo enseguida (`drawImage` o `VideoFrame`).
- Si WebGL no está o se pierde el contexto, el reproductor usa `composeFrame` (2D): recorte, volteo y transiciones como disolver, sin efectos de color.
- Fórmulas de color (rgb 0-1): saturación `mix(luma, rgb, 1 + s)`; temperatura `rgb * (1 + 0.2t, 1, 1 - 0.2t)`; brillo `rgb + 0.5b`; contraste `(rgb - 0.5)(1 + c) + 0.5`. El tono usa la matriz de `hue-rotate` de CSS y la sepia la de CSS `sepia`.
- Transiciones: van en el clip que entra. Están centradas en el corte con el clip anterior, que debe estar pegado y en la misma pista. La duración se limita a la de ambos clips. Antes del corte se usan fotogramas previos al punto de entrada del clip entrante, y después los posteriores al final del saliente. Si el archivo no tiene más material, se congela el primer o el último fotograma. El audio no se mezcla durante la transición.
- `effects/panel.js`: panel del clip seleccionado. Se construye una vez por clip y luego solo sincroniza valores. Un arrastre de deslizador es un solo paso de historial. Doble toque en el valor restablece.

## Texto, stickers y manipulación directa (`src/text`, `src/player/manipulate*.js`)

- `core/text.js` (datos puros): 10 tipografías con sus pesos, 9 animaciones y la validación del texto (`textError`). `clip/update` rechaza cualquier valor fuera de rango y no cambia nada.
- `assets/fonts`: subconjunto latino en WOFF2 (ñ, tildes, ¿ y ¡ incluidos) con sus licencias. `text/fonts.js` las carga con `FontFace`. El reproductor espera a las fuentes en los fotogramas fijos y las texturas de texto de WebGL llevan en su clave la versión de fuentes cargadas, así que no hay un instante con la fuente de repuesto.
- Si una fuente no tiene negrita, el peso se resuelve al más cercano (`resolveWeight`): no hay negrita falsa. El modelo guarda el peso resuelto, no la intención: pasar por una fuente sin negrita la quita.
- `text/animation.js`: `textAnimation(clip, t)` da opacidad, desplazamiento, escala y letras visibles. Los movimientos van por matriz en WebGL; solo la máquina de escribir regenera la textura. En la salida el movimiento se invierte.
- Un texto largo se parte en líneas; una palabra que no cabe se parte por caracteres.
- `text/stickers.js`: 12 stickers SVG propios, 32 emoji y 6 estilos de texto. Un sticker se rasteriza a PNG y se importa una vez como medio normal (hereda transformación, efectos y fundidos).
- Colocación (`timeline/actions.js`): un texto o superposición nuevo va al cursor, a la primera pista libre en ese tramo, y se crea una capa si no la hay. Las superposiciones nunca van a la pista base.
- Manipulación directa (`player/manipulate.js` puro + `manipulator.js` DOM): clic para seleccionar el elemento de más arriba bajo el puntero, arrastrar para mover (con imán al centro y guías), tirador de esquina para escalar y girar (imán a múltiplos de 90°, Mayús = pasos de 15°), pellizco con dos dedos. Cada gesto envía el comando en vivo con clave de fusión: un solo paso de historial. Doble clic en un texto enfoca su caja de edición. El equivalente accesible por teclado son los deslizadores del panel.
- Transformación válida: `x`, `y` en [-5, 5], `scale` en [0,01, 20], `opacity` en [0, 1], `rotation` finito.

## Audio (`src/audio`, `src/player/audio.js`)

- Cada elemento de vídeo o audio pasa por su ganancia en el grafo de Web Audio (permite volumen hasta 400 %). Una salida común lleva el medidor de nivel (`player.getLevel()`).
- Ganancia de un clip: volumen x fundido x mezcla de transición x silencio de pista. Panel de sonido: volumen, silenciar, fundidos de entrada y salida, velocidad y, en un vídeo con audio, **Separar audio** (un solo comando: crea el clip de audio y silencia el vídeo).
- **Silenciar pista** desde la barra de la línea de tiempo (botón o tecla M). La pista se atenúa.
- **Transiciones:** el audio del clip saliente y el del entrante se mezclan con potencia constante (`cos` y `sen` a lo largo de toda la ventana), así que no hay bache de volumen en el corte. Con señales idénticas y en fase la suma sube hasta 1,41 veces: la potencia constante es para señales distintas.
- `audio/sfx.js`: 9 efectos de sonido **sintetizados** (campanilla, pop, clic, aire, subida, bajada, moneda, error y latido). Originales, deterministas, mono a 44,1 kHz, con pico de 0,8 y sin chasquidos. Se codifican a WAV de 16 bits e importan como un medio normal.
- `audio/recorder.js`: locución con `MediaRecorder`. Graba mientras el vídeo avanza desde el cursor y al parar importa la grabación y la coloca donde empezó, en una pista de audio libre (o nueva). Errores con mensaje claro: permiso denegado, sin micrófono, micrófono en uso, sin soporte, grabación demasiado corta. Con altavoces la grabación recoge también el sonido del proyecto: lo recomendable son auriculares.
- Medidor de nivel de la barra de la vista previa: escala de -60 a 0 dB, sube al instante y baja poco a poco. Muestra el mezclador al reproducir y el micrófono al grabar.
- Un medio más corto que 0,1 s (un chasquido de 50 ms) se puede colocar entero, pero no más corto.

## Exportación (`src/export`, `vendor`)

- **Mismo código que la vista previa.** Cada fotograma se dibuja con `visualPlan` y el renderizador WebGL de siempre, a la resolución de salida, y se codifica con `VideoEncoder`. El audio se mezcla fuera de línea con `OfflineAudioContext` usando la **misma** función `mediaPlan` (volumen, fundidos, silencio de pista, mezcla de transición), muestreada cada 5 ms. Por eso lo exportado se ve y suena como lo que se editó.
- **Formato por soporte real** (`formats.js`): MP4 con H.264 y AAC si el navegador los codifica; si no, WebM con VP9 u VP8 y Opus. `mp4-vp9` (MP4 con VP9 y Opus) solo sale si se pide. El panel anuncia el formato antes de exportar. Si no hay ninguno, un error claro.
- **Velocidad sin cambiar el tono** (`audio/stretch.js`, WSOLA): en la vista previa el navegador conserva el tono a 2×; exportar con `playbackRate` lo subiría una octava. El estiramiento se hace una vez por medio y velocidad.
- **Fotogramas de origen:** se buscan en un `<video>` con `currentTime` exacto, el mismo decodificador que la vista previa. Es más lento que el tiempo real. Los vídeos se descartan del pool al dejar de usarse.
- Sin audio audible, el archivo no lleva pista de audio. Marcas de tiempo de 1/fps exactas. Un fotograma clave cada 2 s. El archivo se arma en memoria.
- Se puede cancelar (`AbortSignal`): se cierran los codificadores y se liberan el renderizador, el pool y las imágenes. El proyecto es inmutable y se congela al empezar: se puede seguir editando mientras exporta.
- Tamaños: el lado corto manda (480, 720, 1080) y ambos lados son pares. Tasa de bits por píxel y fotograma: 0,05, 0,09 o 0,16, entre 300 kbps y 40 Mbps.
- Descargar (`<a download>`) y compartir con el menú del sistema (`navigator.share` con archivos) cuando existe.
- `vendor/`: `mp4-muxer` 5.2.2 y `webm-muxer` 5.1.4 (MIT), copias sin modificar y revisadas (sin red ni `eval`).

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

`npm run test:browser` prueba biblioteca, línea de tiempo, reproductor, efectos y panel en Chromium real (importación, IndexedDB, ratón, teclado, táctil, píxeles del lienzo). Necesita `ffmpeg` y `playwright` global.

`npm start` sirve la carpeta en http://localhost:5173.
