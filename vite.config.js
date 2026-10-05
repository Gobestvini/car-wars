import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { rollupOptions: { output: { manualChunks: { three: ['three', 'three/addons/loaders/GLTFLoader.js'], physics: ['cannon-es'] } } } },
});
