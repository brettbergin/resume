import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Served from the GitHub Pages project page at
  // https://brettbergin.github.io/resume/, so every asset URL needs the
  // /resume/ prefix. Set unconditionally so dev and preview use the same path
  // prefix as production and base-related breakage shows up before deploy.
  // If a custom domain is ever configured, this becomes '/'.
  base: '/resume/',
  plugins: [react(), tailwindcss()],
  test: {
    // Components need a DOM; the node-environment suites (data checks, the
    // deploy workflow check that reads files with node:fs) run fine in jsdom
    // too, so one environment covers the whole suite.
    environment: 'jsdom',
    // Tests import describe/it/expect from 'vitest' explicitly.
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
  },
})
