import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { ImageDoc } from '../core/doc';
import { centeredAspect } from '../core/rectEdit';
import { computeResize, formatBytes, store } from '../store';
import { icon } from './icons';
import { StoreController } from './store-controller';
import { controls } from './styles';

type ResizeMode = 'pixels' | 'percent' | 'longEdge';
type SectionId = 'effects' | 'adjust' | 'image';

const RATIOS: { label: string; value: number | 'original' | null }[] = [
  { label: 'Free', value: null },
  { label: 'Original', value: 'original' },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

const SECTIONS_KEY = 'loupe.panel.sections';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⇧' : 'Shift+';

function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function loadSections(): Record<SectionId, boolean> {
  const defaults = { effects: true, adjust: true, image: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

/** Describe what an operation will touch, in plain words. */
function scopeText(doc: ImageDoc, allowBatch: boolean): string {
  if (allowBatch && store.batch) return `all ${store.docs.length} open images`;
  const sel = doc.selectionRect();
  if (!sel) return 'the whole image (nothing is selected)';
  const shape = doc.selection?.shape === 'ellipse' ? 'oval' : 'rectangle';
  return doc.selection?.inverted ? `everything outside the ${shape} you selected` : `the ${shape} you selected`;
}

/** Right-hand properties panel: tool options, effects, adjustments, image size. Saving lives in the top bar. */
@customElement('loupe-panel')
export class LoupePanel extends LitElement {
  static styles = [
    controls,
    css`
      :host { display: flex; flex-direction: column; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--border); }
      section, details { border-bottom: 1px solid var(--border); }
      section, .body { padding: 10px 14px 12px; display: grid; gap: 8px; }
      details > .body { padding-top: 0; }
      h2, summary { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-strong); display: flex; align-items: center; gap: 6px; }
      summary { padding: 11px 14px; cursor: pointer; list-style: none; user-select: none; }
      summary::-webkit-details-marker { display: none; }
      summary:hover { color: var(--text-strong); }
      summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
      summary .chev { margin-left: auto; transition: transform 0.15s; display: inline-flex; }
      details[open] summary .chev { transform: rotate(90deg); }
      @media (prefers-reduced-motion: reduce) { summary .chev { transition: none; } }
      .hint { font-size: 12px; color: var(--muted); margin: 0; }
      .hint strong { color: var(--text); font-weight: 600; }
      .row { display: flex; gap: 6px; align-items: center; }
      .row > * { flex: 1; }
      .row > .fixed { flex: none; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .ratios { display: flex; flex-wrap: wrap; gap: 4px; }
      .ratios button { min-height: 26px; padding: 3px 8px; font-size: 12px; }
      .slider { display: grid; gap: 2px; }
      .slider .top { display: flex; justify-content: space-between; }
      .slider output { font: 12px var(--mono); color: var(--text); }
      .effect { display: grid; gap: 2px; }
      .effect .line { display: flex; gap: 8px; align-items: center; }
      .effect .line input[type='range'] { flex: 1; }
      .effect .line button { flex: none; min-width: 92px; }
      .previewing { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text); background: var(--accent-subtle); border: 1px solid var(--accent); border-radius: 6px; padding: 5px 6px 5px 10px; }
      .previewing span { flex: 1; }
      .previewing button { min-height: 24px; padding: 2px 8px; font-size: 12px; }
      .field { display: grid; gap: 3px; }
      .batch { background: var(--accent-subtle); }
      .batch label.toggle { display: flex; gap: 8px; align-items: center; color: var(--text); font-size: 13px; font-weight: 600; cursor: pointer; }
      .empty { padding: 24px 16px; color: var(--muted); }
      .readout { font: 12px var(--mono); color: var(--text); }
      .badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 99px; background: var(--accent); color: var(--on-accent); letter-spacing: 0; text-transform: none; }
      .kbd-hint { margin-left: auto; font: 11px var(--mono); color: var(--muted); }
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
  @state() private open = loadSections();
  private sizedFor = ''; // doc id + size the pixel inputs were filled from

  protected willUpdate() {
    const doc = store.active;
    const key = doc ? `${doc.id}:${doc.width}x${doc.height}` : '';
    if (doc && key !== this.sizedFor) {
      this.sizedFor = key;
      this.resizeW = doc.width;
      this.resizeH = doc.height;
    }
    // Brightness/contrast sliders follow a cleared preview (Apply, Esc, tab switch).
    if (store.preview?.kind !== 'bc' && (this.brightness !== 100 || this.contrast !== 100)) {
      this.brightness = 100;
      this.contrast = 100;
    }
  }

  render() {
    const doc = store.active;
    if (!doc) return html`<div class="empty">Open an image to see its tools here.</div>`;
    return html`${this.renderBatch()}${this.renderToolOptions(doc)}
      ${this.section('effects', 'Blur & hide', this.renderEffects(doc))}
      ${this.section('adjust', html`Adjust ${store.batch ? html`<span class="badge">all tabs</span>` : nothing}`, this.renderAdjust(doc))}
      ${this.section('image', html`Image ${store.batch ? html`<span class="badge">all tabs</span>` : nothing}`, this.renderImage(doc))}`;
  }

  private section(id: SectionId, title: unknown, body: TemplateResult) {
    return html`<details ?open=${this.open[id]} @toggle=${(e: Event) => this.onToggle(id, (e.target as HTMLDetailsElement).open)}>
      <summary>${title}<span class="chev">${icon('chevron', 14)}</span></summary>
      <div class="body">${body}</div>
    </details>`;
  }

  private onToggle(id: SectionId, isOpen: boolean) {
    if (this.open[id] === isOpen) return;
    this.open = { ...this.open, [id]: isOpen };
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(this.open));
    } catch {
      /* private mode: just don't remember */
    }
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
        ? 'Adjust and Image changes now affect every tab. Blur & hide and crop still apply to this image only.'
        : 'Turn on to resize, rotate or recolour every open image at once.'}</p>
    </section>`;
  }

  private renderToolOptions(doc: ImageDoc) {
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
    const inverted = !!doc.selection?.inverted;
    return html`<section aria-label="Selection">
      <h2>Selection</h2>
      <p class="hint">${sel
        ? html`<span class="readout">${sel.w} × ${sel.h} px at ${sel.x}, ${sel.y}</span>${inverted ? html` · <strong>inverted</strong>` : nothing}`
        : html`Drag on the image to select an area. Hold <kbd>Shift</kbd> for a perfect square or circle.`}</p>
      <div class="grid2">
        <button @click=${() => store.selectAll()}>Select all</button>
        <button ?disabled=${!sel} @click=${() => store.setSelection(null)}>Deselect</button>
      </div>
      <button ?disabled=${!sel} aria-pressed=${inverted} @click=${() => store.invertSelection()}
        title="Work on everything except the selected area — e.g. blur the background around a face">
        ${icon('invert', 16)} Everything except selection <span class="kbd-hint">${MOD}${SHIFT}I</span>
      </button>
      <button ?disabled=${!sel || inverted} @click=${() => store.applyCrop(sel ?? undefined)}>${icon('crop', 16)} Crop to selection</button>
    </section>`;
  }

  private renderEffects(doc: ImageDoc) {
    const pv = store.preview;
    const previewing = pv && pv.kind !== 'bc';
    return html`
      <p class="hint">Applies to ${scopeText(doc, false)}.</p>
      ${this.effect('Blur strength', 'blur', this.blurRadius, 1, 120, (v) => {
        this.blurRadius = v;
        store.setPreview({ kind: 'blur', radius: v });
      }, pv?.kind === 'blur', () => store.effect('blur', { radius: this.blurRadius }), 'Blur')}
      ${this.effect('Pixel size', 'pixelate', this.pixelBlock, 2, 200, (v) => {
        this.pixelBlock = v;
        store.setPreview({ kind: 'pixelate', block: v });
      }, pv?.kind === 'pixelate', () => store.effect('pixelate', { block: this.pixelBlock }), 'Pixelate')}
      ${previewing
        ? html`<div class="previewing" role="status"><span>Previewing. Click <strong>${pv.kind === 'blur' ? 'Blur' : 'Pixelate'}</strong> to keep it.</span>
            <button class="ghost" @click=${() => store.setPreview(null)}>Cancel <kbd>Esc</kbd></button></div>`
        : nothing}
      <div class="row">
        <input class="fixed" type="color" aria-label="Fill colour" .value=${this.fillColor} @input=${(e: Event) => (this.fillColor = (e.target as HTMLInputElement).value)} />
        <button @click=${() => store.effect('fill', { rgba: hexToRgba(this.fillColor) })}>${icon('fill', 16)} Fill with colour</button>
      </div>`;
  }

  /** Slider + apply button on one line; moving the slider previews the effect live. */
  private effect(
    label: string,
    iconName: string,
    value: number,
    min: number,
    max: number,
    set: (v: number) => void,
    active: boolean,
    apply: () => void,
    applyLabel: string,
  ) {
    const id = `fx-${iconName}`;
    return html`<div class="effect">
      <div class="slider"><div class="top"><label for=${id}>${label}</label><output for=${id}>${value}px</output></div></div>
      <div class="line">
        <input id=${id} type="range" min=${min} max=${max} .value=${String(value)}
          @input=${(e: Event) => set(Number((e.target as HTMLInputElement).value))}
          @pointerdown=${() => set(value)} />
        <button class=${active ? 'primary' : ''} @click=${apply}>${icon(iconName, 16)} ${applyLabel}</button>
      </div>
    </div>`;
  }

  private renderAdjust(doc: ImageDoc) {
    const changed = this.brightness !== 100 || this.contrast !== 100;
    return html`
      <p class="hint">Applies to ${scopeText(doc, true)}.</p>
      <div class="grid2">
        <button @click=${() => store.adjust('grayscale')}>${icon('contrast', 16)} Black &amp; white</button>
        <button @click=${() => store.adjust('invert')}>Invert colours</button>
      </div>
      ${this.slider('Brightness', this.brightness, 0, 200, (v) => this.setBC(v, this.contrast), '%')}
      ${this.slider('Contrast', this.contrast, 0, 200, (v) => this.setBC(this.brightness, v), '%')}
      <div class="row">
        <button ?disabled=${!changed} @click=${() => this.setBC(100, 100)}>Reset</button>
        <button class="primary" ?disabled=${!changed} @click=${this.applyBC}>Apply</button>
      </div>`;
  }

  private renderImage(doc: ImageDoc) {
    const target = this.resizeTarget(doc);
    return html`
      <div class="readout">${doc.width} × ${doc.height} px · original file ${formatBytes(doc.fileSize)}</div>
      <div class="field">
        <label for="rmode">Resize by</label>
        <select id="rmode" .value=${store.batch && this.resizeMode === 'pixels' ? 'percent' : this.resizeMode} @change=${(e: Event) => (this.resizeMode = (e.target as HTMLSelectElement).value as ResizeMode)}>
          <option value="pixels" ?disabled=${store.batch}>Exact size (pixels)</option>
          <option value="percent">Percentage</option>
          <option value="longEdge">Longest side (pixels)</option>
        </select>
      </div>
      ${this.renderResizeInputs(doc)}
      <div class="row">
        <span class="readout muted">${store.batch ? 'Each image keeps its own proportions.' : `→ ${target.width} × ${target.height} px`}</span>
        <button class="primary fixed" @click=${() => this.applyResize(doc)}>${icon('resize', 16)} Resize</button>
      </div>
      <div class="grid2">
        <button @click=${() => store.rotate(false)}>${icon('rotateL', 16)} Rotate left</button>
        <button @click=${() => store.rotate(true)}>${icon('rotateR', 16)} Rotate right</button>
        <button @click=${() => store.flip('h')}>${icon('flipH', 16)} Flip ↔</button>
        <button @click=${() => store.flip('v')}>${icon('flipV', 16)} Flip ↕</button>
      </div>`;
  }

  private renderResizeInputs(doc: ImageDoc) {
    const mode = store.batch && this.resizeMode === 'pixels' ? 'percent' : this.resizeMode;
    if (mode === 'percent') {
      return html`<div class="field"><label for="rpct">Percent</label>
        <input id="rpct" type="number" min="1" max="1000" .value=${String(this.resizePct)} @input=${(e: Event) => (this.resizePct = Number((e.target as HTMLInputElement).value) || 0)} /></div>`;
    }
    if (mode === 'longEdge') {
      return html`<div class="field"><label for="rlong">Longest side (px)</label>
        <input id="rlong" type="number" min="1" max="30000" .value=${String(this.resizeLong)} @input=${(e: Event) => (this.resizeLong = Number((e.target as HTMLInputElement).value) || 0)} /></div>`;
    }
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
    store.setPreview(b === 100 && c === 100 ? null : { kind: 'bc', brightness: b / 100, contrast: c / 100 });
  }

  private applyBC = async () => {
    await store.adjust('brightnessContrast', this.brightness / 100, this.contrast / 100);
  };

  private resizeSpec() {
    const mode = store.batch && this.resizeMode === 'pixels' ? 'percent' : this.resizeMode;
    if (mode === 'percent') return { mode, value: this.resizePct } as const;
    if (mode === 'longEdge') return { mode, value: this.resizeLong } as const;
    return { mode, width: this.resizeW, height: this.resizeH } as const;
  }

  private resizeTarget(doc: ImageDoc) {
    return computeResize(doc.width, doc.height, this.resizeSpec());
  }

  private applyResize(doc: ImageDoc) {
    const t = this.resizeTarget(doc);
    const MAX = 16384;
    if (t.width > MAX || t.height > MAX || t.width * t.height > 268_000_000) {
      store.toast(`That’s too large for the browser to handle (max ${MAX} px per side).`, 'error');
      return;
    }
    void store.resize(this.resizeSpec());
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'loupe-panel': LoupePanel;
  }
}
