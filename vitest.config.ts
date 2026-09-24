import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Ignore Agent Manager worktree checkouts so stale copies never run.
    exclude: [...configDefaults.exclude, "**/.kilo/**"],
  },
});
