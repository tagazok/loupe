import { LitElement, css, html } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import type { ImageDoc, View } from '../core/doc';
import type { Rect } from '../core/pixels';
import {
  HANDLES,
  confine,
  confineAspect,
  confineMove,
  handlePoint,
  rectFromDrag,
  resizeByHandle,
  type Handle,
} from '../core/rectEdit';
import { store } from '../store';
import { StoreController } from './store-controller';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'new'; target: 'selection' | 'crop'; a: { x: number; y: number }; moved: boolean }
  | { kind: 'move'; target: 'selection' | 'crop'; orig: Rect; a: { x: number; y: number } }
  | { kind: 'resize'; target: 'selection' | 'crop'; orig: Rect; handle: Handle; a: { x: number; y: number } };

const HANDLE_HIT = 9; // screen px
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 32;

const CURSORS: Record<Handle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};

/**
 * The image viewport: draws the active image with zoom/pan, the selection
 * (marching ants), the crop box, and handles all pointer interaction.
 */
@customElement('loupe-canvas')
export class LoupeCanvas extends LitElement {
  static styles = css`
    :host { display: block; position: relative; overflow: hidden; background: var(--canvas-bg); }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; outline: none; }
    canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
  `;

  @query('canvas') private canvas!: HTMLCanvasElement;
  readonly ctrl = new StoreController(this, () => this.schedule());
  private w = 0; // CSS px
  private h = 0;
  private dpr = 1;
  private drag: Drag | null = null;
  private spaceDown = false;
  private raf = 0;
  private antsOffset = 0;
  private antsTimer = 0;
  private checker: CanvasPattern | null = null;
  private ro = new ResizeObserver(() => this.measure());

  render() {
    return html`<canvas
      tabindex="0"
      aria-label="Image canvas. Drag to select; scroll to pan; pinch or Ctrl+scroll to zoom."
      @pointerdown=${this.onDown}
      @pointermove=${this.onMove}
      @pointerup=${this.onUp}
      @pointercancel=${this.onUp}
      @pointerleave=${this.onLeave}
      @dblclick=${this.onDblClick}
    ></canvas>`;
  }

  firstUpdated() {
    this.ro.observe(this);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    store.addEventListener('zoom', this.onZoomCommand as EventListener);
    this.antsTimer = window.setInterval(() => {
      if (store.active?.selection) {
        this.antsOffset = (this.antsOffset + 1) % 16;
        this.schedule();
      }
    }, 90);
    this.measure();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    store.removeEventListener('zoom', this.onZoomCommand as EventListener);
    clearInterval(this.antsTimer);
  }

  // ------------------------------------------------------------ view math

  private measure() {
    const r = this.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.dpr = window.devicePixelRatio || 1;
    if (this.canvas) {
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
    }
    this.schedule();
  }

  private fitView(doc: ImageDoc): View {
    const pad = 32;
    const z = Math.min((this.w - pad * 2) / doc.width, (this.h - pad * 2) / doc.height, 1);
    return { zoom: Math.max(MIN_ZOOM, z), cx: doc.width / 2, cy: doc.height / 2 };
  }

  private view(doc: ImageDoc): View {
    if (!doc.view) {
      doc.view = this.fitView(doc);
      // Let the status bar pick up the fitted zoom level.
      queueMicrotask(() => store.emit());
    }
    return doc.view;
  }

  private toImage(doc: ImageDoc, sx: number, sy: number) {
    const v = this.view(doc);
    return { x: (sx - this.w / 2) / v.zoom + v.cx, y: (sy - this.h / 2) / v.zoom + v.cy };
  }

  private toScreen(doc: ImageDoc, x: number, y: number) {
    const v = this.view(doc);
    return { x: (x - v.cx) * v.zoom + this.w / 2, y: (y - v.cy) * v.zoom + this.h / 2 };
  }

  private zoomAt(doc: ImageDoc, zoom: number, sx = this.w / 2, sy = this.h / 2) {
    const p = this.toImage(doc, sx, sy);
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    doc.view = { zoom: z, cx: p.x - (sx - this.w / 2) / z, cy: p.y - (sy - this.h / 2) / z };
    store.emit();
  }

  private onZoomCommand = (e: CustomEvent<'fit' | 'in' | 'out' | number>) => {
    const doc = store.active;
    if (!doc) return;
    const d = e.detail;
    if (d === 'fit') {
      doc.view = this.fitView(doc);
      store.emit();
    } else if (d === 'in') this.zoomAt(doc, this.view(doc).zoom * 1.25);
    else if (d === 'out') this.zoomAt(doc, this.view(doc).zoom / 1.25);
    else this.zoomAt(doc, d);
  };

  // -------------------------------------------------------------- drawing

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private css(name: string, fallback: string) {
    return getComputedStyle(this).getPropertyValue(name).trim() || fallback;
  }

  private checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.checker) return this.checker;
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d')!;
    g.fillStyle = '#cfcfcf';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#9a9a9a';
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
    this.checker = ctx.createPattern(c, 'repeat');
    return this.checker;
  }

  private shapePath(ctx: CanvasRenderingContext2D, doc: ImageDoc, r: Rect, ellipse: boolean) {
    const a = this.toScreen(doc, r.x, r.y);
    const b = this.toScreen(doc, r.x + r.w, r.y + r.h);
    ctx.beginPath();
    if (ellipse) ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    else ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  /**
   * Clip to the area an operation would affect: the selection, everything
   * outside it (inverted), or the whole image.
   */
  private clipToTarget(ctx: CanvasRenderingContext2D, doc: ImageDoc, tl: { x: number; y: number }, iw: number, ih: number) {
    const sel = !store.batch ? doc.selectionRect() : null;
    if (!sel) {
      ctx.beginPath();
      ctx.rect(tl.x, tl.y, iw, ih);
      ctx.clip();
      return;
    }
    const ellipse = doc.selection?.shape === 'ellipse';
    this.shapePath(ctx, doc, sel, ellipse);
    if (doc.selection?.inverted) {
      ctx.rect(tl.x, tl.y, iw, ih);
      ctx.clip('evenodd');
    } else {
      ctx.clip();
    }
  }

  private pixelCache: { key: string; canvas: HTMLCanvasElement } | null = null;

  /** Live preview of the pending Blur / Pixelate / Brightness-contrast. */
  private drawPreview(ctx: CanvasRenderingContext2D, doc: ImageDoc, tl: { x: number; y: number }, iw: number, ih: number) {
    const pv = store.preview;
    if (!pv || !doc.bitmap) return;
    const zoom = this.view(doc).zoom;
    const hasFilter = 'filter' in ctx;
    ctx.save();
    this.clipToTarget(ctx, doc, tl, iw, ih);
    if (pv.kind === 'bc' && hasFilter) {
      if (pv.brightness !== 1 || pv.contrast !== 1) {
        ctx.filter = `brightness(${pv.brightness}) contrast(${pv.contrast})`;
        ctx.drawImage(doc.bitmap, tl.x, tl.y, iw, ih);
      }
    } else if (pv.kind === 'blur' && hasFilter) {
      // Same Gaussian (σ = radius) as Apply, at screen scale.
      ctx.filter = `blur(${pv.radius * zoom}px)`;
      ctx.drawImage(doc.bitmap, tl.x, tl.y, iw, ih);
    } else if (pv.kind === 'pixelate') {
      // Blocks start at the selection's corner, like the real operation
      // (or the image corner when the whole image / everything-but is affected).
      const sel = !store.batch && !doc.selection?.inverted ? doc.selectionRect() : null;
      const region = sel ?? { x: 0, y: 0, w: doc.width, h: doc.height };
      const b = Math.max(1, Math.round(pv.block));
      const tw = Math.ceil(region.w / b);
      const th = Math.ceil(region.h / b);
      const key = `${doc.id}:${doc.revision}:${b}:${region.x},${region.y},${region.w},${region.h}`;
      if (this.pixelCache?.key !== key) {
        const c = document.createElement('canvas');
        c.width = tw;
        c.height = th;
        const g = c.getContext('2d')!;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        // Shrinking so one output pixel = one block averages each block.
        g.drawImage(doc.bitmap, region.x, region.y, tw * b, th * b, 0, 0, tw, th);
        this.pixelCache = { key, canvas: c };
      }
      const p = this.toScreen(doc, region.x, region.y);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.pixelCache.canvas, p.x, p.y, tw * b * zoom, th * b * zoom);
    }
    ctx.restore();
  }

  private draw() {
    const ctx = this.canvas?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const doc = store.active;
    if (!doc || !doc.bitmap) return;
    const v = this.view(doc);
    const tl = this.toScreen(doc, 0, 0);
    const iw = doc.width * v.zoom;
    const ih = doc.height * v.zoom;

    // Transparency checkerboard + drop shadow.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = this.checkerPattern(ctx) ?? '#bbb';
    ctx.fillRect(tl.x, tl.y, iw, ih);
    ctx.restore();

    ctx.imageSmoothingEnabled = v.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(doc.bitmap, tl.x, tl.y, iw, ih);

    this.drawPreview(ctx, doc, tl, iw, ih);

    const accent = this.css('--accent', '#4c8dff');

    // Crop overlay.
    if (store.tool === 'crop' && doc.cropRect) {
      const r = doc.cropRect;
      const a = this.toScreen(doc, r.x, r.y);
      const b = this.toScreen(doc, r.x + r.w, r.y + r.h);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.rect(0, 0, this.w, this.h);
      ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        const gx = a.x + ((b.x - a.x) * i) / 3;
        const gy = a.y + ((b.y - a.y) * i) / 3;
        ctx.beginPath();
        ctx.moveTo(gx, a.y);
        ctx.lineTo(gx, b.y);
        ctx.moveTo(a.x, gy);
        ctx.lineTo(b.x, gy);
        ctx.stroke();
      }
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      this.drawHandles(ctx, doc, r, '#fff');
      this.drawLabel(ctx, `${Math.round(r.w)} × ${Math.round(r.h)}`, a.x, b.y + 8);
      ctx.restore();
    }

    // Selection: marching ants (around the image edge too when inverted).
    if (doc.selection && store.tool !== 'crop') {
      const r = doc.selection.rect;
      const inverted = !!doc.selection.inverted;
      ctx.save();
      if (inverted && !store.preview) {
        // Show which part is protected: a light veil over the kept-as-is shape.
        this.shapePath(ctx, doc, r, doc.selection.shape === 'ellipse');
        ctx.fillStyle = 'rgba(76,141,255,0.18)';
        ctx.fill();
      }
      this.shapePath(ctx, doc, r, doc.selection.shape === 'ellipse');
      if (inverted) ctx.rect(tl.x + 0.5, tl.y + 0.5, iw - 1, ih - 1);
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = '#000';
      ctx.lineDashOffset = -this.antsOffset;
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineDashOffset = -this.antsOffset + 4;
      ctx.stroke();
      ctx.restore();
      if (store.tool === 'select-rect' || store.tool === 'select-ellipse') {
        this.drawHandles(ctx, doc, r, accent);
        const a = this.toScreen(doc, r.x, r.y + r.h);
        const size = `${Math.round(r.w)} × ${Math.round(r.h)}`;
        this.drawLabel(ctx, inverted ? `Everything except ${size}` : size, a.x, a.y + 8);
      }
    }
  }

  private drawHandles(ctx: CanvasRenderingContext2D, doc: ImageDoc, r: Rect, color: string) {
    ctx.save();
    ctx.setLineDash([]);
    for (const h of HANDLES) {
      const p = handlePoint(r, h);
      const s = this.toScreen(doc, p.x, p.y);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(s.x - 4, s.y - 4, 8, 8);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
    ctx.save();
    ctx.font = '600 11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    const lx = Math.min(Math.max(4, x), this.w - w - 4);
    const ly = Math.min(y, this.h - 24);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.roundRect(lx, ly, w, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 6, ly + 9.5);
    ctx.restore();
  }

  // -------------------------------------------------------------- pointer

  private point(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }

  private activeRect(doc: ImageDoc): { target: 'selection' | 'crop'; rect: Rect | null } {
    if (store.tool === 'crop') return { target: 'crop', rect: doc.cropRect };
    return { target: 'selection', rect: doc.selection?.rect ?? null };
  }

  private hitHandle(doc: ImageDoc, r: Rect, sx: number, sy: number): Handle | null {
    for (const h of HANDLES) {
      const p = handlePoint(r, h);
      const s = this.toScreen(doc, p.x, p.y);
      if (Math.abs(s.x - sx) <= HANDLE_HIT && Math.abs(s.y - sy) <= HANDLE_HIT) return h;
    }
    return null;
  }

  private inside(r: Rect, p: { x: number; y: number }) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  private aspectFor(target: 'selection' | 'crop', e: PointerEvent): number | null {
    if (target === 'crop') return store.cropAspect;
    return e.shiftKey ? 1 : null;
  }

  private onDown = (e: PointerEvent) => {
    const doc = store.active;
    if (!doc) return;
    this.canvas.focus();
    this.canvas.setPointerCapture(e.pointerId);
    const { sx, sy } = this.point(e);
    const v = this.view(doc);
    if (e.button === 1 || this.spaceDown || store.tool === 'hand') {
      this.drag = { kind: 'pan', sx, sy, cx: v.cx, cy: v.cy };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const p = this.toImage(doc, sx, sy);
    const { target, rect } = this.activeRect(doc);
    if (rect) {
      const handle = this.hitHandle(doc, rect, sx, sy);
      if (handle) {
        this.drag = { kind: 'resize', target, orig: { ...rect }, handle, a: p };
        return;
      }
      if (this.inside(rect, p)) {
        this.drag = { kind: 'move', target, orig: { ...rect }, a: p };
        this.canvas.style.cursor = 'move';
        return;
      }
    }
    if (store.tool === 'select-ellipse' || store.tool === 'select-rect' || store.tool === 'crop') {
      const a = { x: Math.min(Math.max(0, p.x), doc.width), y: Math.min(Math.max(0, p.y), doc.height) };
      this.drag = { kind: 'new', target, a, moved: false };
    }
  };

  private onMove = (e: PointerEvent) => {
    const doc = store.active;
    if (!doc) return;
    const { sx, sy } = this.point(e);
    const p = this.toImage(doc, sx, sy);
    const inImage = p.x >= 0 && p.y >= 0 && p.x < doc.width && p.y < doc.height;
    store.cursor = inImage ? { x: Math.floor(p.x), y: Math.floor(p.y) } : null;

    const d = this.drag;
    if (!d) {
      this.updateHoverCursor(doc, sx, sy, p);
      store.emit();
      return;
    }
    if (d.kind === 'pan') {
      const v = this.view(doc);
      doc.view = { zoom: v.zoom, cx: d.cx - (sx - d.sx) / v.zoom, cy: d.cy - (sy - d.sy) / v.zoom };
      store.emit();
      return;
    }
    const aspect = this.aspectFor(d.target, e);
    let r: Rect;
    if (d.kind === 'new') {
      const b = { x: Math.min(Math.max(0, p.x), doc.width), y: Math.min(Math.max(0, p.y), doc.height) };
      r = rectFromDrag(d.a, b, aspect);
      d.moved = d.moved || Math.hypot(b.x - d.a.x, b.y - d.a.y) * this.view(doc).zoom > 3;
      if (!d.moved) return;
    } else if (d.kind === 'move') {
      r = confineMove({ ...d.orig, x: d.orig.x + p.x - d.a.x, y: d.orig.y + p.y - d.a.y }, doc.width, doc.height);
    } else {
      r = resizeByHandle(d.orig, d.handle, p.x - d.a.x, p.y - d.a.y, aspect);
    }
    if (d.kind !== 'move') r = aspect ? confineAspect(r, doc.width, doc.height, aspect) : confine(r, doc.width, doc.height);
    this.commitRect(doc, d.target, r);
  };

  private commitRect(doc: ImageDoc, target: 'selection' | 'crop', r: Rect) {
    if (target === 'crop') {
      doc.cropRect = r;
    } else {
      // A new drag takes the current tool's shape; moving/resizing keeps the existing shape.
      const isNew = this.drag?.kind === 'new' || !doc.selection;
      const shape = isNew ? (store.tool === 'select-ellipse' ? 'ellipse' : 'rect') : doc.selection!.shape;
      doc.selection = { rect: r, shape, inverted: isNew ? false : doc.selection!.inverted };
    }
    store.emit();
  }

  private onUp = (e: PointerEvent) => {
    const doc = store.active;
    const d = this.drag;
    this.drag = null;
    this.canvas.style.cursor = '';
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!doc || !d || d.kind === 'pan') return;
    if (d.kind === 'new' && !d.moved) {
      // A plain click outside the box: clear the selection (crop box stays).
      if (d.target === 'selection' && doc.selection) store.setSelection(null);
      return;
    }
    // Snap to whole pixels once the gesture ends.
    const snap = (r: Rect): Rect => {
      const x = Math.round(r.x), y = Math.round(r.y);
      return { x, y, w: Math.max(1, Math.round(r.x + r.w) - x), h: Math.max(1, Math.round(r.y + r.h) - y) };
    };
    if (d.target === 'crop' && doc.cropRect) doc.cropRect = snap(doc.cropRect);
    if (d.target === 'selection' && doc.selection) doc.selection = { ...doc.selection, rect: snap(doc.selection.rect) };
    store.emit();
  };

  private onLeave = () => {
    if (!this.drag && store.cursor) {
      store.cursor = null;
      store.emit();
    }
  };

  private onDblClick = () => {
    if (store.tool === 'crop') void store.applyCrop();
  };

  private updateHoverCursor(doc: ImageDoc, sx: number, sy: number, p: { x: number; y: number }) {
    let cursor = '';
    if (this.spaceDown || store.tool === 'hand') cursor = 'grab';
    else {
      const { rect } = this.activeRect(doc);
      const h = rect ? this.hitHandle(doc, rect, sx, sy) : null;
      if (h) cursor = CURSORS[h];
      else if (rect && this.inside(rect, p)) cursor = 'move';
      else cursor = 'crosshair';
    }
    this.canvas.style.cursor = cursor;
  }

  private onWheel = (e: WheelEvent) => {
    const doc = store.active;
    if (!doc) return;
    e.preventDefault();
    const { sx, sy } = this.point(e);
    const v = this.view(doc);
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
      this.zoomAt(doc, v.zoom * factor, sx, sy);
    } else {
      const unit = e.deltaMode === 1 ? 16 : 1;
      doc.view = { zoom: v.zoom, cx: v.cx + (e.deltaX * unit) / v.zoom, cy: v.cy + (e.deltaY * unit) / v.zoom };
      store.emit();
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    const down = e.type === 'keydown';
    if (down) e.preventDefault();
    if (down !== this.spaceDown) {
      this.spaceDown = down;
      if (this.canvas && !this.drag) this.canvas.style.cursor = down ? 'grab' : '';
    }
  };

  protected updated() {
    this.schedule();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'loupe-canvas': LoupeCanvas;
  }
}
