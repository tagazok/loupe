# Loupe

A tiny Photoshop-style image editor that runs entirely in the browser. No server, no uploads: your images never leave your computer.

## Features

- Drag and drop one or many images (or paste with ⌘V). Each one opens in its own tab.
- Rectangle and oval selection with handles. Hold Shift for a square or circle.
- **Everything except the selection** (⌘⇧I): blur or pixelate a background around a face, or recolour everything but one area.
- Blur, pixelate or fill the selection (or the whole image), with a **live preview** as you move the slider.
- Black & white, invert, brightness/contrast with a live preview.
- Crop with aspect-ratio presets (free, original, 1:1, 4:3, 3:2, 16:9, 9:16).
- High-quality Lanczos resize by exact pixels, percentage or longest side.
- Rotate and flip.
- **Apply to all open images:** batch resize, rotate, flip or recolour every tab, then "Save all".
- Undo/redo for each tab. Zoom with pinch or ⌘-scroll, pan by scrolling or holding Space.
- Save from the top bar (⌘S) as the original format, JPEG, PNG or WebP, with a quality setting. Saved files are named `name-edited.ext`. In Chrome, Edge and Arc, **Save as…** (⌘⇧S) lets you choose the name and folder, and **Save all to a folder…** writes every tab to a folder you pick.
- Panel sections collapse, and Loupe remembers which ones you keep open.
- **Your tabs come back.** Close Loupe and reopen it on the same computer and browser, and your open images return with their edits. Undo history is not kept.
- **Installable app**, which also works offline. When installed in Chrome, Edge or Arc, you can "Open with → Loupe" from Finder.

## Keeping images between sessions

Open tabs are stored in the browser's IndexedDB, on this computer only. An unedited image is stored as its original file. An edited image is re-saved as a lossless PNG about a second after your last change, in a background worker. The status bar shows "Kept on this computer" and how much space it uses. Closing a tab deletes its stored copy.

Safari can clear a website's data if you haven't visited for 7 days. Installing Loupe as an app (or using Chrome) avoids that.

## Updates (service worker)

Each build gets a unique version (`<semver>+<build id>`), stamped into `sw.js`. Updates are designed never to get stuck:

- `sw.js` changes on every deploy, and it's registered with `updateViaCache: 'none'`, so the browser always notices a new version.
- The page (`index.html`) is loaded **network-first**: opening Loupe while online always gets the latest version. The cache is only used offline.
- A new service worker activates immediately and removes old caches. Already-open windows get a "new version — Reload now" banner, and your tabs survive the reload.
- An open installed app checks for updates whenever it regains focus, and every 30 minutes.
- GitHub Pages' CDN can take up to about 10 minutes to serve a new `sw.js` after a deploy.

To release a new version, bump `version` in `package.json` (shown in the status bar) and merge to `main`. A new build id is generated even if you don't bump it.

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
