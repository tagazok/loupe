import { describe, expect, it } from 'vitest';
import {
  blurRegion,
  brightnessContrast,
  clampRect,
  createPx,
  crop,
  extract,
  fill,
  flatten,
  flip,
  grayscale,
  invert,
  pixelate,
  putRegion,
  resizeLanczos,
  rotate90,
  type Px,
} from '../src/core/pixels';

/** Build a buffer where pixel (x, y) = [x, y, x + y, 255] (mod 256). */
function gradient(w: number, h: number): Px {
  const px = createPx(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px.data.set([x & 255, y & 255, (x + y) & 255, 255], i);
    }
  return px;
}

function solid(w: number, h: number, rgba: number[]): Px {
  const px = createPx(w, h);
  for (let i = 0; i < px.data.length; i += 4) px.data.set(rgba, i);
  return px;
}

const at = (px: Px, x: number, y: number) => Array.from(px.data.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 4));

describe('rect helpers', () => {
  it('clamps to the image and floors/ceils edges', () => {
    expect(clampRect({ x: -5, y: 2.4, w: 20, h: 3.2 }, 10, 10)).toEqual({ x: 0, y: 2, w: 10, h: 4 });
    expect(clampRect({ x: 20, y: 20, w: 5, h: 5 }, 10, 10)).toEqual({ x: 10, y: 10, w: 0, h: 0 });
  });

  it('extract + putRegion round-trip', () => {
    const px = gradient(8, 6);
    const patch = extract(px, { x: 2, y: 1, w: 3, h: 2 });
    expect(at(patch, 0, 0)).toEqual(at(px, 2, 1));
    const target = createPx(8, 6);
    putRegion(target, patch, 2, 1);
    expect(at(target, 4, 2)).toEqual(at(px, 4, 2));
    expect(at(target, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('colour adjustments', () => {
  it('grayscale uses Rec.709 luma like CSS grayscale(1)', () => {
    const px = solid(2, 2, [255, 0, 0, 255]);
    grayscale(px);
    expect(at(px, 0, 0)).toEqual([54, 54, 54, 255]);
  });

  it('grayscale only touches pixels inside an ellipse', () => {
    const px = solid(10, 10, [255, 0, 0, 255]);
    grayscale(px, { x: 0, y: 0, w: 10, h: 10 }, 'ellipse');
    expect(at(px, 5, 5)).toEqual([54, 54, 54, 255]); // centre
    expect(at(px, 0, 0)).toEqual([255, 0, 0, 255]); // corner is outside the ellipse
  });

  it('invert flips RGB, keeps alpha', () => {
    const px = solid(1, 1, [10, 20, 30, 128]);
    invert(px);
    expect(at(px, 0, 0)).toEqual([245, 235, 225, 128]);
  });

  it('brightness/contrast at 1/1 is identity, brightness 2 doubles', () => {
    const px = gradient(16, 16);
    const before = px.data.slice();
    brightnessContrast(px, 1, 1);
    expect(px.data).toEqual(before);
    const p2 = solid(1, 1, [50, 100, 200, 255]);
    brightnessContrast(p2, 2, 1);
    expect(at(p2, 0, 0)).toEqual([100, 200, 255, 255]);
  });

  it('contrast 0 collapses to mid grey', () => {
    const px = solid(1, 1, [0, 255, 40, 255]);
    brightnessContrast(px, 1, 0);
    expect(at(px, 0, 0).slice(0, 3).every((v) => v === 128 || v === 127)).toBe(true);
  });
});

describe('region effects', () => {
  it('fill paints only the region', () => {
    const px = solid(4, 4, [0, 0, 0, 255]);
    fill(px, { x: 1, y: 1, w: 2, h: 2 }, 'rect', [255, 255, 255, 255]);
    expect(at(px, 1, 1)).toEqual([255, 255, 255, 255]);
    expect(at(px, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(px, 3, 3)).toEqual([0, 0, 0, 255]);
  });

  it('pixelate averages each block', () => {
    const px = createPx(4, 2);
    // left block: black + white columns -> grey; right block: all red.
    px.data.set([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255], 0);
    px.data.set([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255], 16);
    pixelate(px, { x: 0, y: 0, w: 4, h: 2 }, 'rect', 2);
    expect(at(px, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(at(px, 1, 1)).toEqual([128, 128, 128, 255]);
    expect(at(px, 3, 0)).toEqual([255, 0, 0, 255]);
  });

  it('blur keeps a solid colour unchanged and stays inside the region', () => {
    const px = solid(20, 20, [90, 90, 90, 255]);
    blurRegion(px, { x: 0, y: 0, w: 20, h: 20 }, 'rect', 4);
    expect(at(px, 10, 10)).toEqual([90, 90, 90, 255]);

    // Black left half / white right half; blur only the top rows.
    const edge = createPx(20, 20);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) edge.data.set(x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * 20 + x) * 4);
    blurRegion(edge, { x: 0, y: 0, w: 20, h: 5 }, 'rect', 3);
    const blurred = at(edge, 9, 2)[0];
    expect(blurred).toBeGreaterThan(40);
    expect(blurred).toBeLessThan(215);
    expect(at(edge, 9, 10)).toEqual([0, 0, 0, 255]); // outside the region: untouched
  });

  it('blur is symmetric around a step edge', () => {
    const edge = createPx(40, 1);
    for (let x = 0; x < 40; x++) edge.data.set(x < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255], x * 4);
    blurRegion(edge, { x: 0, y: 0, w: 40, h: 1 }, 'rect', 3);
    const left = at(edge, 19, 0)[0];
    const right = at(edge, 20, 0)[0];
    expect(Math.abs(left + right - 255)).toBeLessThanOrEqual(2);
  });
});

describe('geometry', () => {
  it('crop returns the clamped sub-rectangle', () => {
    const px = gradient(10, 8);
    const out = crop(px, { x: 7, y: 6, w: 10, h: 10 });
    expect([out.width, out.height]).toEqual([3, 2]);
    expect(at(out, 0, 0)).toEqual(at(px, 7, 6));
  });

  it('rotate90 cw then ccw is identity, and maps corners correctly', () => {
    const px = gradient(5, 3);
    const cw = rotate90(px, true);
    expect([cw.width, cw.height]).toEqual([3, 5]);
    // top-left goes to top-right when rotating clockwise
    expect(at(cw, 2, 0)).toEqual(at(px, 0, 0));
    const back = rotate90(cw, false);
    expect(back.data).toEqual(px.data);
  });

  it('flip h/v twice is identity', () => {
    const px = gradient(7, 5);
    const orig = px.data.slice();
    flip(px, 'h');
    expect(at(px, 0, 0)).toEqual(Array.from(orig.subarray(6 * 4, 6 * 4 + 4)));
    flip(px, 'h');
    flip(px, 'v');
    flip(px, 'v');
    expect(px.data).toEqual(orig);
  });
});

describe('resizeLanczos', () => {
  it('produces the requested size and preserves a solid colour', () => {
    const px = solid(100, 60, [12, 200, 77, 255]);
    const down = resizeLanczos(px, 33, 20);
    expect([down.width, down.height]).toEqual([33, 20]);
    expect(at(down, 16, 10)).toEqual([12, 200, 77, 255]);
    const up = resizeLanczos(px, 250, 150);
    expect(at(up, 0, 0)).toEqual([12, 200, 77, 255]);
    expect(at(up, 249, 149)).toEqual([12, 200, 77, 255]);
  });

  it('keeps a linear gradient approximately linear when halving', () => {
    const px = gradient(200, 4);
    const half = resizeLanczos(px, 100, 2);
    // output pixel x covers source ~2x+0.5
    for (const x of [10, 40, 80]) expect(Math.abs(at(half, x, 0)[0] - (2 * x + 0.5))).toBeLessThanOrEqual(1.5);
  });

  it('does not darken transparent edges (premultiplied alpha)', () => {
    const px = createPx(10, 1);
    for (let x = 0; x < 10; x++) px.data.set(x < 5 ? [255, 255, 255, 255] : [0, 0, 0, 0], x * 4);
    const out = resizeLanczos(px, 5, 1);
    const edge = at(out, 2, 0);
    expect(edge[3]).toBeGreaterThan(0);
    expect(edge[0]).toBeGreaterThan(240); // colour stays white, only alpha fades
  });
});

describe('flatten', () => {
  it('composites transparent pixels on the background', () => {
    const px = solid(1, 1, [0, 0, 0, 0]);
    flatten(px, [255, 255, 255]);
    expect(at(px, 0, 0)).toEqual([255, 255, 255, 255]);
  });
});
