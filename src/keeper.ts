import { ImageDoc } from './core/doc';
import { engine } from './core/engine';
import {
  loadWorkspace,
  removeImage,
  requestPersistence,
  saveImage,
  saveMetas,
  type SavedMeta,
} from './persist';

/** The subset of the store the keeper needs (avoids an import cycle). */
export interface KeeperHost {
  docs: ImageDoc[];
  activeId: number | null;
  toast(text: string, kind?: 'info' | 'error'): void;
  /** Re-render without scheduling another metadata save. */
  notify(): void;
}

const IMAGE_DEBOUNCE_MS = 900;
const META_DEBOUNCE_MS = 400;

export type KeeperState = 'idle' | 'saving' | 'saved' | 'error' | 'unavailable';

/**
 * Background saver that mirrors open tabs into local storage. Never blocks
 * editing: image saves are debounced and encoded in a worker.
 */
export class Keeper {
  state: KeeperState = 'idle';
  usedBytes: number | null = null;
  /** Stored image size per tab, for the storage meter. */
  private sizes = new Map<string, number>();
  private imageTimers = new Map<string, number>();
  private inFlight = new Set<string>();
  private metaTimer = 0;
  private quotaWarned = false;
  private persistAsked = false;

  constructor(private readonly host: KeeperHost) {
    if (typeof indexedDB === 'undefined') this.state = 'unavailable';
  }

  /** True while changes are not yet written (used to warn before closing the page). */
  get pending(): boolean {
    return this.imageTimers.size > 0 || this.inFlight.size > 0;
  }

  private meta(doc: ImageDoc, original: boolean): SavedMeta {
    return { key: doc.key, name: doc.name, mime: doc.mime, fileSize: doc.fileSize, dirty: doc.dirty, view: doc.view, original };
  }

  private alive(doc: ImageDoc) {
    return this.host.docs.includes(doc);
  }

  /** A freshly opened file: store the original bytes untouched. */
  async addOriginal(doc: ImageDoc, file: Blob) {
    if (this.state === 'unavailable') return;
    this.inFlight.add(doc.key);
    this.setState('saving');
    try {
      await saveImage(this.meta(doc, true), file);
      doc.stored = true;
      this.sizes.set(doc.key, file.size);
      this.recovered();
      this.metaChanged();
    } catch (err) {
      this.fail(doc, err);
    } finally {
      this.inFlight.delete(doc.key);
      this.settle();
    }
  }

  /** Pixels changed: re-save the current image after a short pause. */
  imageChanged(doc: ImageDoc) {
    if (this.state === 'unavailable') return;
    clearTimeout(this.imageTimers.get(doc.key));
    this.imageTimers.set(
      doc.key,
      window.setTimeout(() => {
        this.imageTimers.delete(doc.key);
        void this.flushImage(doc);
      }, IMAGE_DEBOUNCE_MS),
    );
    this.setState('saving');
  }

  private async flushImage(doc: ImageDoc) {
    if (!this.alive(doc)) return this.settle();
    if (this.inFlight.has(doc.key)) {
      // A save for this tab is still running; try again once it finishes.
      this.imageChanged(doc);
      return;
    }
    this.inFlight.add(doc.key);
    const revision = doc.revision;
    try {
      // PNG is lossless, so the restored image is exactly what you left.
      const { blob } = await engine.run({ op: 'encode', px: doc.snapshot(), mime: 'image/png' });
      if (!blob) throw new Error('encoder returned nothing');
      if (!this.alive(doc)) return;
      await saveImage(this.meta(doc, false), blob);
      doc.stored = true;
      this.sizes.set(doc.key, blob.size);
      this.recovered();
      if (doc.revision !== revision) this.imageChanged(doc);
    } catch (err) {
      this.fail(doc, err);
    } finally {
      this.inFlight.delete(doc.key);
      this.settle();
    }
  }

  /** Tab order, active tab, view or names changed. Cheap; debounced. */
  metaChanged() {
    if (this.state === 'unavailable') return;
    clearTimeout(this.metaTimer);
    this.metaTimer = window.setTimeout(() => void this.flushMeta(), META_DEBOUNCE_MS);
  }

  private async flushMeta() {
    const docs = this.host.docs;
    const active = docs.find((d) => d.id === this.host.activeId) ?? null;
    try {
      await saveMetas(
        docs.filter((d) => d.stored).map((d) => this.meta(d, d.undoStack.length === 0 && d.redoStack.length === 0 && !d.dirty)),
        { order: docs.map((d) => d.key), activeKey: active?.key ?? null },
      );
    } catch (err) {
      console.warn('Saving tab layout failed', err);
    }
  }

  async remove(doc: ImageDoc) {
    clearTimeout(this.imageTimers.get(doc.key));
    this.imageTimers.delete(doc.key);
    this.sizes.delete(doc.key);
    try {
      await removeImage(doc.key);
    } catch (err) {
      console.warn('Removing stored image failed', err);
    }
    this.metaChanged();
    this.settle();
  }

  /** Rebuild tabs saved by a previous session. */
  async restore(): Promise<{ docs: ImageDoc[]; activeKey: string | null; failed: number }> {
    if (this.state === 'unavailable') return { docs: [], activeKey: null, failed: 0 };
    const { tabs, activeKey } = await loadWorkspace();
    const decoded = await Promise.allSettled(tabs.map((t) => engine.runPx({ op: 'decode', file: t.blob })));
    const docs: ImageDoc[] = [];
    let failed = 0;
    for (let i = 0; i < tabs.length; i++) {
      const r = decoded[i];
      const m = tabs[i].meta;
      if (r.status === 'rejected') {
        failed++;
        continue;
      }
      const doc = new ImageDoc(m.name, m.mime, m.fileSize, r.value, m.key);
      doc.dirty = m.dirty;
      doc.view = m.view;
      doc.stored = true;
      this.sizes.set(doc.key, tabs[i].blob.size);
      await doc.refreshBitmap();
      docs.push(doc);
    }
    this.refreshUsage();
    return { docs, activeKey, failed };
  }

  private fail(doc: ImageDoc, err: unknown) {
    console.error('Local save failed', err);
    this.state = 'error';
    const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
    if (quota && !this.quotaWarned) {
      this.quotaWarned = true;
      this.host.toast(`The browser is out of storage, so “${doc.name}” won’t be kept after you close Loupe. Close some tabs to free space.`, 'error');
    } else if (!quota) {
      this.host.toast(`Couldn’t keep “${doc.name}” for next time: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
    this.host.notify();
  }

  /** A save succeeded after an earlier failure: clear the error state. */
  private recovered() {
    if (this.state === 'error') this.state = 'saving';
  }

  private setState(s: KeeperState) {
    if (this.state === 'error' && s !== 'saved') return;
    if (this.state !== s) {
      this.state = s;
      this.host.notify();
    }
  }

  private settle() {
    if (this.pending) return;
    if (this.state !== 'error') this.state = 'saved';
    this.host.notify();
    this.refreshUsage();
    if (!this.persistAsked && this.host.docs.length > 0) {
      this.persistAsked = true;
      void requestPersistence();
    }
  }

  /** Recompute the storage meter from the open tabs. */
  refreshUsage() {
    // Sum of what we stored ourselves. navigator.storage.estimate() is
    // deliberately imprecise in some browsers (it reported 8 MB for 56 MB of images).
    let used = 0;
    for (const doc of this.host.docs) used += this.sizes.get(doc.key) ?? 0;
    if (used !== this.usedBytes) {
      this.usedBytes = used;
      this.host.notify();
    }
  }
}
