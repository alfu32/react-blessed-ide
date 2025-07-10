import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    ssr: true,                      // build for Node
    outDir: 'dist',
    rollupOptions: {
      input: 'index.jsx',         // our CLI entry
      output: {
        format: 'cjs',
        entryFileNames: 'app.js',   // => dist/cli.js
      },
      external: ['react', 'blessed'],   // don’t bundle React or Ink
    }
  }
});