/**
 * Pure pixel operations on RGBA buffers.
 *
 * Everything here is DOM-free so it runs in a Web Worker and in unit tests.
 * Colour adjustments intentionally match the CSS filter definitions
 * (grayscale / brightness / contrast / invert) so the live canvas preview,
 * which uses `ctx.filter`, shows exactly what Apply will produce.
 */

export interface Px {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Shape = 'rect' | 'ellipse';

export function createPx(width: number, height: number): Px {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function clonePx(px: Px): Px {
  return { width: px.width, height: px.height, data: px.data.slice() };
}

/** Integer rect clamped to the image; may be empty (w or h = 0). */
export function clampRect(r: Rect, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.min(width, Math.floor(r.x)));
  const y0 = Math.max(0, Math.min(height, Math.floor(r.y)));
  const x1 = Math.max(0, Math.min(width, Math.ceil(r.x + r.w)));
  const y1 = Math.max(0, Math.min(height, Math.ceil(r.y + r.h)));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function fullRect(px: Px): Rect {
  return { x: 0, y: 0, w: px.width, h: px.height };
}

/** Copy a rectangular region into a new buffer. `r` must already be clamped. */
export function extract(px: Px, r: Rect): Px {
  const out = createPx(r.w, r.h);
  const rowBytes = r.w * 4;
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * px.width + r.x) * 4;
    out.data.set(px.data.subarray(src, src + rowBytes), y * rowBytes);
  }
  return out;
}

/** Write `patch` into `px` at (x, y). The patch must fit inside the image. */
export function putRegion(px: Px, patch: Px, x: number, y: number): void {
  const rowBytes = patch.width * 4;
  for (let row = 0; row < patch.height; row++) {
    const dst = ((y + row) * px.width + x) * 4;
    px.data.set(patch.data.subarray(row * rowBytes, (row + 1) * rowBytes), dst);
  }
}

/**
 * Per-pixel mask test for a shape occupying the whole of a w×h box.
 * Returns a function (x, y) -> inside, in box-local coordinates.
 */
function shapeTest(shape: Shape, w: number, h: number): (x: number, y: number) => boolean {
  if (shape === 'rect') return () => true;
  const rx = w / 2;
  const ry = h / 2;
  return (x, y) => {
    const dx = (x + 0.5 - rx) / rx;
    const dy = (y + 0.5 - ry) / ry;
    return dx * dx + dy * dy <= 1;
  };
}

/**
 * Copy pixels of `src` (same size as region `r`) into `dst` at `r`, but only
 * where they fall inside `shape`.
 */
export function blendShape(dst: Px, src: Px, r: Rect, shape: Shape): void {
  if (shape === 'rect') {
    putRegion(dst, src, r.x, r.y);
    return;
  }
  const inside = shapeTest(shape, r.w, r.h);
  const d = dst.data;
  const s = src.data;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (!inside(x, y)) continue;
      const si = (y * r.w + x) * 4;
      const di = ((r.y + y) * dst.width + r.x + x) * 4;
      d[di] = s[si];
      d[di + 1] = s[si + 1];
      d[di + 2] = s[si + 2];
      d[di + 3] = s[si + 3];
    }
  }
}

/** Apply a per-pixel colour function inside a (clamped) region and shape. */
function mapPixels(
  px: Px,
  region: Rect,
  shape: Shape,
  fn: (d: Uint8ClampedArray, i: number) => void,
): void {
  const r = clampRect(region, px.width, px.height);
  const inside = shapeTest(shape, r.w, r.h);
  const d = px.data;
  for (let y = 0; y < r.h; y++) {
    let i = ((r.y + y) * px.width + r.x) * 4;
    for (let x = 0; x < r.w; x++, i += 4) {
      if (inside(x, y)) fn(d, i);
    }
  }
}

/** CSS `grayscale(1)` (Rec. 709 luma). In place. */
export function grayscale(px: Px, region: Rect = fullRect(px), shape: Shape = 'rect'): void {
  mapPixels(px, region, shape, (d, i) => {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = l;
  });
}

/** CSS `invert(1)`. In place. */
export function invert(px: Px, region: Rect = fullRect(px), shape: Shape = 'rect'): void {
  mapPixels(px, region, shape, (d, i) => {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  });
}

/**
 * CSS `brightness(b) contrast(c)`, applied in that order. 1 = unchanged.
 * Uses a lookup table, so it costs one array read per channel. In place.
 */
export function brightnessContrast(
  px: Px,
  brightness: number,
  contrast: number,
  region: Rect = fullRect(px),
  shape: Shape = 'rect',
): void {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const b = v * brightness;
    lut[v] = (b - 127.5) * contrast + 127.5;
  }
  mapPixels(px, region, shape, (d, i) => {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  });
}

/** Fill a region/shape with a solid RGBA colour. In place. */
export function fill(
  px: Px,
  region: Rect,
  shape: Shape,
  rgba: [number, number, number, number],
): void {
  const [r, g, b, a] = rgba;
  mapPixels(px, region, shape, (d, i) => {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  });
}

/** Pixelate a region/shape with square blocks of `block` px, aligned to the region. In place. */
export function pixelate(px: Px, region: Rect, shape: Shape, block: number): void {
  const r = clampRect(region, px.width, px.height);
  if (r.w === 0 || r.h === 0) return;
  const size = Math.max(1, Math.round(block));
  const work = extract(px, r);
  const d = work.data;
  for (let by = 0; by < r.h; by += size) {
    const bh = Math.min(size, r.h - by);
    for (let bx = 0; bx < r.w; bx += size) {
      const bw = Math.min(size, r.w - bx);
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let y = by; y < by + bh; y++) {
        let i = (y * r.w + bx) * 4;
        for (let x = 0; x < bw; x++, i += 4) {
          sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sa += d[i + 3];
        }
      }
      const n = bw * bh;
      const cr = sr / n, cg = sg / n, cb = sb / n, ca = sa / n;
      for (let y = by; y < by + bh; y++) {
        let i = (y * r.w + bx) * 4;
        for (let x = 0; x < bw; x++, i += 4) {
          d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = ca;
        }
      }
    }
  }
  blendShape(px, work, r, shape);
}

/** Box sizes whose triple application approximates a Gaussian of `sigma`. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

/** One horizontal box-blur pass of half-width `r` with clamped edges. */
function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const div = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let c = 0; c < 4; c++) {
      const first = src[row + c];
      const last = src[row + (w - 1) * 4 + c];
      let acc = first * r;
      for (let x = 0; x < r; x++) acc += src[row + Math.min(x, w - 1) * 4 + c];
      for (let x = 0; x < w; x++) {
        const add = x + r < w ? src[row + (x + r) * 4 + c] : last;
        acc += add;
        dst[row + x * 4 + c] = acc / div;
        const sub = x - r >= 0 ? src[row + (x - r) * 4 + c] : first;
        acc -= sub;
      }
    }
  }
}

/** One vertical box-blur pass of half-width `r` with clamped edges. */
function boxBlurV(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const div = 2 * r + 1;
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      const col = x * 4 + c;
      const first = src[col];
      const last = src[(h - 1) * stride + col];
      let acc = first * r;
      for (let y = 0; y < r; y++) acc += src[Math.min(y, h - 1) * stride + col];
      for (let y = 0; y < h; y++) {
        const add = y + r < h ? src[(y + r) * stride + col] : last;
        acc += add;
        dst[y * stride + col] = acc / div;
        const sub = y - r >= 0 ? src[(y - r) * stride + col] : first;
        acc -= sub;
      }
    }
  }
}

/** Gaussian blur (3-pass box approximation) of a whole buffer. In place. */
export function blurBuffer(px: Px, radius: number): void {
  if (radius <= 0 || px.width === 0 || px.height === 0) return;
  // Treat "radius" like CSS blur(): it is the Gaussian standard deviation.
  const boxes = boxesForGauss(radius);
  const tmp = new Uint8ClampedArray(px.data.length);
  for (const size of boxes) {
    const r = (size - 1) / 2;
    boxBlurH(px.data, tmp, px.width, px.height, r);
    boxBlurV(tmp, px.data, px.width, px.height, r);
  }
}

/**
 * Gaussian-blur a region/shape. Pixels just outside the region are used as
 * blur input so the edge of the region blends naturally, but only pixels
 * inside the shape are changed. In place.
 */
export function blurRegion(px: Px, region: Rect, shape: Shape, radius: number): void {
  const r = clampRect(region, px.width, px.height);
  if (r.w === 0 || r.h === 0 || radius <= 0) return;
  const pad = Math.ceil(radius * 3);
  const padded = clampRect({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, px.width, px.height);
  const work = extract(px, padded);
  blurBuffer(work, radius);
  const inner = extract(work, { x: r.x - padded.x, y: r.y - padded.y, w: r.w, h: r.h });
  blendShape(px, inner, r, shape);
}

/** New buffer containing the (clamped) rect. */
export function crop(px: Px, rect: Rect): Px {
  const r = clampRect(rect, px.width, px.height);
  return extract(px, r);
}

/** Rotate 90° clockwise (cw = true) or counter-clockwise. Returns a new buffer. */
export function rotate90(px: Px, cw: boolean): Px {
  const { width: w, height: h } = px;
  const out = createPx(h, w);
  const s = new Uint32Array(px.data.buffer, px.data.byteOffset, w * h);
  const d = new Uint32Array(out.data.buffer, 0, w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = cw ? h - 1 - y : y;
      const ny = cw ? x : w - 1 - x;
      d[ny * h + nx] = s[y * w + x];
    }
  }
  return out;
}

/** Mirror horizontally ('h') or vertically ('v'). In place. */
export function flip(px: Px, axis: 'h' | 'v'): void {
  const { width: w, height: h } = px;
  const s = new Uint32Array(px.data.buffer, px.data.byteOffset, w * h);
  if (axis === 'h') {
    for (let y = 0; y < h; y++) s.subarray(y * w, (y + 1) * w).reverse();
  } else {
    const tmp = new Uint32Array(w);
    for (let y = 0; y < h >> 1; y++) {
      const a = s.subarray(y * w, (y + 1) * w);
      const b = s.subarray((h - 1 - y) * w, (h - y) * w);
      tmp.set(a);
      a.set(b);
      b.set(tmp);
    }
  }
}

// ---------------------------------------------------------------------------
// Lanczos-3 resampling
// ---------------------------------------------------------------------------

function sinc(x: number): number {
  if (x === 0) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
}

function lanczos(x: number, a: number): number {
  if (x <= -a || x >= a) return 0;
  return sinc(x) * sinc(x / a);
}

interface Contrib {
  start: Int32Array; // first source index per output index
  count: Int32Array; // number of taps per output index
  weights: Float32Array; // flattened, `maxTaps` per output index
  maxTaps: number;
}

/** Precompute normalized filter taps for one axis. */
function contributions(srcSize: number, dstSize: number, a = 3): Contrib {
  const scale = dstSize / srcSize;
  const stretch = scale < 1 ? 1 / scale : 1; // widen the filter when shrinking
  const support = a * stretch;
  const maxTaps = Math.ceil(support * 2) + 1;
  const start = new Int32Array(dstSize);
  const count = new Int32Array(dstSize);
  const weights = new Float32Array(dstSize * maxTaps);
  for (let i = 0; i < dstSize; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const lo = Math.max(0, Math.ceil(center - support));
    const hi = Math.min(srcSize - 1, Math.floor(center + support));
    let sum = 0;
    let n = 0;
    for (let j = lo; j <= hi && n < maxTaps; j++, n++) {
      const wgt = lanczos((j - center) / stretch, a);
      weights[i * maxTaps + n] = wgt;
      sum += wgt;
    }
    if (sum !== 0) for (let k = 0; k < n; k++) weights[i * maxTaps + k] /= sum;
    start[i] = lo;
    count[i] = n;
  }
  return { start, count, weights, maxTaps };
}

function hasAlpha(px: Px): boolean {
  const d = px.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
  return false;
}

/**
 * High-quality Lanczos-3 resize to `dw × dh`. Alpha is premultiplied during
 * filtering so transparent edges don't produce dark fringes. Returns a new buffer.
 */
export function resizeLanczos(px: Px, dw: number, dh: number): Px {
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  const { width: sw, height: sh } = px;
  if (dw === sw && dh === sh) return clonePx(px);

  const alpha = hasAlpha(px);
  const src = px.data;
  if (alpha) {
    // Premultiply into Float32 to avoid 8-bit rounding of dark, transparent pixels.
    const f = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3] / 255;
      f[i] = src[i] * a; f[i + 1] = src[i + 1] * a; f[i + 2] = src[i + 2] * a; f[i + 3] = src[i + 3];
    }
    return resizeFloat(f, sw, sh, dw, dh, true);
  }
  return resizeFloat(src, sw, sh, dw, dh, false);
}

function resizeFloat(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  premultiplied: boolean,
): Px {
  const cx = contributions(sw, dw);
  const cy = contributions(sh, dh);

  // Horizontal pass: sw×sh -> dw×sh. Float intermediate preserves Lanczos lobes.
  const mid = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const srow = y * sw * 4;
    const mrow = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      const s0 = cx.start[x];
      const n = cx.count[x];
      const wo = x * cx.maxTaps;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < n; k++) {
        const wgt = cx.weights[wo + k];
        const i = srow + (s0 + k) * 4;
        r += src[i] * wgt; g += src[i + 1] * wgt; b += src[i + 2] * wgt; a += src[i + 3] * wgt;
      }
      const m = mrow + x * 4;
      mid[m] = r; mid[m + 1] = g; mid[m + 2] = b; mid[m + 3] = a;
    }
  }

  // Vertical pass: dw×sh -> dw×dh.
  const out = createPx(dw, dh);
  const d = out.data;
  const stride = dw * 4;
  for (let y = 0; y < dh; y++) {
    const s0 = cy.start[y];
    const n = cy.count[y];
    const wo = y * cy.maxTaps;
    const orow = y * stride;
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const col = x * 4;
      for (let k = 0; k < n; k++) {
        const wgt = cy.weights[wo + k];
        const i = (s0 + k) * stride + col;
        r += mid[i] * wgt; g += mid[i + 1] * wgt; b += mid[i + 2] * wgt; a += mid[i + 3] * wgt;
      }
      const o = orow + col;
      if (premultiplied) {
        const af = a / 255;
        if (af > 0) {
          d[o] = r / af; d[o + 1] = g / af; d[o + 2] = b / af;
        } else {
          d[o] = d[o + 1] = d[o + 2] = 0;
        }
        d[o + 3] = a;
      } else {
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
      }
    }
  }
  return out;
}

/** Composite onto an opaque background colour (used before JPEG export). In place. */
export function flatten(px: Px, rgb: [number, number, number]): void {
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a === 1) continue;
    d[i] = d[i] * a + rgb[0] * (1 - a);
    d[i + 1] = d[i + 1] * a + rgb[1] * (1 - a);
    d[i + 2] = d[i + 2] * a + rgb[2] * (1 - a);
    d[i + 3] = 255;
  }
}
