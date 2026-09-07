import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from the GitHub Pages project page at
  // https://brettbergin.github.io/resume/, so every asset URL needs the
  // /resume/ prefix. Set unconditionally so dev and preview use the same path
  // prefix as production and base-related breakage shows up before deploy.
  // If a custom domain is ever configured, this becomes '/'.
  base: '/resume/',
  plugins: [react(), tailwindcss()],
})
