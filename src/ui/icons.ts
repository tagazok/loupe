import { svg, type SVGTemplateResult } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import {
  Circle,
  Contrast,
  Crop,
  Download,
  Droplets,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Grid3x3,
  Hand,
  ImagePlus,
  Layers,
  Lock,
  Maximize,
  PaintBucket,
  Redo2,
  RotateCcw,
  RotateCw,
  Scaling,
  Square,
  SquareDashed,
  SunMedium,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide';

type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

const ICONS = {
  circle: Circle,
  contrast: Contrast,
  crop: Crop,
  download: Download,
  blur: Droplets,
  flipH: FlipHorizontal,
  flipV: FlipVertical,
  open: FolderOpen,
  pixelate: Grid3x3,
  hand: Hand,
  imagePlus: ImagePlus,
  layers: Layers,
  lock: Lock,
  fit: Maximize,
  fill: PaintBucket,
  redo: Redo2,
  rotateL: RotateCcw,
  rotateR: RotateCw,
  resize: Scaling,
  square: Square,
  selectRect: SquareDashed,
  sun: SunMedium,
  undo: Undo2,
  close: X,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
} as unknown as Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const cache = new Map<string, string>();

function inner(name: string): string {
  let s = cache.get(name);
  if (s === undefined) {
    // Lucide icon data is static and trusted; build the SVG children once.
    s = (ICONS[name] ?? [])
      .map(([tag, attrs]) => {
        const a = Object.entries(attrs)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}="${escapeAttr(String(v))}"`)
          .join(' ');
        return `<${tag} ${a}/>`;
      })
      .join('');
    cache.set(name, s);
  }
  return s;
}

/** Inline Lucide icon. Decorative by default; pair with a visible label or aria-label on the control. */
export function icon(name: string, size = 18): SVGTemplateResult {
  return svg`<svg class="icon" xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">${unsafeSVG(inner(name))}</svg>`;
}

/** Ellipse-select icon: a dashed circle (Lucide's CircleDashed reads too much like a loader). */
export function ellipseSelectIcon(size = 18): SVGTemplateResult {
  return svg`<svg class="icon" xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.75" stroke-dasharray="3 2.6" aria-hidden="true" focusable="false">
    <ellipse cx="12" cy="12" rx="9" ry="7"/></svg>`;
}
