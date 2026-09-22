import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Project site: https://jbob007h.github.io/pacman-101/
  base: '/pacman-101/',
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
