import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: el build funciona igual en Vercel, Netlify o una subcarpeta.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
