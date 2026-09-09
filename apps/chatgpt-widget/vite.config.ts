import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/widget-v1.js',
        chunkFileNames: 'assets/widget-v1-[name].js',
        assetFileNames: 'assets/widget-v1-[name][extname]',
      },
    },
  },
});
