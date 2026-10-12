import type { Rect } from './pixels';

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Normalize a rect so w/h are non-negative. */
export function normalize(r: Rect): Rect {
  const x = r.w < 0 ? r.x + r.w : r.x;
  const y = r.h < 0 ? r.y + r.h : r.y;
  return { x, y, w: Math.abs(r.w), h: Math.abs(r.h) };
}

/** Rect spanned by a drag from `a` to `b`, optionally locked to `aspect` (w / h). */
export function rectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }, aspect: number | null): Rect {
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (aspect) {
    // Follow whichever axis moved further, keep drag direction.
    if (Math.abs(w) / aspect >= Math.abs(h)) h = (Math.sign(h) || 1) * (Math.abs(w) / aspect);
    else w = (Math.sign(w) || 1) * Math.abs(h) * aspect;
  }
  return normalize({ x: a.x, y: a.y, w, h });
}

/** Handle positions in the same coordinate space as `r`. */
export function handlePoint(r: Rect, h: Handle): { x: number; y: number } {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/**
 * Drag handle `h` of `orig` by (dx, dy). With an aspect lock, corner handles
 * keep the ratio and edge handles grow the other side symmetrically.
 */
export function resizeByHandle(orig: Rect, h: Handle, dx: number, dy: number, aspect: number | null): Rect {
  let { x, y, w, h: ht } = orig;
  if (h.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (h.includes('e')) w += dx;
  if (h.includes('n')) {
    y += dy;
    ht -= dy;
  }
  if (h.includes('s')) ht += dy;

  if (aspect) {
    if (h.length === 2) {
      // Corner: size from the dominant axis, anchored at the opposite corner.
      const nw = Math.abs(w) / aspect >= Math.abs(ht) ? w : Math.sign(w || 1) * Math.abs(ht) * aspect;
      const nh = Math.sign(ht || 1) * (Math.abs(nw) / aspect);
      if (h.includes('w')) x = orig.x + orig.w - nw;
      if (h.includes('n')) y = orig.y + orig.h - nh;
      w = nw;
      ht = nh;
    } else if (h === 'e' || h === 'w') {
      const nh = Math.abs(w) / aspect;
      y = orig.y + (orig.h - nh) / 2;
      ht = nh;
    } else {
      const nw = Math.abs(ht) * aspect;
      x = orig.x + (orig.w - nw) / 2;
      w = nw;
    }
  }
  return normalize({ x, y, w, h: ht });
}

/** Keep a rect inside [0, W]×[0, H] by moving it (not resizing) when possible. */
export function confineMove(r: Rect, W: number, H: number): Rect {
  const x = Math.min(Math.max(0, r.x), Math.max(0, W - r.w));
  const y = Math.min(Math.max(0, r.y), Math.max(0, H - r.h));
  return { ...r, x, y };
}

/** Clip a rect to [0, W]×[0, H] (may shrink it). */
export function confine(r: Rect, W: number, H: number): Rect {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(W, r.x + r.w);
  const y1 = Math.min(H, r.y + r.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Clip to the image while keeping an aspect ratio: shrink about the rect's
 * anchor so a locked crop never silently changes shape at the border.
 */
export function confineAspect(r: Rect, W: number, H: number, aspect: number): Rect {
  let { x, y, w, h } = r;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  w = Math.min(w, W - x);
  h = Math.min(h, H - y);
  if (w / aspect > h) w = h * aspect;
  else h = w / aspect;
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

/** Largest centred rect of `aspect` that fits in W×H. */
export function centeredAspect(W: number, H: number, aspect: number): Rect {
  let w = W;
  let h = W / aspect;
  if (h > H) {
    h = H;
    w = H * aspect;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
