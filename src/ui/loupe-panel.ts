import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { centeredAspect } from '../core/rectEdit';
import { computeResize, formatBytes, store, type ExportFormat } from '../store';
import { icon } from './icons';
import { StoreController } from './store-controller';
import { controls } from './styles';

type ResizeMode = 'pixels' | 'percent' | 'longEdge';

const RATIOS: { label: string; value: number | 'original' | null }[] = [
  { label: 'Free', value: null },
  { label: 'Original', value: 'original' },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Right-hand properties panel: tool options, effects, adjustments, image size, export. */
@customElement('loupe-panel')
export class LoupePanel extends LitElement {
  static styles = [
    controls,
    css`
      :host { display: flex; flex-direction: column; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--border); }
      section { padding: 12px 14px 14px; border-bottom: 1px solid var(--border); display: grid; gap: 10px; }
      h2 { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-strong); display: flex; align-items: center; gap: 6px; }
      .hint { font-size: 12px; color: var(--muted); margin: -4px 0 0; }
      .row { display: flex; gap: 6px; align-items: center; }
      .row > * { flex: 1; }
      .row > .fixed { flex: none; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .ratios { display: flex; flex-wrap: wrap; gap: 4px; }
      .ratios button { min-height: 26px; padding: 3px 8px; font-size: 12px; }
      .slider { display: grid; gap: 2px; }
      .slider .top { display: flex; justify-content: space-between; }
      .slider output { font: 12px var(--mono); color: var(--text); }
      .field { display: grid; gap: 3px; }
      .batch { background: var(--accent-subtle); border-bottom: 1px solid var(--border); }
      .batch label.toggle { display: flex; gap: 8px; align-items: center; color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer; }
      .empty { padding: 24px 16px; color: var(--muted); }
      .readout { font: 12px var(--mono); color: var(--text); }
      .badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 99px; background: var(--accent); color: var(--on-accent); letter-spacing: 0; text-transform: none; }
    `,
  ];

  readonly ctrl = new StoreController(this);

  @state() private blurRadius = 16;
  @state() private pixelBlock = 24;
  @state() private fillColor = '#000000';
  @state() private brightness = 100;
  @state() private contrast = 100;
  @state() private resizeMode: ResizeMode = 'pixels';
  @state() private resizeW = 0;
  @state() private resizeH = 0;
  @state() private resizePct = 50;
  @state() private resizeLong = 2048;
  @state() private lockRatio = true;
  private sizedFor = ''; // doc id + size the pixel inputs were filled from

  protected willUpdate() {
    const doc = store.active;
    const key = doc ? `${doc.id}:${doc.width}x${doc.height}` : '';
    if (doc && key !== this.sizedFor) {
      this.sizedFor = key;
      this.resizeW = doc.width;
      this.resizeH = doc.height;
    }
  }

  render() {
    const doc = store.active;
    if (!doc) return html`<div class="empty">Open an image to see its tools here.</div>`;
    return html`${this.renderBatch()}${this.renderToolOptions()}${this.renderEffects()}${this.renderAdjust()}${this.renderImage()}${this.renderExport()}`;
  }

  // ------------------------------------------------------------ sections

  private renderBatch() {
    const n = store.docs.length;
    if (n < 2) return nothing;
    return html`<section class="batch">
      <label class="toggle">
        <input type="checkbox" .checked=${store.batch} @change=${(e: Event) => { store.batch = (e.target as HTMLInputElement).checked; store.preview = null; store.emit(); }} />
        ${icon('layers', 16)} Apply to all ${n} open images
      </label>
      <p class="hint">${store.batch
        ? 'Adjust and Image changes now affect every tab. Effects and crop still apply to this image only.'
        : 'Turn on to resize, rotate or recolour every open image at once.'}</p>
    </section>`;
  }

  private renderToolOptions() {
    const doc = store.active!;
    if (store.tool === 'crop') {
      const r = doc.cropRect;
      return html`<section aria-label="Crop options">
        <h2>${icon('crop', 14)} Crop</h2>
        <p class="hint">Drag the box or its handles. Double-click or press <kbd>Enter</kbd> to crop.</p>
        <div class="ratios" role="group" aria-label="Aspect ratio">
          ${RATIOS.map((ratio) => {
            const value = ratio.value === 'original' ? doc.width / doc.height : ratio.value;
            const pressed = value === null ? store.cropAspect === null : store.cropAspect !== null && Math.abs(store.cropAspect - value) < 1e-6;
            return html`<button aria-pressed=${pressed} @click=${() => this.setRatio(value)}>${ratio.label}</button>`;
          })}
        </div>
        <div class="readout">${r ? `${Math.round(r.w)} × ${Math.round(r.h)} px` : ''}</div>
        <div class="row">
          <button @click=${() => store.setTool('select-rect')}>Cancel</button>
          <button class="primary" @click=${() => store.applyCrop()}>${icon('crop', 16)} Crop</button>
        </div>
      </section>`;
    }
    if (store.tool === 'hand') {
      return html`<section><h2>${icon('hand', 14)} Hand</h2>
        <p class="hint">Drag to move around the image. Tip: hold <kbd>Space</kbd> with any tool to do the same.</p></section>`;
    }
    const sel = doc.selectionRect();
    return html`<section aria-label="Selection">
      <h2>Selection</h2>
      <p class="hint">${sel
        ? html`<span class="readout">${sel.w} × ${sel.h} px at ${sel.x}, ${sel.y}</span>`
        : html`Drag on the image to select an area. Hold <kbd>Shift</kbd> for a perfect square or circle.`}</p>
      <div class="grid2">
        <button @click=${() => store.selectAll()}>Select all</button>
        <button ?disabled=${!sel} @click=${() => store.setSelection(null)}>Deselect</button>
      </div>
      <button ?disabled=${!sel} @click=${() => store.applyCrop(sel ?? undefined)}>${icon('crop', 16)} Crop to selection</button>
    </section>`;
  }

  private renderEffects() {
    const doc = store.active!;
    const sel = doc.selectionRect();
    const ellipse = doc.selection?.shape === 'ellipse';
    const scope = sel ? `the ${ellipse ? 'oval' : 'rectangle'} you selected` : 'the whole image (no selection)';
    return html`<section aria-label="Blur and hide">
      <h2>Blur &amp; hide</h2>
      <p class="hint">Applies to ${scope}.</p>
      ${this.slider('Blur strength', this.blurRadius, 1, 120, (v) => (this.blurRadius = v), 'px')}
      <button @click=${() => store.effect('blur', { radius: this.blurRadius })}>${icon('blur', 16)} Blur</button>
      ${this.slider('Pixel size', this.pixelBlock, 2, 200, (v) => (this.pixelBlock = v), 'px')}
      <button @click=${() => store.effect('pixelate', { block: this.pixelBlock })}>${icon('pixelate', 16)} Pixelate</button>
      <div class="row">
        <input class="fixed" type="color" aria-label="Fill colour" .value=${this.fillColor} @input=${(e: Event) => (this.fillColor = (e.target as HTMLInputElement).value)} />
        <button @click=${() => store.effect('fill', { rgba: hexToRgba(this.fillColor) })}>${icon('fill', 16)} Fill with colour</button>
      </div>
    </section>`;
  }

  private renderAdjust() {
    const changed = this.brightness !== 100 || this.contrast !== 100;
    const doc = store.active!;
    const scope = store.batch ? `all ${store.docs.length} images` : doc.selectionRect() ? 'the selection' : 'the whole image';
    return html`<section aria-label="Adjust colours">
      <h2>Adjust ${store.batch ? html`<span class="badge">all tabs</span>` : nothing}</h2>
      <p class="hint">Applies to ${scope}.</p>
      <div class="grid2">
        <button @click=${() => store.adjust('grayscale')}>${icon('contrast', 16)} Black &amp; white</button>
        <button @click=${() => store.adjust('invert')}>Invert</button>
      </div>
      ${this.slider('Brightness', this.brightness, 0, 200, (v) => this.setBC(v, this.contrast), '%')}
      ${this.slider('Contrast', this.contrast, 0, 200, (v) => this.setBC(this.brightness, v), '%')}
      <div class="row">
        <button ?disabled=${!changed} @click=${() => this.setBC(100, 100)}>Reset</button>
        <button class="primary" ?disabled=${!changed} @click=${this.applyBC}>Apply</button>
      </div>
    </section>`;
  }

  private renderImage() {
    const doc = store.active!;
    const target = this.resizeTarget();
    return html`<section aria-label="Image size and orientation">
      <h2>Image ${store.batch ? html`<span class="badge">all tabs</span>` : nothing}</h2>
      <div class="readout">${doc.width} × ${doc.height} px · original file ${formatBytes(doc.fileSize)}</div>
      <div class="field">
        <label for="rmode">Resize by</label>
        <select id="rmode" .value=${store.batch && this.resizeMode === 'pixels' ? 'percent' : this.resizeMode} @change=${(e: Event) => (this.resizeMode = (e.target as HTMLSelectElement).value as ResizeMode)}>
          <option value="pixels" ?disabled=${store.batch}>Exact size (pixels)</option>
          <option value="percent">Percentage</option>
          <option value="longEdge">Longest side (pixels)</option>
        </select>
      </div>
      ${this.renderResizeInputs()}
      <div class="readout muted">${store.batch ? 'Each image keeps its own proportions.' : `→ ${target.width} × ${target.height} px`}</div>
      <button class="primary" @click=${this.applyResize}>${icon('resize', 16)} Resize</button>
      <div class="grid2">
        <button @click=${() => store.rotate(false)}>${icon('rotateL', 16)} Rotate left</button>
        <button @click=${() => store.rotate(true)}>${icon('rotateR', 16)} Rotate right</button>
        <button @click=${() => store.flip('h')}>${icon('flipH', 16)} Flip ↔</button>
        <button @click=${() => store.flip('v')}>${icon('flipV', 16)} Flip ↕</button>
      </div>
    </section>`;
  }

  private renderResizeInputs() {
    const mode = store.batch && this.resizeMode === 'pixels' ? 'percent' : this.resizeMode;
    if (mode === 'percent') {
      return html`<div class="field"><label for="rpct">Percent</label>
        <input id="rpct" type="number" min="1" max="1000" .value=${String(this.resizePct)} @input=${(e: Event) => (this.resizePct = Number((e.target as HTMLInputElement).value) || 0)} /></div>`;
    }
    if (mode === 'longEdge') {
      return html`<div class="field"><label for="rlong">Longest side (px)</label>
        <input id="rlong" type="number" min="1" max="30000" .value=${String(this.resizeLong)} @input=${(e: Event) => (this.resizeLong = Number((e.target as HTMLInputElement).value) || 0)} /></div>`;
    }
    const doc = store.active!;
    const ratio = doc.width / doc.height;
    return html`<div class="row">
        <div class="field"><label for="rw">Width</label>
          <input id="rw" type="number" min="1" max="30000" .value=${String(this.resizeW)} @input=${(e: Event) => {
            this.resizeW = Number((e.target as HTMLInputElement).value) || 0;
            if (this.lockRatio) this.resizeH = Math.max(1, Math.round(this.resizeW / ratio));
          }} /></div>
        <div class="field"><label for="rh">Height</label>
          <input id="rh" type="number" min="1" max="30000" .value=${String(this.resizeH)} @input=${(e: Event) => {
            this.resizeH = Number((e.target as HTMLInputElement).value) || 0;
            if (this.lockRatio) this.resizeW = Math.max(1, Math.round(this.resizeH * ratio));
          }} /></div>
      </div>
      <label class="row" style="flex:none;gap:8px;color:var(--text)">
        <input type="checkbox" class="fixed" .checked=${this.lockRatio} @change=${(e: Event) => (this.lockRatio = (e.target as HTMLInputElement).checked)} />
        <span>Keep proportions</span>
      </label>`;
  }

  private renderExport() {
    const lossy = store.exportFormat === 'image/jpeg' || store.exportFormat === 'image/webp' ||
      (store.exportFormat === 'original' && (store.active?.mime === 'image/jpeg' || store.active?.mime === 'image/webp'));
    return html`<section aria-label="Save">
      <h2>${icon('download', 14)} Save</h2>
      <div class="field">
        <label for="fmt">Format</label>
        <select id="fmt" .value=${store.exportFormat} @change=${(e: Event) => { store.exportFormat = (e.target as HTMLSelectElement).value as ExportFormat; store.emit(); }}>
          <option value="original">Same as original</option>
          <option value="image/jpeg">JPEG (smaller, photos)</option>
          <option value="image/png">PNG (lossless, transparency)</option>
          <option value="image/webp">WebP (smallest)</option>
        </select>
      </div>
      ${lossy ? this.slider('Quality', Math.round(store.exportQuality * 100), 10, 100, (v) => { store.exportQuality = v / 100; store.emit(); }, '%') : nothing}
      <button class="primary" @click=${() => store.exportActive()}>${icon('download', 16)} Save image</button>
      ${store.docs.length > 1 ? html`<button @click=${() => store.exportAll()}>Save all ${store.docs.length} images</button>` : nothing}
      <p class="hint">Files go to your Downloads folder as “name-edited”. Your originals are never changed.</p>
    </section>`;
  }

  // ------------------------------------------------------------- helpers

  private slider(label: string, value: number, min: number, max: number, set: (v: number) => void, unit: string) {
    const id = `s-${label.replace(/\W+/g, '-').toLowerCase()}`;
    return html`<div class="slider">
      <div class="top"><label for=${id}>${label}</label><output for=${id}>${value}${unit}</output></div>
      <input id=${id} type="range" min=${min} max=${max} .value=${String(value)} @input=${(e: Event) => set(Number((e.target as HTMLInputElement).value))} />
    </div>`;
  }

  private setRatio(value: number | null) {
    const doc = store.active;
    if (!doc) return;
    store.cropAspect = value;
    if (value) {
      // Re-fit the crop box to the new ratio, centred on the old box.
      const old = doc.cropRect ?? { x: 0, y: 0, w: doc.width, h: doc.height };
      const fit = centeredAspect(old.w, old.h, value);
      doc.cropRect = { x: Math.round(old.x + fit.x), y: Math.round(old.y + fit.y), w: Math.round(fit.w), h: Math.round(fit.h) };
    }
    store.emit();
  }

  private setBC(b: number, c: number) {
    this.brightness = b;
    this.contrast = c;
    store.preview = b === 100 && c === 100 ? null : { brightness: b / 100, contrast: c / 100 };
    store.emit();
  }

  private applyBC = async () => {
    await store.adjust('brightnessContrast', this.brightness / 100, this.contrast / 100);
    if (!store.preview) {
      this.brightness = 100;
      this.contrast = 100;
    }
  };

  private resizeSpec() {
    const mode = store.batch && this.resizeMode === 'pixels' ? 'percent' : this.resizeMode;
    if (mode === 'percent') return { mode, value: this.resizePct } as const;
    if (mode === 'longEdge') return { mode, value: this.resizeLong } as const;
    return { mode, width: this.resizeW, height: this.resizeH } as const;
  }

  private resizeTarget() {
    const doc = store.active!;
    return computeResize(doc.width, doc.height, this.resizeSpec());
  }

  private applyResize = () => {
    const t = this.resizeTarget();
    const MAX = 16384;
    if (t.width > MAX || t.height > MAX || t.width * t.height > 268_000_000) {
      store.toast(`That’s too large for the browser to handle (max ${MAX} px per side).`, 'error');
      return;
    }
    void store.resize(this.resizeSpec());
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'loupe-panel': LoupePanel;
  }
}
