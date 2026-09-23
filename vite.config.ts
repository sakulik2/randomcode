import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base so the built site works from a subpath (GitHub Pages) as well as root.
  base: './',
  plugins: [react()],
})
