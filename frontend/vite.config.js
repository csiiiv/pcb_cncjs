import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The CNCjs server (Socket.IO 2 + Express) runs on :8000. During development we
// proxy both the REST API and the Socket.IO endpoint so the frontend is
// same-origin — no CORS issues, no CNCjs backend modifications needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:8000',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
