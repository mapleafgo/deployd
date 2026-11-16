import { runPnpm } from "./pnpm.mjs";
import { mkdirSync, rmSync } from "node:fs";
import { assessVitest, assessPlaywright, readReport } from "./report-gates.mjs";
mkdirSync("test-results", { recursive: true });
const run = (args) => runPnpm(args, { stdio: "inherit", env: process.env }).status;
rmSync("test-results/vitest.json", { force: true });
const unitCode = run(["exec", "vitest", "run"]);
const unit = assessVitest(readReport("test-results/vitest.json").report, unitCode, [
  "/tests/unit/",
  "/tests/components/",
]);
rmSync("test-results/playwright.json", { force: true });
// 视觉基线依赖渲染环境，默认跳过；需要时运行 pnpm test:visual。
const e2eCode = run(["exec", "playwright", "test", "--grep-invert", "@visual"]);
const e2e = assessPlaywright(readReport("test-results/playwright.json").report, e2eCode);
console.log(JSON.stringify({ unit, e2e }, null, 2));
if (!unit.passed || !e2e.passed) process.exitCode = 1;
