import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

import { resumePdf } from './vite/resume-pdf.ts'
import { themeScript } from './vite/theme-script.ts'

// https://vite.dev/config/
export default defineConfig({
  // Served from the GitHub Pages project page at
  // https://brettbergin.github.io/resume/, so every asset URL needs the
  // /resume/ prefix. Set unconditionally so dev and preview use the same path
  // prefix as production and base-related breakage shows up before deploy.
  // If a custom domain is ever configured, this becomes '/'.
  base: '/resume/',
  // `resumePdf` publishes the repo-root resume.pdf as dist/resume.pdf, so the
  // hero's download link resolves on Pages without a second committed copy.
  // `themeScript` injects the pre-paint theme script into index.html's
  // <head> so it stays generated from src/theme.ts instead of hand-typed.
  plugins: [react(), tailwindcss(), resumePdf(), themeScript()],
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
