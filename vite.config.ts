/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // O Vite também lê o .env.local nos testes: as chaves reais ficam de fora
    // (os testes simulam a rede e não gastam a cota grátis)
    env: { VITE_GOOGLE_MAPS_API_KEY: '', VITE_TOMTOM_API_KEY: '', VITE_ORS_API_KEY: '', VITE_OSRM_URL: '' },
  },
});
