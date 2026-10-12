import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { formatBytes, store, type Tool } from '../store';
import { APP_VERSION, handleLaunchFiles, registerServiceWorker } from '../pwa';
import { ellipseSelectIcon, icon } from './icons';
import './loupe-canvas';
import './loupe-panel';
import { StoreController } from './store-controller';
import { controls } from './styles';

const TOOLS: { id: Tool; label: string; key: string; render: () => unknown }[] = [
  { id: 'select-rect', label: 'Rectangle select', key: 'M', render: () => icon('selectRect', 20) },
  { id: 'select-ellipse', label: 'Oval select', key: 'E', render: () => ellipseSelectIcon(20) },
  { id: 'crop', label: 'Crop', key: 'C', render: () => icon('crop', 20) },
  { id: 'hand', label: 'Hand (move around)', key: 'H', render: () => icon('hand', 20) },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

/** App shell: tabs, tool rail, canvas, panel, status bar, drag-and-drop and shortcuts. */
@customElement('loupe-app')
export class LoupeApp extends LitElement {
  static styles = [
    controls,
    css`
      :host {
        display: grid; height: 100vh; width: 100vw; overflow: hidden;
        grid-template-columns: 52px 1fr 288px; grid-template-rows: 40px 1fr 26px;
        grid-template-areas: 'tabs tabs tabs' 'rail canvas panel' 'status status status';
        background: var(--bg);
      }
      header { grid-area: tabs; display: flex; align-items: stretch; background: var(--chrome); border-bottom: 1px solid var(--border); min-width: 0; }
      .brand { display: flex; align-items: center; gap: 6px; padding: 0 14px; font-weight: 700; color: var(--text-strong); flex: none; }
      .brand svg { color: var(--accent); }
      .tabs { display: flex; overflow-x: auto; min-width: 0; flex: 1; scrollbar-width: thin; }
      .tab {
        display: flex; align-items: center; gap: 6px; max-width: 220px; min-width: 110px; padding: 0 6px 0 12px;
        border-right: 1px solid var(--border); color: var(--muted); cursor: pointer; flex: none; position: relative;
        background: transparent; border-radius: 0; border-top: 0; border-left: 0; border-bottom: 0; min-height: 0;
        justify-content: flex-start;
      }
      .tab[aria-selected='true'] { background: var(--bg); color: var(--text-strong); }
      .tab[aria-selected='true']::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--accent); }
      .tab .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; }
      .tab .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
      .tab .x { width: 22px; height: 22px; min-height: 0; padding: 0; border: 0; background: transparent; border-radius: 4px; color: var(--muted); }
      .tab .x:hover { background: var(--btn-hover); color: var(--text); }
      .actions { display: flex; align-items: center; gap: 4px; padding: 0 8px; flex: none; }
      .actions button { min-height: 28px; padding: 4px 8px; }

      nav.rail { grid-area: rail; background: var(--chrome); border-right: 1px solid var(--border); display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; }
      nav.rail .sep { width: 28px; height: 1px; background: var(--border); margin: 6px 0; }
      nav.rail button { width: 38px; height: 38px; padding: 0; border-color: transparent; background: transparent; position: relative; }
      nav.rail button:hover:not(:disabled) { background: var(--btn-hover); }
      nav.rail button[aria-pressed='true'] { background: var(--accent-subtle); border-color: var(--accent); color: var(--text-strong); }
      /* Styled tooltip */
      nav.rail button[data-tip]:hover::after, nav.rail button[data-tip]:focus-visible::after {
        content: attr(data-tip); position: absolute; left: calc(100% + 8px); top: 50%; transform: translateY(-50%);
        background: var(--tooltip); color: var(--tooltip-fg); padding: 5px 8px; border-radius: 6px; white-space: nowrap;
        font-size: 12px; z-index: 20; pointer-events: none; box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      }

      loupe-canvas { grid-area: canvas; min-width: 0; min-height: 0; }
      loupe-panel { grid-area: panel; min-height: 0; }
      .empty-wrap { grid-area: canvas; display: grid; place-items: center; background: var(--canvas-bg); padding: 24px; }
      .empty-card {
        max-width: 460px; text-align: center; padding: 40px 32px; border: 2px dashed var(--border-strong); border-radius: 16px;
        display: grid; gap: 12px; justify-items: center; color: var(--text); background: var(--panel);
      }
      .empty-card h1 { margin: 0; font-size: 20px; color: var(--text-strong); }
      .empty-card p { margin: 0; color: var(--muted); }
      .empty-card .big { color: var(--accent); }
      .shortcuts { display: grid; grid-template-columns: auto auto; gap: 4px 14px; font-size: 12px; color: var(--muted); text-align: left; margin-top: 8px; }

      footer { grid-area: status; display: flex; align-items: center; gap: 16px; padding: 0 12px; background: var(--chrome); border-top: 1px solid var(--border); font: 12px var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; }
      footer .zoom { display: flex; align-items: center; gap: 2px; }
      footer .zoom button { min-height: 20px; height: 20px; padding: 0 4px; border: 0; background: transparent; }
      footer .busy { color: var(--text); display: flex; align-items: center; gap: 6px; margin-left: auto; }
      .spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--border-strong); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }

      .drop {
        position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; pointer-events: none;
        background: color-mix(in srgb, var(--accent) 18%, transparent); border: 3px dashed var(--accent);
      }
      .drop div { background: var(--panel); color: var(--text-strong); padding: 18px 26px; border-radius: 12px; font-size: 16px; font-weight: 600; display: flex; gap: 10px; align-items: center; box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
      .toasts { position: fixed; bottom: 38px; left: 50%; transform: translateX(-50%); display: grid; gap: 6px; z-index: 60; }
      .toast { background: var(--tooltip); color: var(--tooltip-fg); padding: 8px 14px; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,0.35); font-size: 13px; }
      .toast.error { background: var(--danger); color: #fff; }
      .update {
        position: fixed; top: 48px; left: 50%; transform: translateX(-50%); z-index: 70; display: flex; align-items: center; gap: 10px;
        background: var(--panel); color: var(--text-strong); border: 1px solid var(--accent); border-radius: 10px;
        padding: 8px 8px 8px 14px; box-shadow: 0 10px 34px rgba(0,0,0,0.45); font-size: 13px;
      }
      footer .keep { display: flex; align-items: center; gap: 6px; }
      footer .keep .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
      footer .keep.saving .dot { background: var(--warn); }
      footer .keep.error .dot { background: var(--danger); }
      footer .version { margin-left: auto; opacity: 0.7; }
      footer .busy + .version { margin-left: 0; }
      input[type='file'] { display: none; }
    `,
  ];

  readonly ctrl = new StoreController(this);
  @state() private dragging = false;
  /** Set when a newer version of Loupe has been installed in the background. */
  @state() private updateVersion: string | null = null;
  /** Chromium's deferred install prompt, when the app can be installed. */
  @state() private installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
  @query('input[type=file]') private fileInput!: HTMLInputElement;
  private dragDepth = 0;

  connectedCallback() {
    super.connectedCallback();
    void store.restore();
    registerServiceWorker((version) => (this.updateVersion = version));
    handleLaunchFiles((files) => void store.openFiles(files));
    window.addEventListener('beforeinstallprompt', this.onInstallPrompt);
    window.addEventListener('appinstalled', this.onInstalled);
    window.addEventListener('dragenter', this.onDragEnter);
    window.addEventListener('dragover', this.onDragOver);
    window.addEventListener('dragleave', this.onDragLeave);
    window.addEventListener('drop', this.onDrop);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('paste', this.onPaste);
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('dragenter', this.onDragEnter);
    window.removeEventListener('dragover', this.onDragOver);
    window.removeEventListener('dragleave', this.onDragLeave);
    window.removeEventListener('drop', this.onDrop);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('paste', this.onPaste);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('beforeinstallprompt', this.onInstallPrompt);
    window.removeEventListener('appinstalled', this.onInstalled);
  }

  private onInstallPrompt = (e: Event) => {
    e.preventDefault();
    this.installPrompt = e as Event & { prompt(): Promise<void> };
  };

  private onInstalled = () => {
    this.installPrompt = null;
    store.toast('Loupe is installed. You can open it from your Dock or app launcher.');
  };

  private install = async () => {
    const p = this.installPrompt;
    if (!p) return;
    this.installPrompt = null;
    await p.prompt();
  };

  private reloadForUpdate = () => {
    if (store.keeper.pending) {
      store.toast('Finishing saving your images… try again in a second.');
      return;
    }
    location.reload();
  };

  render() {
    const doc = store.active;
    return html`
      <header>
        <div class="brand">${icon('imagePlus', 18)} Loupe</div>
        <div class="tabs" role="tablist" aria-label="Open images">
          ${store.docs.map(
            (d) => html`<div class="tab" role="tab" tabindex="0" aria-selected=${d.id === store.activeId} title=${d.name}
                @click=${() => store.setActive(d.id)}
                @keydown=${(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && store.setActive(d.id)}
                @auxclick=${(e: MouseEvent) => e.button === 1 && store.close(d.id)}>
                <span class="name">${d.name}</span>
                ${d.dirty ? html`<span class="dot" aria-label="unsaved changes"></span>` : nothing}
                <button class="x" aria-label=${`Close ${d.name}`} @click=${(e: Event) => { e.stopPropagation(); store.close(d.id); }}>${icon('close', 14)}</button>
              </div>`,
          )}
        </div>
        <div class="actions">
          ${this.installPrompt ? html`<button @click=${this.install} title="Install Loupe as an app on this computer">${icon('download', 16)} Install app</button>` : nothing}
          <button class="ghost" aria-label="Undo" title="Undo (${MOD}Z)" ?disabled=${!doc?.canUndo} @click=${() => store.undo()}>${icon('undo', 16)}</button>
          <button class="ghost" aria-label="Redo" title="Redo (${MOD}⇧Z)" ?disabled=${!doc?.canRedo} @click=${() => store.redo()}>${icon('redo', 16)}</button>
          <button @click=${this.pickFiles}>${icon('open', 16)} Open</button>
        </div>
      </header>

      <nav class="rail" aria-label="Tools">
        ${TOOLS.map(
          (t) => html`<button aria-label=${t.label} data-tip=${`${t.label}  (${t.key})`} aria-pressed=${store.tool === t.id}
              ?disabled=${!doc} @click=${() => store.setTool(t.id)}>${t.render()}</button>`,
        )}
        <div class="sep"></div>
        <button aria-label="Fit image to window" data-tip=${`Fit to window (${MOD}0)`} ?disabled=${!doc} @click=${() => this.zoom('fit')}>${icon('fit', 18)}</button>
      </nav>

      ${doc ? html`<loupe-canvas></loupe-canvas>` : this.renderEmpty()}
      <loupe-panel></loupe-panel>
      ${this.renderStatus()}

      ${this.dragging ? html`<div class="drop" aria-hidden="true"><div>${icon('imagePlus', 22)} Drop to open — each image gets its own tab</div></div>` : nothing}
      ${this.updateVersion
        ? html`<div class="update" role="alert">
            <span>A new version of Loupe is ready. Your open images will still be here after reloading.</span>
            <button class="primary" @click=${this.reloadForUpdate}>Reload now</button>
            <button class="ghost" aria-label="Later" @click=${() => (this.updateVersion = null)}>${icon('close', 14)}</button>
          </div>`
        : nothing}
      <div class="toasts" role="status" aria-live="polite">
        ${store.toasts.map((t) => html`<div class="toast ${t.kind}">${t.text}</div>`)}
      </div>
      <input type="file" accept="image/*" multiple @change=${this.onFilePicked} />
    `;
  }

  private renderEmpty() {
    return html`<div class="empty-wrap">
      <div class="empty-card">
        <span class="big">${icon('imagePlus', 48)}</span>
        <h1>Drop images here</h1>
        <p>Drag one or several photos onto this window. Each one opens in its own tab.</p>
        <button class="primary" @click=${this.pickFiles}>${icon('open', 16)} Choose images…</button>
        <p style="font-size:12px">Your images never leave your computer — everything happens in this browser tab.</p>
        <div class="shortcuts" aria-label="Keyboard shortcuts">
          <kbd>M</kbd><span>Rectangle select</span>
          <kbd>E</kbd><span>Oval select</span>
          <kbd>C</kbd><span>Crop</span>
          <kbd>Space</kbd><span>Hold and drag to move around</span>
          <kbd>${MOD}Z</kbd><span>Undo</span>
          <kbd>${MOD}S</kbd><span>Save image</span>
          <kbd>${MOD}V</kbd><span>Paste an image from the clipboard</span>
        </div>
      </div>
    </div>`;
  }

  private renderKeep() {
    const k = store.keeper;
    if (k.state === 'unavailable' || store.docs.length === 0) return nothing;
    const used = k.usedBytes != null ? ` · ${formatBytes(k.usedBytes)}` : '';
    const [cls, text, tip] =
      k.state === 'error'
        ? ['error', 'Not kept', 'Some images could not be stored in this browser and will be gone after closing Loupe.']
        : k.state === 'saving' || k.pending
          ? ['saving', 'Keeping…', 'Storing your latest changes on this computer.']
          : ['', `Kept on this computer${used}`, 'Your open images will still be here when you reopen Loupe. Closing a tab forgets it. Undo history is not kept.'];
    return html`<span class="keep ${cls}" title=${tip}><span class="dot"></span>${text}</span>`;
  }

  private renderStatus() {
    const doc = store.active;
    const version = html`<span class="version" title="Loupe version">v${APP_VERSION.split('+')[0]}</span>`;
    if (!doc) {
      return html`<footer>${store.busy ? html`<span class="busy"><span class="spinner"></span>${store.busy}…</span>` : html`<span>No image open</span>`}${version}</footer>`;
    }
    const zoom = doc.view ? Math.round(doc.view.zoom * 1000) / 10 : 100;
    return html`<footer>
      <span class="zoom">
        <button aria-label="Zoom out" @click=${() => this.zoom('out')}>${icon('zoomOut', 14)}</button>
        <span>${zoom}%</span>
        <button aria-label="Zoom in" @click=${() => this.zoom('in')}>${icon('zoomIn', 14)}</button>
        <button aria-label="Zoom to 100%" @click=${() => this.zoom(1)}>1:1</button>
      </span>
      <span>${doc.width} × ${doc.height} px</span>
      <span>${formatBytes(doc.fileSize)} file</span>
      <span>${store.cursor ? `x ${store.cursor.x}, y ${store.cursor.y}` : ''}</span>
      ${this.renderKeep()}
      ${store.busy ? html`<span class="busy"><span class="spinner"></span>${store.busy}…</span>` : nothing}
      ${version}
    </footer>`;
  }

  // ---------------------------------------------------------------- files

  private pickFiles = () => this.fileInput.click();

  private onFilePicked = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void store.openFiles(files);
  };

  private hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
  }

  private onDragEnter = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.dragging = true;
  };

  private onDragOver = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  private onDragLeave = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragging = false;
  };

  private onDrop = (e: DragEvent) => {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = 0;
    this.dragging = false;
    void store.openFiles(Array.from(e.dataTransfer?.files ?? []));
  };

  private onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();
    const named = files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}-${i + 1}.png`, { type: f.type }));
    void store.openFiles(named);
  };

  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    // Open images are kept automatically; only warn while a save is still being written.
    if (store.keeper.pending) e.preventDefault();
  };

  // ------------------------------------------------------------ shortcuts

  private zoom(detail: 'fit' | 'in' | 'out' | number) {
    store.dispatchEvent(new CustomEvent('zoom', { detail }));
  }

  private onKey = (e: KeyboardEvent) => {
    const path = e.composedPath();
    const typing = path.some((el) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'));
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (mod && k === 'o') { e.preventDefault(); this.pickFiles(); return; }
    if (!store.active) return;
    if (mod && k === 's') { e.preventDefault(); void store.exportActive(); return; }
    if (typing) return;

    if (mod && k === 'z') { e.preventDefault(); void (e.shiftKey ? store.redo() : store.undo()); return; }
    if (mod && k === 'y') { e.preventDefault(); void store.redo(); return; }
    if (mod && k === 'a') { e.preventDefault(); store.selectAll(); return; }
    if (mod && k === 'd') { e.preventDefault(); store.setSelection(null); return; }
    if (mod && k === '0') { e.preventDefault(); this.zoom('fit'); return; }
    if (mod && k === '1') { e.preventDefault(); this.zoom(1); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); this.zoom('in'); return; }
    if (mod && k === '-') { e.preventDefault(); this.zoom('out'); return; }
    if (mod || e.altKey) return;

    if (k === 'escape') {
      if (store.tool === 'crop') store.setTool('select-rect');
      else store.setSelection(null);
      return;
    }
    if (k === 'enter' && store.tool === 'crop') { e.preventDefault(); void store.applyCrop(); return; }
    const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
    if (tool) store.setTool(tool.id);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'loupe-app': LoupeApp;
  }
}
