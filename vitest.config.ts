import {defineConfig} from 'vitest/config';

// Kept separate from vite.config.ts so tests don't load the React/PWA build plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'src/services/tradingMath.ts'],
      exclude: ['server/config.ts', 'server/marketEngine.ts', 'server/broker/**', 'server/instruments.ts', 'server/feedTypes.ts'],
    },
  },
});
