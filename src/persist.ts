/**
 * Keeps open tabs on this computer (IndexedDB) so they come back after the app
 * is closed. Only the current image of each tab is stored — not its undo history.
 *
 * - Unedited images store the original file as-is (no re-encoding, instant).
 * - Edited images are re-encoded losslessly (PNG) in a worker, ~1 s after the
 *   last change, so editing never waits on storage.
 * - Small per-tab metadata (name, view, unsaved flag) and the tab order are
 *   stored separately so panning/zooming doesn't rewrite the image.
 */
import type { View } from './core/doc';

const DB_NAME = 'loupe';
const DB_VERSION = 1;
const IMAGES = 'images'; // key -> Blob
const META = 'meta'; // key -> SavedMeta, plus WORKSPACE_KEY -> Workspace

const WORKSPACE_KEY = '__workspace__';

export interface SavedMeta {
  key: string;
  name: string;
  mime: string;
  fileSize: number;
  dirty: boolean;
  view: View | null;
  /** True when the stored blob is the untouched original file. */
  original: boolean;
}

export interface Workspace {
  order: string[];
  activeKey: string | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('storage is blocked by another Loupe window'));
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('storage transaction aborted'));
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveImage(meta: SavedMeta, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([IMAGES, META], 'readwrite');
  tx.objectStore(IMAGES).put(blob, meta.key);
  tx.objectStore(META).put(meta, meta.key);
  await done(tx);
}

/** Write metadata for many tabs plus the workspace in one transaction. Callers pass only tabs whose image is stored. */
export async function saveMetas(metas: SavedMeta[], workspace: Workspace): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, 'readwrite');
  const store = tx.objectStore(META);
  for (const m of metas) store.put(m, m.key);
  store.put(workspace, WORKSPACE_KEY);
  await done(tx);
}

export async function removeImage(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([IMAGES, META], 'readwrite');
  tx.objectStore(IMAGES).delete(key);
  tx.objectStore(META).delete(key);
  await done(tx);
}

export interface SavedTab {
  meta: SavedMeta;
  blob: Blob;
}

/** Load the saved workspace in tab order. Missing or corrupt entries are skipped. */
export async function loadWorkspace(): Promise<{ tabs: SavedTab[]; activeKey: string | null }> {
  const db = await openDb();
  const tx = db.transaction([IMAGES, META], 'readonly');
  const metaStore = tx.objectStore(META);
  const imageStore = tx.objectStore(IMAGES);
  const ws = ((await request(metaStore.get(WORKSPACE_KEY))) as Workspace | undefined) ?? { order: [], activeKey: null };
  const allKeys = (await request(metaStore.getAllKeys())).map(String).filter((k) => k !== WORKSPACE_KEY);
  // Tabs saved but missing from the order (e.g. crash mid-write) go at the end.
  const order = [...ws.order, ...allKeys.filter((k) => !ws.order.includes(k))];
  const tabs: SavedTab[] = [];
  for (const key of order) {
    const meta = (await request(metaStore.get(key))) as SavedMeta | undefined;
    const blob = (await request(imageStore.get(key))) as Blob | undefined;
    if (meta && blob) tabs.push({ meta, blob });
  }
  return { tabs, activeKey: ws.activeKey };
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageUsed(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ?? null;
  } catch {
    return null;
  }
}
