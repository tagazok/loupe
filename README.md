# Loupe

A tiny Photoshop-style image editor that runs entirely in the browser. No server, no uploads: your images never leave your computer.

## Features

- Drag and drop one or many images (or paste with ⌘V). Each one opens in its own tab.
- Rectangle and oval selection with handles. Hold Shift for a square or circle.
- Blur, pixelate or fill the selection (or the whole image).
- Black & white, invert, brightness/contrast with a live preview.
- Crop with aspect-ratio presets (free, original, 1:1, 4:3, 3:2, 16:9, 9:16).
- High-quality Lanczos resize by exact pixels, percentage or longest side.
- Rotate and flip.
- **Apply to all open images:** batch resize, rotate, flip or recolour every tab, then "Save all".
- Undo/redo for each tab. Zoom with pinch or ⌘-scroll, pan by scrolling or holding Space.
- Save as the original format, JPEG, PNG or WebP, with a quality setting. Saved files are named `name-edited.ext`.

## How it handles big photos

Heavy pixel work runs in a pool of Web Workers, so the interface never freezes. Edits to a selection store only the affected region in undo history. Each tab keeps up to 768 MB of undo history, and the oldest steps are dropped beyond that. Batch edits process at most two images at a time to keep memory bounded.

WebAssembly isn't used. Plain TypeScript in workers handles a 24-megapixel image in about a second per operation, which made a Rust/WASM build step unnecessary.

## Limits

- Saving re-encodes through the browser, so EXIF metadata (camera info, GPS) is **not** kept. Phone photos are rotated upright when opened.
- HEIC opens only in browsers that support it natively (Safari).
- The browser caps canvas size at roughly 16,384 px per side.

## Develop

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm test         # unit tests for pixel ops and selection geometry
npm run build    # typecheck + production build into dist/
```

## Deploy

Push to `main` on GitHub, then set **Settings → Pages → Source: GitHub Actions**. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes `dist/`. The build uses relative paths, so it works under any repository name.

Stack: Lit, Vite, TypeScript and Lucide icons.
