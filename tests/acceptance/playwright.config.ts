import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error("产物验收需要显式 E2E_BASE_URL 和已运行的隔离服务");

export default defineConfig({
  testDir: ".",
  forbidOnly: true,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../test-results/artifact-e2e",
  use: { baseURL, browserName: "chromium", reducedMotion: "reduce" },
});
