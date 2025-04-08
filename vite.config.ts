import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // Configure server options if needed, e.g., port
    // port: 3000
  },
  // Ensure local linked packages are handled correctly
  optimizeDeps: {
    include: ['applesauce-core', 'applesauce-loaders', 'rx-nostr', 'nostr-tools', 'rxjs'],
    // If issues persist with linked deps, you might need 'exclude' or further config
  },
  build: {
    // Configure build options if needed
  }
})