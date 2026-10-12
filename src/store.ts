import { ImageDoc } from './core/doc';
import { engine } from './core/engine';
import { blendShape, clampRect, extract, fullRect, putRegion, type Px, type Rect, type Shape } from './core/pixels';
import type { WorkerRequest } from './core/protocol';
import { Keeper } from './keeper';

export type Tool = 'hand' | 'select-rect' | 'select-ellipse' | 'crop';
export type ExportFormat = 'original' | 'image/png' | 'image/jpeg' | 'image/webp';

export type ResizeSpec =
  | { mode: 'pixels'; width: number; height: number }
  | { mode: 'percent'; value: number }
  | { mode: 'longEdge'; value: number };

/**
 * Live preview drawn on the canvas before Apply. Colour previews use the same
 * CSS formulas as the pixel ops; blur/pixelate are close screen-resolution
 * approximations of the real (full-resolution) result.
 */
export type Preview =
  | { kind: 'bc'; brightness: number; contrast: number } // 1 = unchanged
  | { kind: 'blur'; radius: number }
  | { kind: 'pixelate'; block: number };

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

const EXPORTABLE = ['image/png', 'image/jpeg', 'image/webp'];
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function computeResize(w: number, h: number, spec: ResizeSpec): { width: number; height: number } {
  let width: number;
  let height: number;
  if (spec.mode === 'pixels') {
    width = spec.width;
    height = spec.height;
  } else if (spec.mode === 'percent') {
    width = (w * spec.value) / 100;
    height = (h * spec.value) / 100;
  } else {
    const s = spec.value / Math.max(w, h);
    width = w * s;
    height = h * s;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** "holiday.final.jpg" + "image/png" -> "holiday.final-edited.png" */
export function exportName(name: string, mime: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-edited.${EXT[mime] ?? 'png'}`;
}

/** Central app state. Components subscribe to 'change' and re-render. */
export class Store extends EventTarget {
  docs: ImageDoc[] = [];
  activeId: number | null = null;
  tool: Tool = 'select-rect';
  /** When on, whole-image Adjust and Image operations apply to every open tab. */
  batch = false;
  busy: string | null = null;
  toasts: Toast[] = [];
  preview: Preview | null = null;
  /** Locked crop aspect ratio (w / h), or null for free. */
  cropAspect: number | null = null;
  exportFormat: ExportFormat = 'original';
  exportQuality = 0.92;
  /** Image coordinate under the pointer, for the status bar. */
  cursor: { x: number; y: number } | null = null;
  /** Keeps open tabs in local storage across app restarts. */
  readonly keeper = new Keeper(this);
  private toastId = 1;

  emit() {
    this.keeper.metaChanged();
    this.notify();
  }

  /** Re-render only (no storage write). */
  notify() {
    this.dispatchEvent(new Event('change'));
  }

  get active(): ImageDoc | null {
    return this.docs.find((d) => d.id === this.activeId) ?? null;
  }

  /** Docs an image-wide operation applies to: all tabs in batch mode, else the active one. */
  private targets(): ImageDoc[] {
    if (this.batch) return [...this.docs];
    return this.active ? [this.active] : [];
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const t = { id: this.toastId++, text, kind };
    this.toasts = [...this.toasts, t];
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.emit();
    }, kind === 'error' ? 6000 : 3000);
  }

  setTool(tool: Tool) {
    this.tool = tool;
    const doc = this.active;
    if (doc && tool === 'crop' && !doc.cropRect) {
      doc.cropRect = doc.selectionRect() ?? fullRect(doc.px);
    }
    if (doc && tool !== 'crop') doc.cropRect = null;
    this.emit();
  }

  setActive(id: number) {
    const prev = this.active;
    if (prev) prev.cropRect = null;
    this.activeId = id;
    this.preview = null;
    if (this.tool === 'crop') this.setTool('crop');
    this.emit();
  }

  /** Run `fn` with a busy indicator. Refuses (with a toast) if another job is running. */
  private async job(label: string, fn: () => Promise<void>): Promise<boolean> {
    if (this.busy) {
      this.toast(`Still working on “${this.busy}”…`);
      return false;
    }
    this.busy = label;
    this.emit();
    try {
      await fn();
      return true;
    } catch (err) {
      console.error(err);
      this.toast(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return false;
    } finally {
      this.busy = null;
      this.emit();
    }
  }

  // ------------------------------------------------------------------ files

  async openFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name));
    const skipped = files.length - images.length;
    if (skipped > 0) this.toast(`Skipped ${skipped} file(s) that aren't images.`, 'error');
    if (images.length === 0) return;
    await this.job(images.length > 1 ? `Opening ${images.length} images` : `Opening ${images[0].name}`, async () => {
      let first: ImageDoc | null = null;
      // Decode in parallel across the worker pool.
      const results = await Promise.allSettled(images.map((f) => engine.runPx({ op: 'decode', file: f })));
      for (let i = 0; i < images.length; i++) {
        const r = results[i];
        const f = images[i];
        if (r.status === 'rejected') {
          const hint = /heic|heif/i.test(f.name) ? ' (HEIC isn’t supported by this browser — export as JPEG first)' : '';
          this.toast(`Couldn’t open ${f.name}${hint}.`, 'error');
          continue;
        }
        const doc = new ImageDoc(f.name, f.type || 'image/png', f.size, r.value);
        await doc.refreshBitmap();
        this.docs = [...this.docs, doc];
        void this.keeper.addOriginal(doc, f);
        first ??= doc;
      }
      if (first) this.activeId = first.id;
      if (this.tool === 'crop' && this.active) this.active.cropRect = fullRect(this.active.px);
    });
  }

  close(id: number) {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return;
    if (doc.dirty && !confirm(`“${doc.name}” has unsaved changes. Close it anyway?`)) return;
    const idx = this.docs.indexOf(doc);
    this.docs = this.docs.filter((d) => d !== doc);
    doc.dispose();
    void this.keeper.remove(doc);
    if (this.activeId === id) {
      const next = this.docs[Math.min(idx, this.docs.length - 1)];
      this.activeId = next?.id ?? null;
    }
    this.emit();
  }

  // ---------------------------------------------------------------- history

  async undo() {
    const doc = this.active;
    if (!doc || this.busy) return;
    const label = doc.undo();
    if (label) {
      await doc.refreshBitmap();
      this.keeper.imageChanged(doc);
      this.toast(`Undo: ${label}`);
    }
    this.emit();
  }

  async redo() {
    const doc = this.active;
    if (!doc || this.busy) return;
    const label = doc.redo();
    if (label) {
      await doc.refreshBitmap();
      this.keeper.imageChanged(doc);
      this.toast(`Redo: ${label}`);
    }
    this.emit();
  }

  /** Bring back the tabs that were open last time. Called once at startup. */
  async restore() {
    await this.job('Reopening your images', async () => {
      const { docs, activeKey, failed } = await this.keeper.restore();
      if (docs.length === 0 && failed === 0) return;
      this.docs = [...docs, ...this.docs];
      this.activeId = (docs.find((d) => d.key === activeKey) ?? docs[0])?.id ?? this.activeId;
      this.keeper.refreshUsage();
      if (failed > 0) this.toast(`${failed} saved image(s) couldn’t be reopened.`, 'error');
    });
  }

  // -------------------------------------------------------------- selection

  setSelection(rect: Rect | null, shape: Shape = 'rect') {
    const doc = this.active;
    if (!doc) return;
    doc.selection = rect ? { rect, shape } : null;
    this.emit();
  }

  /** Toggle "everything except the selection". */
  invertSelection() {
    const doc = this.active;
    if (!doc) return;
    if (!doc.selection) {
      this.toast('Select an area first, then invert it to work on everything else.');
      return;
    }
    doc.selection = { ...doc.selection, inverted: !doc.selection.inverted };
    this.emit();
  }

  setPreview(preview: Preview | null) {
    this.preview = preview;
    this.notify();
  }

  selectAll() {
    const doc = this.active;
    if (!doc) return;
    doc.selection = { rect: fullRect(doc.px), shape: 'rect' };
    if (this.tool !== 'select-rect' && this.tool !== 'select-ellipse') this.tool = 'select-rect';
    this.emit();
  }

  // ------------------------------------------------------------- operations

  /**
   * Edit the selection (or the whole image when nothing is selected).
   * `pad` extra pixels around the selection are sent as context (for blur).
   * Region edits store only the changed region in history, not the whole image.
   */
  private async regionOp(
    doc: ImageDoc,
    label: string,
    pad: number,
    build: (px: Px, region: Rect, shape: Shape) => WorkerRequest,
    useSelection = true,
  ) {
    const sel = useSelection ? doc.selectionRect() : null;
    const shape: Shape = (useSelection && doc.selection?.shape) || 'rect';
    if (sel && doc.selection?.inverted) {
      // Everything except the selection: edit the whole image, then put the
      // original pixels back inside the selected shape.
      const before = doc.px;
      const out = await engine.runPx(build(doc.snapshot(), fullRect(before), 'rect'));
      blendShape(out, extract(before, sel), sel, shape);
      doc.px = out;
      doc.pushFull(label, before);
    } else if (!sel) {
      const before = doc.px;
      doc.px = await engine.runPx(build(doc.snapshot(), fullRect(before), 'rect'));
      doc.pushFull(label, before);
    } else {
      const padded = clampRect({ x: sel.x - pad, y: sel.y - pad, w: sel.w + 2 * pad, h: sel.h + 2 * pad }, doc.width, doc.height);
      const before = extract(doc.px, sel);
      const local = { x: sel.x - padded.x, y: sel.y - padded.y, w: sel.w, h: sel.h };
      const out = await engine.runPx(build(extract(doc.px, padded), local, shape));
      putRegion(doc.px, extract(out, local), sel.x, sel.y);
      doc.pushPatch(label, sel.x, sel.y, before);
    }
    await doc.refreshBitmap();
    this.keeper.imageChanged(doc);
  }

  /** Replace the whole image (geometry changes). Clears selection and refits the view. */
  private async fullOp(doc: ImageDoc, label: string, build: (px: Px) => WorkerRequest) {
    const before = doc.px;
    doc.px = await engine.runPx(build(doc.snapshot()));
    doc.pushFull(label, before);
    doc.selection = null;
    doc.cropRect = null;
    doc.view = null;
    await doc.refreshBitmap();
    this.keeper.imageChanged(doc);
  }

  /** Colour adjustment: selection-aware on a single image, whole image for every tab in batch mode. */
  async adjust(kind: 'grayscale' | 'invert' | 'brightnessContrast', brightness = 1, contrast = 1) {
    const targets = this.targets();
    if (targets.length === 0) return;
    const label = kind === 'grayscale' ? 'Black & white' : kind === 'invert' ? 'Invert' : 'Brightness / contrast';
    const ok = await this.job(this.batchLabel(label, targets), async () => {
      const useSel = !this.batch;
      await eachLimited(targets, (doc) =>
        this.regionOp(
          doc,
          label,
          0,
          (px, region, shape) =>
            kind === 'brightnessContrast'
              ? { op: kind, px, region, shape, brightness, contrast }
              : { op: kind, px, region, shape },
          useSel,
        ),
      );
    });
    if (ok && kind === 'brightnessContrast' && this.preview?.kind === 'bc') this.preview = null;
    this.emit();
  }

  /** Blur / pixelate / fill the selection of the active image (whole image if none). */
  async effect(
    kind: 'blur' | 'pixelate' | 'fill',
    params: { radius?: number; block?: number; rgba?: [number, number, number, number] },
  ) {
    const doc = this.active;
    if (!doc) return;
    const label = kind === 'blur' ? 'Blur' : kind === 'pixelate' ? 'Pixelate' : 'Fill';
    const radius = params.radius ?? 12;
    const ok = await this.job(label, async () => {
      await this.regionOp(doc, label, kind === 'blur' ? Math.ceil(radius * 3) : 0, (px, region, shape) => {
        if (kind === 'blur') return { op: 'blur', px, region, shape, radius };
        if (kind === 'pixelate') return { op: 'pixelate', px, region, shape, block: params.block ?? 16 };
        return { op: 'fill', px, region, shape, rgba: params.rgba ?? [0, 0, 0, 255] };
      });
    });
    if (ok && this.preview?.kind === kind) this.preview = null;
    this.emit();
  }

  async resize(spec: ResizeSpec) {
    const targets = this.targets();
    if (targets.length === 0) return;
    await this.job(this.batchLabel('Resize', targets), async () => {
      await eachLimited(targets, async (doc) => {
        const { width, height } = computeResize(doc.width, doc.height, spec);
        if (width === doc.width && height === doc.height) return;
        await this.fullOp(doc, `Resize to ${width}×${height}`, (px) => ({ op: 'resize', px, width, height }));
      });
    });
    this.emit();
  }

  async rotate(cw: boolean) {
    const targets = this.targets();
    await this.job(this.batchLabel(cw ? 'Rotate right' : 'Rotate left', targets), async () => {
      await eachLimited(targets, (doc) => this.fullOp(doc, cw ? 'Rotate right' : 'Rotate left', (px) => ({ op: 'rotate', px, cw })));
    });
    this.emit();
  }

  async flip(axis: 'h' | 'v') {
    const targets = this.targets();
    const label = axis === 'h' ? 'Flip horizontal' : 'Flip vertical';
    await this.job(this.batchLabel(label, targets), async () => {
      await eachLimited(targets, (doc) => this.fullOp(doc, label, (px) => ({ op: 'flip', px, axis })));
    });
    this.emit();
  }

  setCropRect(rect: Rect | null) {
    const doc = this.active;
    if (!doc) return;
    doc.cropRect = rect;
    this.emit();
  }

  async applyCrop(rect?: Rect) {
    const doc = this.active;
    if (!doc) return;
    const r = clampRect(rect ?? doc.cropRect ?? doc.selectionRect() ?? fullRect(doc.px), doc.width, doc.height);
    if (r.w === 0 || r.h === 0) return;
    if (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height) {
      this.toast('The crop box covers the whole image — nothing to crop.');
      return;
    }
    await this.job('Crop', async () => {
      await this.fullOp(doc, `Crop to ${r.w}×${r.h}`, (px) => ({ op: 'crop', px, rect: r }));
    });
    if (this.tool === 'crop') this.tool = 'select-rect';
    this.emit();
  }

  private batchLabel(label: string, targets: ImageDoc[]) {
    return targets.length > 1 ? `${label} (${targets.length} images)` : label;
  }

  // ------------------------------------------------------------------ export

  private exportMime(doc: ImageDoc): string {
    if (this.exportFormat !== 'original') return this.exportFormat;
    return EXPORTABLE.includes(doc.mime) ? doc.mime : 'image/png';
  }

  private async encode(doc: ImageDoc): Promise<{ blob: Blob; name: string }> {
    const mime = this.exportMime(doc);
    const quality = mime === 'image/png' ? undefined : this.exportQuality;
    const { blob } = await engine.run({ op: 'encode', px: doc.snapshot(), mime, quality });
    if (!blob) throw new Error('encoder returned nothing');
    if (blob.type !== mime) {
      // e.g. a browser without a WebP encoder silently falls back to PNG.
      this.toast(`This browser can’t save ${EXT[mime]?.toUpperCase()} — saved as ${EXT[blob.type]?.toUpperCase() ?? blob.type}.`, 'error');
    }
    return { blob, name: exportName(doc.name, blob.type) };
  }

  private download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  /** Chromium's File System Access API (Chrome, Edge, Arc). Absent in Safari/Firefox. */
  get canPickLocation(): boolean {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
  }

  get canPickFolder(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  /** Save the active image: straight to Downloads, or ask where (`pick`). */
  async exportActive(pick = false) {
    const doc = this.active;
    if (!doc) return;
    if (pick && this.canPickLocation) {
      // The picker must open during the click (user activation), before any slow encoding.
      const mime = this.exportMime(doc);
      let handle: FileSystemFileHandle;
      try {
        handle = await (window as unknown as FsWindow).showSaveFilePicker({
          suggestedName: exportName(doc.name, mime),
          types: [{ description: `${EXT[mime].toUpperCase()} image`, accept: { [mime]: [`.${EXT[mime]}`] } }],
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        throw err;
      }
      await this.job('Saving', async () => {
        const { blob } = await this.encode(doc);
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        doc.dirty = false;
        this.toast(`Saved ${handle.name} (${formatBytes(blob.size)})`);
      });
      return;
    }
    await this.job('Saving', async () => {
      const { blob, name } = await this.encode(doc);
      this.download(blob, name);
      doc.dirty = false;
      this.toast(`Saved ${name} to Downloads (${formatBytes(blob.size)})`);
    });
  }

  /** Save every tab: to Downloads, or into a folder you choose (`pick`). */
  async exportAll(pick = false) {
    if (this.docs.length === 0) return;
    let dir: FileSystemDirectoryHandle | null = null;
    if (pick && this.canPickFolder) {
      try {
        dir = await (window as unknown as FsWindow).showDirectoryPicker({ mode: 'readwrite' });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        throw err;
      }
    }
    await this.job(`Saving ${this.docs.length} images`, async () => {
      for (const doc of this.docs) {
        const { blob, name } = await this.encode(doc);
        if (dir) {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        } else {
          this.download(blob, name);
          // Small gap: browsers throttle bursts of downloads.
          await new Promise((r) => setTimeout(r, 250));
        }
        doc.dirty = false;
      }
      this.toast(dir ? `Saved ${this.docs.length} images to “${dir.name}”.` : `Saved ${this.docs.length} images to Downloads.`);
    });
  }
}

interface FsWindow {
  showSaveFilePicker(opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle>;
  showDirectoryPicker(opts: { mode: 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}

declare global {
  interface FileSystemFileHandle {
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }
}

/**
 * Run `fn` over items with at most 2 in flight. Batch edits on many 20 MB
 * photos would otherwise hold several full-size copies in memory at once.
 */
async function eachLimited<T>(items: T[], fn: (item: T) => Promise<void>, limit = 2): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const store = new Store();
