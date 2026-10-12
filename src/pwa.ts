/** Installable-app support: service worker registration, update detection, "Open with Loupe". */

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const UPDATE_CHECK_MS = 30 * 60 * 1000;

/**
 * Register the service worker (production builds only) and call `onUpdate`
 * when a newer version has taken over. The SW activates new versions right
 * away, so this fires shortly after a deploy is detected.
 */
export function registerServiceWorker(onUpdate: (version: string) => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // A first install also triggers controllerchange; only later changes are updates.
  let hadController = !!sw.controller;

  sw.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'loupe-activated' && hadController && e.data.version !== APP_VERSION) onUpdate(e.data.version);
  });
  sw.addEventListener('controllerchange', () => {
    hadController = true;
  });
  sw.startMessages();

  void sw
    .register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((reg) => {
      // An installed app can stay open for days: look for updates when it
      // regains focus and periodically.
      const check = () => reg.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check();
      });
      setInterval(check, UPDATE_CHECK_MS);
    })
    .catch((err) => console.warn('Service worker registration failed', err));
}

interface LaunchParams {
  files: FileSystemFileHandle[];
}

/** Files opened from the OS ("Open with → Loupe") when installed (Chromium). */
export function handleLaunchFiles(open: (files: File[]) => void): void {
  const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
  lq?.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    open(files);
  });
}
