import { clampRect, clonePx, extract, putRegion, type Px, type Rect, type Shape } from './pixels';

export interface Selection {
  rect: Rect; // image coordinates, may be fractional while dragging
  shape: Shape;
}

/** One undo step. 'full' = whole previous image; 'patch' = previous pixels of a region. */
export type HistoryEntry =
  | { label: string; kind: 'full'; px: Px }
  | { label: string; kind: 'patch'; x: number; y: number; px: Px };

export interface View {
  zoom: number; // screen px per image px
  cx: number; // image coordinate at viewport centre
  cy: number;
}

/** Undo memory allowed per open image. Oldest steps are dropped beyond this. */
export const HISTORY_BUDGET_BYTES = 768 * 1024 * 1024;

let nextDocId = 1;

export class ImageDoc {
  readonly id = nextDocId++;
  /** Stable identity across app restarts (storage key). */
  readonly key: string;
  name: string;
  /** Original file type; used as the default export format. */
  mime: string;
  fileSize: number;
  px: Px;
  bitmap: ImageBitmap | null = null;
  undoStack: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];
  selection: Selection | null = null;
  /** Crop box while the crop tool is active. */
  cropRect: Rect | null = null;
  view: View | null = null;
  dirty = false;
  /** Bumped on every pixel change; lets background saves detect newer edits. */
  revision = 0;
  /** The image is in local storage (so metadata-only writes are safe). */
  stored = false;

  constructor(name: string, mime: string, fileSize: number, px: Px, key: string = crypto.randomUUID()) {
    this.key = key;
    this.name = name;
    this.mime = mime;
    this.fileSize = fileSize;
    this.px = px;
  }

  get width() {
    return this.px.width;
  }

  get height() {
    return this.px.height;
  }

  /** Rebuild the GPU bitmap shown on screen from the current pixels. */
  async refreshBitmap(): Promise<void> {
    const data = new ImageData(this.px.data as Uint8ClampedArray<ArrayBuffer>, this.px.width, this.px.height);
    const bmp = await createImageBitmap(data);
    this.bitmap?.close();
    this.bitmap = bmp;
  }

  /** Record that `before` was replaced (full op). Clears redo. */
  pushFull(label: string, before: Px) {
    this.push({ label, kind: 'full', px: before });
  }

  /** Record a region's previous pixels before it was edited in place. Clears redo. */
  pushPatch(label: string, x: number, y: number, before: Px) {
    this.push({ label, kind: 'patch', x, y, px: before });
  }

  private push(entry: HistoryEntry) {
    this.undoStack.push(entry);
    this.redoStack = [];
    this.dirty = true;
    this.revision++;
    this.trimHistory();
  }

  private trimHistory() {
    let bytes = this.undoStack.reduce((n, e) => n + e.px.data.byteLength, 0);
    while (bytes > HISTORY_BUDGET_BYTES && this.undoStack.length > 1) {
      const dropped = this.undoStack.shift()!;
      bytes -= dropped.px.data.byteLength;
    }
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo(): string | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push(this.swap(e));
    this.dirty = true;
    return e.label;
  }

  redo(): string | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push(this.swap(e));
    this.dirty = true;
    return e.label;
  }

  /** Restore an entry and return the inverse entry (the state it replaced). */
  private swap(e: HistoryEntry): HistoryEntry {
    this.revision++;
    if (e.kind === 'full') {
      const inverse: HistoryEntry = { label: e.label, kind: 'full', px: this.px };
      this.px = e.px;
      this.selection = null;
      this.cropRect = null;
      return inverse;
    }
    const current = extract(this.px, { x: e.x, y: e.y, w: e.px.width, h: e.px.height });
    putRegion(this.px, e.px, e.x, e.y);
    return { label: e.label, kind: 'patch', x: e.x, y: e.y, px: current };
  }

  /** Clamped integer selection rect, or null when nothing usable is selected. */
  selectionRect(): Rect | null {
    if (!this.selection) return null;
    const r = clampRect(this.selection.rect, this.width, this.height);
    return r.w > 0 && r.h > 0 ? r : null;
  }

  /** Clone of the current pixels (for sending to a worker while keeping the original). */
  snapshot(): Px {
    return clonePx(this.px);
  }

  dispose() {
    this.bitmap?.close();
    this.bitmap = null;
    this.undoStack = [];
    this.redoStack = [];
  }
}
