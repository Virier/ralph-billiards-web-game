import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    // Allow importing .ts files without .js extension in tests
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
})
