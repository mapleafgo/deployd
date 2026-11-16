import { it, expect } from "vitest";
import { assessVitest, assessPlaywright } from "../../scripts/frontend/report-gates.mjs";
it("缺失、损坏与空报告不得放行", () => {
  for (const report of [undefined, null, {}, { success: true, numTotalTests: 0 }])
    expect(assessVitest(report, 0, ["/tests/unit/"]).passed).toBe(false);
  for (const report of [
    undefined,
    null,
    {},
    { stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 } },
  ])
    expect(assessPlaywright(report, 0).passed).toBe(false);
});
it("不完整报告、跳过测试、缺测试层与非零退出码不得放行", () => {
  const report = {
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{ name: "/tests/unit/a.test.ts", assertionResults: [{ status: "passed" }] }],
  };
  expect(assessVitest(report, 0, ["/tests/unit/"]).passed).toBe(false);
  expect(assessVitest(report, 1, ["/tests/unit/"]).passed).toBe(false);
  expect(assessVitest(report, 0, ["/tests/unit/", "/tests/components/"]).passed).toBe(false);
  expect(assessVitest({ ...report, numPendingTests: 1 }, 0).passed).toBe(false);
});
