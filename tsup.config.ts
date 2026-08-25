import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/pg': 'src/adapters/pg.ts',
    'adapters/mysql2': 'src/adapters/mysql2.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  outDir: 'dist',
  external: ['pg', 'mysql2'],
})
