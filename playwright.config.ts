import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { loadBrowserSetups } from "./scripts/frontend/browser-setup.mjs";
// 测试入口取 test 环境的后台声明，端口与路径都来自 redberry.yaml。
const webApps = JSON.parse(
  readFileSync(new URL("./.redberry/web-apps.json", import.meta.url), "utf8"),
);
// 测试入口直接取声明的后台应用：web-apps.json 由 CLI 生成，admin 始终存在。
const adminApp = webApps.apps.admin;
const testPort = new URL(adminApp.dev.test_target ?? adminApp.dev.target).port;
const testPath = adminApp.path;
const suffix = (await loadBrowserSetups())
  .map((module) => module.snapshotSuffix)
  .filter(Boolean)
  .join("-");
export default defineConfig({
  snapshotPathTemplate: `{testDir}/{testFilePath}-snapshots/{arg}${suffix ? `-${suffix}` : ""}-{platform}{ext}`,
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/playwright.json" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${testPort}${testPath}`,
    browserName: "chromium",
    // 视觉基线固定动态效果偏好；正常动效由独立场景验证。
    reducedMotion: "reduce",
  },
  ...(process.env.E2E_EXTERNAL_SERVER === "1"
    ? {}
    : {
        webServer: {
          command: "redberry app dev --env test",
          url: `http://127.0.0.1:${testPort}/api/health`,
          reuseExistingServer: false,
          gracefulShutdown: { signal: "SIGTERM", timeout: 20000 },
          timeout: 60000,
        },
      }),
});
