import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { build as esbuild } from 'esbuild'
import { viteSingleFile } from 'vite-plugin-singlefile'

/** Vite plugin: after UI bundle is written, compile code.ts → dist/code.js */
const buildFigmaCode = () => ({
  name: 'build-figma-code',
  async writeBundle() {
    await esbuild({
      entryPoints: ['src/code.ts'],
      bundle: true,
      outfile: 'dist/code.js',
      target: 'es2020',
      format: 'iife',
    })
    console.log('✓ Built dist/code.js (Figma plugin sandbox)')
  },
})

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    buildFigmaCode()
  ],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: 'index.html',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
  base: './',
})
