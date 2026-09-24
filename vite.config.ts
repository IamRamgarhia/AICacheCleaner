import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    watch: {
      // Build output is not source. Watching it made the dev server hold file
      // handles inside dist-electron, which broke electron-builder's rename
      // (EPERM) whenever a build ran with `vite` open.
      ignored: ['**/dist/**', '**/dist-electron/**', '**/build/**']
    }
  }
})
