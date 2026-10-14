import { EFFECT_TYPES, TRANSITION_IDS, foldEffects } from '../core/effects.js';
import { cropRect, drawText, layerGeometry, textLayout } from '../player/compose.js';
import { revealLines, textAnimation } from '../text/animation.js';
import { BLUR_FRAG, LAYER_FRAG, LAYER_VERT, QUAD_VERT, TRANSITION_FRAG } from './shaders.js';

/** Color '#rrggbb' a [r, g, b] en 0-1. */
export function parseColor(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

/**
 * Matriz 3x3 (columnas, para uniformMatrix3fv) que lleva el cuadrado unidad centrado (-0.5..0.5, y hacia arriba)
 * a coordenadas de recorte, para una capa colocada en píxeles lógicos (y hacia abajo) con giro y volteo.
 */
export function layerMatrix({ cx, cy, w, h, rotation }, flip, W, H) {
  const fx = flip?.h ? -1 : 1;
  const fy = flip?.v ? -1 : 1;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    (2 / W) * cos * w * fx, -(2 / H) * sin * w * fx, 0,
    (2 / W) * sin * h * fy, (2 / H) * cos * h * fy, 0,
    (2 / W) * cx - 1, 1 - (2 / H) * cy, 1,
  ];
}

export function isWebGlAvailable(doc = globalThis.document) {
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : doc.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch { return false; }
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

function program(gl, vert, frag, uniformNames) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Programa: ${gl.getProgramInfoLog(prog)}`);
  const uniforms = Object.fromEntries(uniformNames.map((n) => [n, gl.getUniformLocation(prog, n)]));
  return { prog, u: uniforms };
}

const MAX_TEXT_TEXTURES = 8;

/**
 * Renderizador WebGL de un fotograma: capas con efectos, recorte, volteo, texto y transiciones.
 * Recibe el mismo plan que el compositor 2D (`visualPlan`). Devuelve el lienzo con el resultado:
 * úsalo enseguida (drawImage o VideoFrame), antes de volver a dibujar.
 */
export function createGlRenderer({ doc = globalThis.document } = {}) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : Object.assign(doc.createElement('canvas'), { width: 2, height: 2 });
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false }) ?? canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) throw new Error('WebGL no disponible');
  let lost = false;
  canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); lost = true; });

  const effectUniforms = EFFECT_TYPES.map((t) => `u_${t}`);
  const layerProg = program(gl, LAYER_VERT, LAYER_FRAG, ['u_matrix', 'u_tex', 'u_uv', 'u_texel', 'u_opacity', 'u_aspect', ...effectUniforms]);
  const blurProg = program(gl, QUAD_VERT, BLUR_FRAG, ['u_tex', 'u_step']);
  const transProg = program(gl, QUAD_VERT, TRANSITION_FRAG, ['u_a', 'u_b', 'u_mode', 'u_p']);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const sourceTextures = new Map();
  let usedKeys = new Set();
  const bitmapCanvases = new WeakMap();
  const textTextures = new Map();
  let textCanvas = null;
  let size = { w: 2, h: 2 };
  let fbos = null;

  function newTexture() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function newTarget(w, h) {
    const tex = newTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex };
  }

  function disposeTargets() {
    if (!fbos) return;
    for (const t of Object.values(fbos)) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
    fbos = null;
  }

  function resize(w, h) {
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    size = { w, h };
    disposeTargets();
  }

  const targets = () => (fbos ??= { a: newTarget(size.w, size.h), b: newTarget(size.w, size.h), t1: newTarget(size.w, size.h), t2: newTarget(size.w, size.h) });

  function bindTarget(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, size.w, size.h);
  }
  function clear(target, color = [0, 0, 0, 0]) {
    bindTarget(target);
    gl.clearColor(...color);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Textura de un origen (vídeo, lienzo o bitmap). Los bitmaps pasan por un lienzo 2D: WebGL ignora para ellos el volteo y la premultiplicación. */
  function uploadSource(key, image) {
    usedKeys.add(key);
    let entry = sourceTextures.get(key);
    if (!entry) { entry = { tex: newTexture(), image: null }; sourceTextures.set(key, entry); }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    const isBitmap = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap;
    if (isBitmap) {
      if (entry.image === image) return entry.tex;
      let flat = bitmapCanvases.get(image);
      if (!flat) {
        flat = Object.assign(doc.createElement('canvas'), { width: image.width, height: image.height });
        flat.getContext('2d').drawImage(image, 0, 0);
        bitmapCanvases.set(image, flat);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flat);
      entry.image = image;
      return entry.tex;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return entry.tex;
  }

  /** Textura del texto sin movimiento: el desplazamiento y el zoom de las animaciones van por matriz. */
  function textTexture(clip, settings, scale, reveal, fontVersion) {
    const { text, transform } = clip;
    textCanvas ??= doc.createElement('canvas');
    textCanvas.width = size.w;
    textCanvas.height = size.h;
    const ctx = textCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const { lines } = textLayout(ctx, clip, settings.width);
    const visible = revealLines(lines, reveal).join('\n');
    const key = JSON.stringify([text, transform.x, transform.y, transform.scale, transform.rotation, settings.width, settings.height, size.w, size.h, fontVersion, visible.length]);
    const hit = textTextures.get(key);
    if (hit) return hit;
    drawText(ctx, clip, settings.width, settings.height, 1, { reveal });
    const tex = newTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
    textTextures.set(key, tex);
    if (textTextures.size > MAX_TEXT_TEXTURES) {
      const [oldKey, oldTex] = textTextures.entries().next().value;
      gl.deleteTexture(oldTex);
      textTextures.delete(oldKey);
    }
    return tex;
  }

  function drawQuad(target, setup) {
    bindTarget(target);
    setup();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function blurPass(from, to, step) {
    gl.useProgram(blurProg.prog);
    drawQuad(to, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, from.tex);
      gl.uniform1i(blurProg.u.u_tex, 0);
      gl.uniform2f(blurProg.u.u_step, step[0], step[1]);
    });
  }

  /** Dibuja una capa en `target` (null = lienzo). Devuelve false si su origen aún no está listo. */
  function drawLayer(target, layer, ctx) {
    const { clip } = layer;
    let { opacity } = layer;
    const { settings, getSource, scale } = ctx;
    const W = settings.width;
    const H = settings.height;
    let tex;
    let geometry;
    let uv = [0, 0, 1, 1];
    let texel = [1 / size.w, 1 / size.h];
    if (clip.kind === 'text') {
      const anim = textAnimation(clip, layer.time ?? clip.start);
      tex = textTexture(clip, settings, scale, anim.reveal, ctx.fontVersion);
      const px = W / 2 + clip.transform.x * W;
      const py = H / 2 + clip.transform.y * H;
      geometry = { cx: px + (W / 2 - px) * anim.scale + anim.dx * W, cy: py + (H / 2 - py) * anim.scale + anim.dy * H, w: W * anim.scale, h: H * anim.scale, rotation: 0 };
      opacity *= anim.opacity;
    } else {
      const source = getSource(clip);
      if (!source) return false;
      const key = clip.kind === 'image' ? `img:${clip.assetId}` : `clip:${clip.id}`;
      tex = uploadSource(key, source.image);
      const { sx, sy, sw, sh } = cropRect(source.width, source.height, clip.crop);
      uv = [sx / source.width, sy / source.height, sw / source.width, sh / source.height];
      texel = [1 / source.width, 1 / source.height];
      geometry = layerGeometry({ srcW: sw, srcH: sh, transform: clip.transform, fit: clip.fit }, W, H);
    }
    const fx = foldEffects(clip.effects);
    const blurPx = fx.blur * scale;
    const draw = (to) => {
      gl.useProgram(layerProg.prog);
      drawQuad(to, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        const u = layerProg.u;
        gl.uniform1i(u.u_tex, 0);
        gl.uniformMatrix3fv(u.u_matrix, false, layerMatrix(geometry, clip.kind === 'text' ? null : clip.flip, W, H));
        gl.uniform4f(u.u_uv, ...uv);
        gl.uniform2f(u.u_texel, ...texel);
        gl.uniform1f(u.u_opacity, opacity);
        gl.uniform1f(u.u_aspect, geometry.h / geometry.w);
        for (const type of EFFECT_TYPES) gl.uniform1f(u[`u_${type}`], type === 'blur' ? 0 : fx[type]);
      });
    };
    if (blurPx > 0.25) {
      const { a, b } = targets();
      clear(a);
      clear(b);
      draw(a);
      const step = blurPx / 2.5;
      blurPass(a, b, [step / size.w, 0]);
      blurPass(b, target, [0, step / size.h]);
    } else {
      draw(target);
    }
    return true;
  }

  function drawTransition(item, ctx) {
    const { t1, t2 } = targets();
    clear(t1);
    clear(t2);
    drawLayer(t1, item.outgoing, ctx);
    drawLayer(t2, item.incoming, ctx);
    gl.useProgram(transProg.prog);
    drawQuad(null, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t1.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, t2.tex);
      gl.uniform1i(transProg.u.u_a, 0);
      gl.uniform1i(transProg.u.u_b, 1);
      gl.uniform1f(transProg.u.u_mode, Math.max(0, TRANSITION_IDS.indexOf(item.type)));
      gl.uniform1f(transProg.u.u_p, item.progress);
    });
  }

  return {
    canvas,
    isLost: () => lost || gl.isContextLost(),
    /** Dibuja `plan` a `scale` veces el tamaño lógico del proyecto. */
    render(plan, settings, getSource, { scale = 1, fontVersion = 0 } = {}) {
      resize(Math.max(1, Math.round(settings.width * scale)), Math.max(1, Math.round(settings.height * scale)));
      clear(null, [...parseColor(settings.background), 1]);
      usedKeys = new Set();
      const ctx = { settings, getSource, scale: size.w / settings.width, fontVersion };
      for (const item of plan) {
        if (item.kind === 'transition') drawTransition(item, ctx);
        else drawLayer(null, item, ctx);
      }
      if (sourceTextures.size > 24) {
        for (const [key, { tex }] of sourceTextures) {
          if (!usedKeys.has(key)) { gl.deleteTexture(tex); sourceTextures.delete(key); }
        }
      }
      return canvas;
    },
    dispose() {
      disposeTargets();
      for (const { tex } of sourceTextures.values()) gl.deleteTexture(tex);
      for (const tex of textTextures.values()) gl.deleteTexture(tex);
      sourceTextures.clear();
      textTextures.clear();
    },
  };
}
