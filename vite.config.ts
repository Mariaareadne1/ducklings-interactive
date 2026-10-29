import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // three.js is most of the bundle (~230 kB gzipped total), loaded once
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: Number(process.env.PORT) || 5392,
    strictPort: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
} as Parameters<typeof defineConfig>[0]);
