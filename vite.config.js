import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import peggy from 'rollup-plugin-peggy'; // or: import pegjs from 'rollup-plugin-pegjs';
// parallel commenting as 




// parallel commenting ass 
// parallel commenting asd dsds 
// parallel commenting asd dsdsd 
// buggy tokenizer ... dsdsd
export default defineConfig({
  plugins: [
    react(),
    peggy(),
  ],
  build: {
    ssr: true,                      // build for Node
    outDir: 'dist',
    rollupOptions: {
      input: 'index.jsx',         // our CLI entry
      output: {
        format: 'cjs',
        entryFileNames: 'app.js',   // => dist/cli.js
      },
      // external: ['react', 'blessed'],   // don’t bundle React or Blessed
    }
  }
});