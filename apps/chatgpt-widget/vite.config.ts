import { defineConfig } from 'vite';

const assetVersion = '4';

export default defineConfig({
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: `assets/widget-v${assetVersion}.js`,
        chunkFileNames: `assets/widget-v${assetVersion}-[name].js`,
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css')
            ? `assets/widget-v${assetVersion}.css`
            : `assets/widget-v${assetVersion}-[name][extname]`,
      },
    },
  },
});
