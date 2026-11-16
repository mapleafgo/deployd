import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
const projectRoot = fileURLToPath(new URL("./", import.meta.url));
const graph: { modules: { dir: string }[] } = JSON.parse(
  readFileSync(new URL("./.redberry/module-graph.json", import.meta.url), "utf8"),
);
export default defineConfig({
  server: {
    host: "127.0.0.1",
    fs: {
      allow: [
        projectRoot,
        ...graph.modules.map((module) => path.resolve(projectRoot, module.dir, "frontend")),
      ],
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "react/jsx-runtime",
      "@mantine/core",
      "@mantine/hooks",
      "@mantine/dates",
      "@tanstack/react-form",
      "@tanstack/react-query",
      "zod",
    ],
  },
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "i18next",
      "react-i18next",
      "@tanstack/react-router",
      "@tanstack/react-query",
      "@mantine/core",
      "@mantine/hooks",
      "@mantine/dates",
    ],
  },
  test: {
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
    reporters: ["default", "./scripts/frontend/report-gates.mjs", "json"],
    outputFile: { json: "test-results/vitest.json" },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/*.test.ts", "tasks/tests/*.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: [
            "tests/components/*.test.tsx",
            "tasks/tests/*.test.tsx",
            "tasks/frontend/*.test.tsx",
          ],
          browser: {
            enabled: true,
            headless: true,
            connectTimeout: 10000,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
