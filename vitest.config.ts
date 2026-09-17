import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

/**
 * Deliberately not the app's vite config: the tests here exercise server and
 * engine code, and loading the router and Nitro plugins to do that would only
 * add ways for a test run to fail.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^#\//, replacement: `${src}/` },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
