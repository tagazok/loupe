import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
/** Unique per build: semver + build timestamp. Drives the service worker update. */
const BUILD_VERSION = `${pkg.version}+${Date.now().toString(36)}`;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/** Emits dist/sw.js with this build's version and its full precache list. */
function serviceWorker(): Plugin {
  return {
    name: 'loupe-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html');
      const publicFiles = listFiles('public').map((p) => relative('public', p).split('\\').join('/'));
      const assets = ['./', ...[...built, ...publicFiles].map((f) => `./${f}`)];
      const source = readFileSync('src/sw.template.js', 'utf8')
        .replace('__VERSION__', JSON.stringify(BUILD_VERSION))
        .replace('__ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Relative base so the build works on GitHub Pages under any repo path
// (https://<user>.github.io/<repo>/) as well as at a domain root.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(BUILD_VERSION) },
  plugins: [serviceWorker()],
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
} as never);
