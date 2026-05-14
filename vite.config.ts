/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    // ffmpeg.wasm loads its worker from its own package, prebundling breaks that
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  },
  server: {
    watch: {
      // media people drop next to the checkout must not trigger reloads
      ignored: ['**/*.mp4', '**/*.mov', '**/*.mkv', '**/*.webm', '**/*.wav', '**/*.mp3', '**/*.braincut']
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
});
