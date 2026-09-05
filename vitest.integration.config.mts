import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate config so `npm test` (vitest.config.mts) stays database-free.
// These tests hit the real local Supabase stack -- see src/repository/README.md
// for the run sequence.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.{ts,tsx}"],
    // Integration tests share one Postgres instance and reset state in
    // beforeEach; running them concurrently would race on that state.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
