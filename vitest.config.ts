import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.claude/**', '**/.worktrees/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@/middleware': path.resolve(__dirname, 'lib/is-public.ts'),
      '@/lib': path.resolve(__dirname, 'lib'),
      '@/app': path.resolve(__dirname, 'app'),
      '@/components': path.resolve(__dirname, 'components'),
    },
    extensions: ['.js', '.ts', '.tsx', '.json'],
    dedupe: ['react', 'react-dom'],
  },
});
