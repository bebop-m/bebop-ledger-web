import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';

const stablePwaAssets = [
  'manifest.webmanifest',
  'assets/pwa-icon-192-v2.png',
  'assets/pwa-icon-512-v2.png',
  'assets/pwa-icon-maskable-512-v2.png'
];

function emitStablePwaAssets() {
  return {
    name: 'emit-stable-pwa-assets',
    apply: 'build',
    async buildStart() {
      for (const fileName of stablePwaAssets) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: await readFile(new URL(fileName, import.meta.url))
        });
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [emitStablePwaAssets()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true
  }
});
