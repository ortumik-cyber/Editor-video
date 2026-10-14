// GLSL ES 1.00 (válido en WebGL 1 y 2). Todo trabaja en alfa premultiplicado.

export const LAYER_VERT = `
attribute vec2 a_pos;
uniform mat3 u_matrix;
varying vec2 v_local;
void main() {
  v_local = a_pos + 0.5;
  gl_Position = vec4((u_matrix * vec3(a_pos, 1.0)).xy, 0.0, 1.0);
}`;

/**
 * Capa con efectos. Orden: mosaico, nitidez, tono, saturación, temperatura, brillo, contraste,
 * sepia, viñeta. Fórmulas (rgb en 0-1):
 *   saturación: mix(luma, rgb, 1 + s)          temperatura: rgb * (1 + 0.2t, 1, 1 - 0.2t)
 *   brillo: rgb + 0.5 b                         contraste: (rgb - 0.5)(1 + c) + 0.5
 */
export const LAYER_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_local;
uniform sampler2D u_tex;
uniform vec4 u_uv;
uniform vec2 u_texel;
uniform float u_opacity, u_aspect;
uniform float u_brightness, u_contrast, u_saturation, u_temperature, u_hue, u_sepia, u_vignette, u_sharpen, u_pixelate;

void main() {
  vec2 local = v_local;
  if (u_pixelate > 0.0) {
    float n = mix(240.0, 10.0, u_pixelate);
    vec2 cells = vec2(n, n * u_aspect);
    local = (floor(local * cells) + 0.5) / cells;
  }
  vec2 uv = vec2(u_uv.x + local.x * u_uv.z, u_uv.y + (1.0 - local.y) * u_uv.w);
  vec4 c = texture2D(u_tex, uv);
  if (u_sharpen > 0.0) {
    vec4 n = texture2D(u_tex, uv + vec2(u_texel.x, 0.0)) + texture2D(u_tex, uv - vec2(u_texel.x, 0.0))
           + texture2D(u_tex, uv + vec2(0.0, u_texel.y)) + texture2D(u_tex, uv - vec2(0.0, u_texel.y));
    c = clamp(c + (c * 4.0 - n) * u_sharpen, 0.0, 1.0);
    c.rgb = min(c.rgb, vec3(c.a));
  }
  float a = c.a;
  vec3 rgb = a > 0.0 ? c.rgb / a : vec3(0.0);

  if (u_hue != 0.0) {
    float h = radians(u_hue), cs = cos(h), sn = sin(h);
    mat3 m = mat3(
      0.213 + cs * 0.787 - sn * 0.213, 0.213 - cs * 0.213 + sn * 0.143, 0.213 - cs * 0.213 - sn * 0.787,
      0.715 - cs * 0.715 - sn * 0.715, 0.715 + cs * 0.285 + sn * 0.140, 0.715 - cs * 0.715 + sn * 0.715,
      0.072 - cs * 0.072 + sn * 0.928, 0.072 - cs * 0.072 - sn * 0.283, 0.072 + cs * 0.928 + sn * 0.072);
    rgb = m * rgb;
  }
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(luma), rgb, 1.0 + u_saturation);
  rgb *= vec3(1.0 + 0.2 * u_temperature, 1.0, 1.0 - 0.2 * u_temperature);
  rgb += 0.5 * u_brightness;
  rgb = (rgb - 0.5) * (1.0 + u_contrast) + 0.5;
  rgb = clamp(rgb, 0.0, 1.0);
  if (u_sepia > 0.0) {
    mat3 s = mat3(0.393, 0.349, 0.272, 0.769, 0.686, 0.534, 0.189, 0.168, 0.131);
    rgb = mix(rgb, clamp(s * rgb, 0.0, 1.0), u_sepia);
  }
  if (u_vignette > 0.0) {
    float d = length((v_local - 0.5) * 2.0) / 1.4142;
    rgb *= 1.0 - u_vignette * smoothstep(0.4, 1.0, d);
  }
  float outA = a * u_opacity;
  gl_FragColor = vec4(rgb * outA, outA);
}`;

export const QUAD_VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos + 0.5;
  gl_Position = vec4(a_pos * 2.0, 0.0, 1.0);
}`;

/** Gaussiana separable de 13 muestras. u_step es el paso entre muestras en coordenadas de textura. */
export const BLUR_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_step;
void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -6; i <= 6; i++) {
    float x = float(i);
    float w = exp(-0.5 * x * x / 6.25);
    sum += texture2D(u_tex, v_uv + u_step * x) * w;
    total += w;
  }
  gl_FragColor = sum / total;
}`;

/** Mezcla la capa saliente (A) y la entrante (B). u_mode: índice de TRANSITIONS; p: progreso 0-1. */
export const TRANSITION_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_a, u_b;
uniform float u_mode, u_p;
vec4 pick(sampler2D t, vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(t, uv);
}
void main() {
  vec2 uv = v_uv;
  float p = u_p;
  vec4 a, b;
  if (u_mode < 0.5) {                       // dissolve
    gl_FragColor = texture2D(u_a, uv) * (1.0 - p) + texture2D(u_b, uv) * p;
  } else if (u_mode < 1.5) {                // dip
    gl_FragColor = p < 0.5 ? texture2D(u_a, uv) * (1.0 - 2.0 * p) : texture2D(u_b, uv) * (2.0 * p - 1.0);
  } else if (u_mode < 2.5) {                // slide-left
    a = pick(u_a, uv + vec2(p, 0.0)); b = pick(u_b, uv + vec2(p - 1.0, 0.0));
    gl_FragColor = a + b * (1.0 - a.a);
  } else if (u_mode < 3.5) {                // slide-right
    a = pick(u_a, uv - vec2(p, 0.0)); b = pick(u_b, uv + vec2(1.0 - p, 0.0));
    gl_FragColor = a + b * (1.0 - a.a);
  } else if (u_mode < 4.5) {                // slide-up
    a = pick(u_a, uv - vec2(0.0, p)); b = pick(u_b, uv + vec2(0.0, 1.0 - p));
    gl_FragColor = a + b * (1.0 - a.a);
  } else if (u_mode < 5.5) {                // slide-down
    a = pick(u_a, uv + vec2(0.0, p)); b = pick(u_b, uv + vec2(0.0, p - 1.0));
    gl_FragColor = a + b * (1.0 - a.a);
  } else if (u_mode < 6.5) {                // wipe (de izquierda a derecha, borde suave)
    float edge = p * 1.1;
    float m = 1.0 - smoothstep(edge - 0.1, edge, uv.x);
    gl_FragColor = texture2D(u_a, uv) * (1.0 - m) + texture2D(u_b, uv) * m;
  } else {                                  // zoom
    vec2 c = vec2(0.5);
    a = pick(u_a, (uv - c) / (1.0 + 0.5 * p) + c);
    b = pick(u_b, (uv - c) / (1.5 - 0.5 * p) + c);
    gl_FragColor = a * (1.0 - p) + b * p;
  }
}`;
