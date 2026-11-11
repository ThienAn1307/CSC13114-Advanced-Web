import { defineConfig } from 'drizzle-kit';

// `generate` only diffs the schema against the committed snapshots; it needs no database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
});
