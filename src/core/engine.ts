import type { Px } from './pixels';
import type { WorkerRequest, WorkerResponse } from './protocol';

interface Pending {
  resolve: (r: { px?: Px; blob?: Blob }) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  busy: number;
}

/**
 * A small pool of image workers. Single-image edits use one worker; batch
 * edits across tabs spread over the pool and run in parallel.
 */
class Engine {
  private slots: Slot[] = [];
  private pending = new Map<number, Pending & { slot: Slot }>();
  private nextId = 1;

  constructor(private readonly size: number) {}

  /** Workers start on first use, so importing this module has no side effects. */
  private ensureStarted() {
    if (this.slots.length) return;
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      worker.onerror = (e) => console.error('worker error', e);
      this.slots.push(slot);
    }
  }

  private onMessage(msg: WorkerResponse) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    p.slot.busy--;
    if (msg.ok) p.resolve({ px: msg.px, blob: msg.blob });
    else p.reject(new Error(msg.error));
  }

  /**
   * Run a request. Any `px` buffer in the request is TRANSFERRED to the worker
   * and becomes unusable here — pass a copy if you still need it.
   */
  run(req: WorkerRequest): Promise<{ px?: Px; blob?: Blob }> {
    this.ensureStarted();
    const slot = this.slots.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = this.nextId++;
    slot.busy++;
    const transfer: Transferable[] = 'px' in req ? [req.px.data.buffer as ArrayBuffer] : [];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, slot });
      slot.worker.postMessage({ id, req }, transfer);
    });
  }

  async runPx(req: WorkerRequest): Promise<Px> {
    const r = await this.run(req);
    if (!r.px) throw new Error(`worker op ${req.op} returned no pixels`);
    return r.px;
  }
}

const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
export const engine = new Engine(Math.max(2, Math.min(4, Math.floor(cores / 2))));
