import { newId } from './ids.js';

export const SCHEMA_VERSION = 1;
export const EPS = 1e-6;
export const MIN_CLIP_DURATION = 0.1;
export const FPS_OPTIONS = Object.freeze([24, 25, 30, 50, 60]);

export const ASPECTS = Object.freeze({
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
});

export const TRACK_KINDS = Object.freeze(['video', 'text', 'audio']);
export const CLIP_KINDS_BY_TRACK = Object.freeze({
  video: ['video', 'image'],
  text: ['text'],
  audio: ['audio'],
});
export const MEDIA_CLIP_KINDS = Object.freeze(['video', 'audio']);

/** Precisión de milisegundo: evita acumular error de coma flotante al cortar y mover. */
export const snap = (seconds) => Math.round(seconds * 1000) / 1000;

export const defaultTransform = () => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });

export const defaultText = () => ({
  content: 'Texto',
  font: 'Inter',
  size: 64,
  weight: 700,
  color: '#FFFFFF',
  align: 'center',
  background: null,
  stroke: null,
  shadow: true,
  animIn: 'none',
  animOut: 'none',
});

export function createTrack({ kind, name } = {}) {
  if (!TRACK_KINDS.includes(kind)) throw new TypeError(`Tipo de pista inválido: ${kind}`);
  return { id: newId('trk'), kind, name: name ?? kind, muted: false, locked: false, clipIds: [] };
}

/** `peaks`: picos de onda 0-255 (audio y vídeo con sonido). `hasThumb`: hay miniatura en el repositorio. */
export function createAsset({ kind, name, duration = 0, width = 0, height = 0, hasAudio = false, mime = '', size = 0, peaks = null, hasThumb = false, id }) {
  if (!['video', 'image', 'audio'].includes(kind)) throw new TypeError(`Tipo de medio inválido: ${kind}`);
  return { id: id ?? newId('ast'), kind, name, duration: snap(duration), width, height, hasAudio, mime, size, peaks, hasThumb };
}

const DEFAULT_DURATION = { image: 5, text: 3 };

export function createClip({ trackId, kind, assetId = null, start = 0, duration, in: inPoint = 0, text, id }) {
  const dur = duration ?? DEFAULT_DURATION[kind];
  if (dur === undefined) throw new TypeError('Falta duration');
  return {
    id: id ?? newId('clp'),
    trackId,
    kind,
    assetId,
    start: snap(start),
    duration: snap(dur),
    in: snap(inPoint),
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: defaultTransform(),
    effects: [],
    transition: null,
    text: kind === 'text' ? { ...defaultText(), ...text } : null,
  };
}

export function createProject({ name = 'Proyecto sin título', aspect = '9:16', fps = 30, id } = {}) {
  const size = ASPECTS[aspect];
  if (!size) throw new TypeError(`Formato inválido: ${aspect}`);
  const tracks = [
    createTrack({ kind: 'video', name: 'Vídeo' }),
    createTrack({ kind: 'text', name: 'Texto' }),
    createTrack({ kind: 'audio', name: 'Música' }),
  ];
  return {
    version: SCHEMA_VERSION,
    id: id ?? newId('prj'),
    name,
    settings: { aspect, width: size.width, height: size.height, fps },
    assets: {},
    tracks,
    clips: {},
  };
}
