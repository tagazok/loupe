import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under any repo path
// (https://<user>.github.io/<repo>/) as well as at a domain root.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
} as never);
