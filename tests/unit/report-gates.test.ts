import { describe, it, expect } from "vitest";
import { assessVitest, assessPlaywright } from "../../scripts/frontend/report-gates.mjs";

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("测试夹具为空");
  return item;
}
function vitestReport() {
  const assertion = (title: string, ancestors: string[] = []) => ({
    ancestorTitles: ancestors,
    fullName: [...ancestors, title].join(" "),
    status: "passed",
    title,
    duration: 1,
    failureMessages: [],
    meta: {
      redberry: {
        version: 1,
        id: title,
        fileID: ancestors.length ? "unit" : "browser",
        suiteIDs: ancestors,
        mode: "run",
        configuredRetry: 0,
        configuredRepeats: 0,
        retryCount: 0,
        repeatCount: 0,
        flaky: false,
        fails: false,
      },
    },
    tags: [],
    benchmarks: [],
  });
  return {
    success: true,
    startTime: 1,
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numTotalTestSuites: 3,
    numPassedTestSuites: 3,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    testResults: [
      {
        name: "/project/tests/unit/a.test.ts",
        status: "passed",
        startTime: 1,
        endTime: 2,
        message: "",
        assertionResults: [assertion("单元用例", ["业务"])],
      },
      {
        name: "/project/tests/components/a.test.tsx",
        status: "passed",
        startTime: 1,
        endTime: 2,
        message: "",
        assertionResults: [assertion("组件用例")],
      },
    ],
  };
}
function playwrightReport() {
  return {
    config: {
      forbidOnly: true,
      projects: [{ id: "chromium", name: "chromium", retries: 0, repeatEach: 1 }],
    },
    errors: [],
    stats: {
      expected: 1,
      unexpected: 0,
      skipped: 0,
      flaky: 0,
      duration: 1,
      startTime: "2026-10-18T00:00:00Z",
    },
    suites: [
      {
        title: "e2e.test.ts",
        file: "e2e.test.ts",
        specs: [
          {
            id: "spec-1",
            title: "真实业务",
            file: "e2e.test.ts",
            line: 1,
            column: 1,
            ok: true,
            tests: [
              {
                projectId: "chromium",
                projectName: "chromium",
                expectedStatus: "passed",
                status: "expected",
                annotations: [],
                results: [
                  {
                    status: "passed",
                    retry: 0,
                    duration: 1,
                    startTime: "2026-10-18T00:00:00Z",
                    errors: [],
                    annotations: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("报告结构与统计校验", () => {
  it("接受完整逐项证据并重建 describe 套件数", () => {
    expect(assessVitest(vitestReport(), 0, ["/tests/unit/", "/tests/components/"]).passed).toBe(
      true,
    );
    expect(assessPlaywright(playwrightReport(), 0).passed).toBe(true);
  });
  it("拒绝虚增 Vitest 总数", () => {
    const report = vitestReport();
    report.numTotalTests = 999;
    report.numPassedTests = 999;
    expect(assessVitest(report, 0).passed).toBe(false);
  });
  it("拒绝虚增 Playwright 总数", () => {
    const report = playwrightReport();
    report.stats.expected = 999;
    expect(assessPlaywright(report, 0).passed).toBe(false);
  });
  const vitestMutations: [string, (report: ReturnType<typeof vitestReport>) => void][] = [
    [
      "套件计数错误",
      (r) => {
        r.numTotalTestSuites = 999;
        r.numPassedTestSuites = 999;
      },
    ],
    [
      "重复文件",
      (r) => {
        r.testResults.push(structuredClone(first(r.testResults)));
        r.numTotalTests++;
        r.numPassedTests++;
      },
    ],
    [
      "重复用例",
      (r) => {
        first(r.testResults).assertionResults.push(
          structuredClone(first(first(r.testResults).assertionResults)),
        );
        r.numTotalTests++;
        r.numPassedTests++;
      },
    ],
    [
      "缺用例名称",
      (r) => {
        Reflect.deleteProperty(first(first(r.testResults).assertionResults), "fullName");
      },
    ],
    [
      "缺必要计数",
      (r) => {
        Reflect.deleteProperty(r, "numTotalTests");
      },
    ],
    [
      "损坏测试集合",
      (r) => {
        Reflect.set(r, "testResults", {});
      },
    ],
    [
      "skip",
      (r) => {
        first(first(r.testResults).assertionResults).status = "skipped";
      },
    ],
    [
      "todo",
      (r) => {
        r.numTodoTests = 1;
      },
    ],
    [
      "retry",
      (r) => {
        Reflect.set(first(first(r.testResults).assertionResults).meta, "retryCount", 1);
      },
    ],
    [
      "only",
      (r) => {
        Reflect.set(first(first(r.testResults).assertionResults).meta, "only", true);
      },
    ],
    [
      "省略原生证据",
      (r) => {
        Reflect.deleteProperty(first(first(r.testResults).assertionResults).meta, "redberry");
      },
    ],
    [
      "伪造原生重试",
      (r) => {
        first(first(r.testResults).assertionResults).meta.redberry.retryCount = 1;
      },
    ],
    [
      "伪造原生重复",
      (r) => {
        first(first(r.testResults).assertionResults).meta.redberry.repeatCount = 1;
      },
    ],
    [
      "原生only",
      (r) => {
        first(first(r.testResults).assertionResults).meta.redberry.mode = "only";
      },
    ],
    [
      "套件错误",
      (r) => {
        first(r.testResults).message = "加载异常";
      },
    ],
  ];
  for (const [label, mutate] of vitestMutations)
    it(`拒绝 Vitest ${label}`, () => {
      const report = vitestReport();
      mutate(report);
      expect(() => assessVitest(report, 0)).not.toThrow();
      expect(assessVitest(report, 0).passed).toBe(false);
    });
  const playwrightMutations: [string, (report: ReturnType<typeof playwrightReport>) => void][] = [
    [
      "重复 spec",
      (r) => {
        first(r.suites).specs.push(structuredClone(first(first(r.suites).specs)));
        r.stats.expected++;
      },
    ],
    [
      "重复项目用例",
      (r) => {
        first(first(r.suites).specs).tests.push(
          structuredClone(first(first(first(r.suites).specs).tests)),
        );
        r.stats.expected++;
      },
    ],
    [
      "缺 spec ID",
      (r) => {
        Reflect.deleteProperty(first(first(r.suites).specs), "id");
      },
    ],
    [
      "缺项目身份",
      (r) => {
        Reflect.deleteProperty(first(first(first(r.suites).specs).tests), "projectId");
      },
    ],
    [
      "缺错误集合",
      (r) => {
        Reflect.deleteProperty(r, "errors");
      },
    ],
    [
      "损坏 suites",
      (r) => {
        Reflect.set(r, "suites", {});
      },
    ],
    [
      "损坏 specs",
      (r) => {
        Reflect.set(first(r.suites), "specs", {});
      },
    ],
    [
      "缺结果状态",
      (r) => {
        Reflect.deleteProperty(first(first(first(first(r.suites).specs).tests).results), "status");
      },
    ],
    [
      "retry",
      (r) => {
        first(first(first(first(r.suites).specs).tests).results).retry = 1;
      },
    ],
    [
      "配置允许 retry",
      (r) => {
        first(r.config.projects).retries = 1;
      },
    ],
    [
      "配置允许 only",
      (r) => {
        r.config.forbidOnly = false;
      },
    ],
    [
      "only",
      (r) => {
        Reflect.set(first(first(r.suites).specs), "only", true);
      },
    ],
    [
      "skip",
      (r) => {
        r.stats.skipped = 1;
      },
    ],
    [
      "未注册项目",
      (r) => {
        first(first(first(r.suites).specs).tests).projectId = "unknown";
      },
    ],
    [
      "结果错误",
      (r) => {
        Reflect.set(first(first(first(first(r.suites).specs).tests).results), "errors", [
          { message: "异常" },
        ]);
      },
    ],
  ];
  for (const [label, mutate] of playwrightMutations)
    it(`拒绝 Playwright ${label}`, () => {
      const report = playwrightReport();
      mutate(report);
      expect(() => assessPlaywright(report, 0)).not.toThrow();
      expect(assessPlaywright(report, 0).passed).toBe(false);
    });
  it("拒绝缺失报告、空集合、非零退出及缺测试层", () => {
    for (const report of [undefined, null, {}, [], { success: true, numTotalTests: 0 }]) {
      expect(assessVitest(report, 0).passed).toBe(false);
      expect(assessPlaywright(report, 0).passed).toBe(false);
    }
    expect(assessVitest(vitestReport(), 1).passed).toBe(false);
    expect(assessPlaywright(playwrightReport(), 1).passed).toBe(false);
    expect(assessVitest(vitestReport(), 0, ["/missing/"]).passed).toBe(false);
  });
});
