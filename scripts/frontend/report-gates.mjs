import { readFileSync } from "node:fs";

const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const isNonNegativeFinite = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const normalized = (value) => value.replaceAll("\\", "/");

export function readReport(file) {
  try {
    return { report: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: `无法读取报告 ${file}: ${error.message}` };
  }
}

function satisfiesFirstPassPolicy(value) {
  if (!record(value)) return false;
  for (const key of ["retry", "retryCount", "repeatCount"])
    if (Object.hasOwn(value, key) && value[key] !== 0) return false;
  if (Object.hasOwn(value, "only") && value.only !== false) return false;
  return !["only", "skip", "todo", "pending"].includes(value.mode);
}
function totals(report, keys, reasons) {
  if (!record(report) || keys.some((key) => !count(report[key]))) {
    reasons.push("缺少合法的框架统计字段");
    return false;
  }
  return true;
}
function annotations(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        record(item) &&
        text(item.type) &&
        !["only", "skip", "fixme", "todo", "fail", "retry"].includes(item.type),
    )
  );
}

export function assessVitest(report, exitCode, requiredGroups = []) {
  const reasons = [];
  if (exitCode !== 0) reasons.push(`进程退出码 ${exitCode}`);
  if (!record(report) || report.success !== true || !satisfiesFirstPassPolicy(report))
    reasons.push("框架未报告成功");
  const keys = [
    "numTotalTests",
    "numPassedTests",
    "numFailedTests",
    "numPendingTests",
    "numTodoTests",
    "numTotalTestSuites",
    "numPassedTestSuites",
    "numFailedTestSuites",
    "numPendingTestSuites",
  ];
  const validTotals = totals(report, keys, reasons);
  if (!record(report) || !Array.isArray(report.testResults) || !report.testResults.length)
    reasons.push("没有合法的逐文件执行记录");
  const files = record(report) && Array.isArray(report.testResults) ? report.testResults : [];
  const names = new Set();
  const suites = new Set();
  const cases = new Set();
  let actual = 0;
  let passed = 0;
  const passedFiles = [];
  for (const suite of files) {
    if (
      !record(suite) ||
      !text(suite.name) ||
      !Array.isArray(suite.assertionResults) ||
      !suite.assertionResults.length
    ) {
      reasons.push("文件记录缺少身份或用例集合");
      continue;
    }
    const name = normalized(suite.name);
    const first = suite.assertionResults[0];
    const fileID =
      record(first) && record(first.meta) && record(first.meta.redberry)
        ? first.meta.redberry.fileID
        : undefined;
    if (!text(fileID) || names.has(fileID)) reasons.push(`缺失或重复文件身份：${name}`);
    names.add(fileID);
    suites.add(fileID);
    if (
      !satisfiesFirstPassPolicy(suite) ||
      suite.status !== "passed" ||
      suite.message !== "" ||
      !isNonNegativeFinite(suite.startTime) ||
      !isNonNegativeFinite(suite.endTime) ||
      suite.endTime < suite.startTime
    )
      reasons.push(`文件执行失败或记录损坏：${name}`);
    let clean = suite.status === "passed";
    for (const assertion of suite.assertionResults) {
      actual++;
      if (
        !record(assertion) ||
        !text(assertion.title) ||
        !text(assertion.fullName) ||
        !Array.isArray(assertion.ancestorTitles) ||
        !assertion.ancestorTitles.every(text)
      ) {
        reasons.push(`用例缺少身份：${name}`);
        clean = false;
        continue;
      }
      const evidence =
        record(assertion.meta) && record(assertion.meta.redberry)
          ? assertion.meta.redberry
          : undefined;
      if (
        !evidence ||
        evidence.version !== 1 ||
        !text(evidence.id) ||
        evidence.fileID !== fileID ||
        !Array.isArray(evidence.suiteIDs) ||
        evidence.suiteIDs.length !== assertion.ancestorTitles.length ||
        !evidence.suiteIDs.every(text) ||
        new Set(evidence.suiteIDs).size !== evidence.suiteIDs.length ||
        evidence.suiteIDs.includes(fileID) ||
        evidence.mode !== "run" ||
        evidence.retryCount !== 0 ||
        evidence.repeatCount !== 0 ||
        evidence.configuredRetry !== 0 ||
        evidence.configuredRepeats !== 0 ||
        evidence.flaky !== false ||
        evidence.fails !== false
      )
        reasons.push(`缺少合法的原生首轮执行证据：${name} ${assertion.fullName}`);
      if (evidence && Array.isArray(evidence.suiteIDs))
        for (const suiteID of evidence.suiteIDs) suites.add(suiteID);
      const id = evidence?.id;
      if (cases.has(id)) reasons.push(`重复用例记录：${id}`);
      cases.add(id);
      if (assertion.fullName !== [...assertion.ancestorTitles, assertion.title].join(" "))
        reasons.push(`用例名称与层级不一致：${id}`);
      if (assertion.status === "passed") passed++;
      if (
        assertion.status !== "passed" ||
        !Array.isArray(assertion.failureMessages) ||
        assertion.failureMessages.length ||
        !record(assertion.meta) ||
        !satisfiesFirstPassPolicy(assertion) ||
        !satisfiesFirstPassPolicy(assertion.meta)
      ) {
        reasons.push(`存在失败、跳过、待办、重试或 only：${id}`);
        clean = false;
      }
    }
    if (clean) passedFiles.push(name);
  }
  if (!actual) reasons.push("没有收集到测试");
  if (
    validTotals &&
    (report.numTotalTests !== actual ||
      report.numPassedTests !== passed ||
      report.numFailedTests !== 0 ||
      report.numPendingTests !== 0 ||
      report.numTodoTests !== 0 ||
      passed !== actual)
  )
    reasons.push("逐项用例数量与框架统计不一致，或存在未通过用例");
  // Vitest 的套件计数包含文件及 describe；使用原生 ID 避免同名 describe 被合并。
  if (
    validTotals &&
    (report.numTotalTestSuites !== suites.size ||
      report.numPassedTestSuites !== suites.size ||
      report.numFailedTestSuites !== 0 ||
      report.numPendingTestSuites !== 0)
  )
    reasons.push("逐项套件数量与框架统计不一致");
  for (const group of requiredGroups)
    if (!passedFiles.some((name) => name.includes(group)))
      reasons.push(`必需测试层为空或未通过：${group}`);
  return {
    passed: reasons.length === 0,
    reasons,
    total: actual,
    executed: passed,
    skipped: validTotals ? report.numPendingTests + report.numTodoTests : 0,
  };
}

function playwrightSpecs(report, reasons) {
  const specs = [];
  if (!record(report) || !Array.isArray(report.suites)) {
    reasons.push("缺少合法的 suites 集合");
    return specs;
  }
  const pending = report.suites.map((suite) => ({ suite, parent: "" }));
  const names = new Set();
  while (pending.length) {
    const { suite, parent } = pending.pop();
    if (!record(suite) || !text(suite.title) || !text(suite.file)) {
      reasons.push("套件缺少身份");
      continue;
    }
    const id = JSON.stringify([parent, normalized(suite.file), suite.title]);
    if (names.has(id)) {
      reasons.push(`重复套件：${id}`);
      continue;
    }
    names.add(id);
    if (Object.hasOwn(suite, "specs") && !Array.isArray(suite.specs))
      reasons.push("损坏的 specs 集合");
    if (Object.hasOwn(suite, "suites") && !Array.isArray(suite.suites))
      reasons.push("损坏的子 suites 集合");
    const children = Array.isArray(suite.suites) ? suite.suites : [];
    const entries = Array.isArray(suite.specs) ? suite.specs : [];
    if (!children.length && !entries.length) reasons.push("存在空套件");
    specs.push(...entries);
    pending.push(...children.map((child) => ({ suite: child, parent: id })));
  }
  return specs;
}
export function playwrightTests(report) {
  return playwrightSpecs(report, []).flatMap((spec) =>
    record(spec) && Array.isArray(spec.tests) ? spec.tests : [],
  );
}

export function assessPlaywright(report, exitCode) {
  const reasons = [];
  if (exitCode !== 0) reasons.push(`进程退出码 ${exitCode}`);
  const stats = record(report) && record(report.stats) ? report.stats : undefined;
  const validTotals = totals(stats, ["expected", "unexpected", "skipped", "flaky"], reasons);
  if (!record(report) || !Array.isArray(report.errors) || report.errors.length)
    reasons.push("缺少错误集合或框架执行报错");
  if (!stats || !timestamp(stats.startTime) || !isNonNegativeFinite(stats.duration))
    reasons.push("统计时间记录损坏");
  const config = record(report) && record(report.config) ? report.config : undefined;
  const projects = config && Array.isArray(config.projects) ? config.projects : [];
  if (
    !config ||
    config.forbidOnly !== true ||
    !projects.length ||
    !satisfiesFirstPassPolicy(config) ||
    !satisfiesFirstPassPolicy(report)
  )
    reasons.push("缺少禁用 only 的配置或项目集合");
  const projectIDs = new Map();
  for (const project of projects) {
    if (
      !record(project) ||
      typeof project.id !== "string" ||
      typeof project.name !== "string" ||
      project.retries !== 0 ||
      project.repeatEach !== 1 ||
      !satisfiesFirstPassPolicy(project)
    ) {
      reasons.push("项目身份或零重试配置无效");
      continue;
    }
    const id = JSON.stringify([project.id, project.name]);
    if (projectIDs.has(project.id)) reasons.push(`重复项目：${id}`);
    projectIDs.set(project.id, project.name);
  }
  const specs = playwrightSpecs(report, reasons);
  const specIDs = new Set();
  const caseIDs = new Set();
  let actual = 0;
  let executed = 0;
  for (const spec of specs) {
    if (
      !record(spec) ||
      !text(spec.id) ||
      !text(spec.title) ||
      !text(spec.file) ||
      !count(spec.line) ||
      !count(spec.column) ||
      !Array.isArray(spec.tests) ||
      !spec.tests.length
    ) {
      reasons.push("spec 缺少身份或用例集合");
      continue;
    }
    if (specIDs.has(spec.id)) reasons.push(`重复 spec：${spec.id}`);
    specIDs.add(spec.id);
    if (spec.ok !== true || !satisfiesFirstPassPolicy(spec))
      reasons.push(`spec 失败或存在 only：${spec.id}`);
    for (const test of spec.tests) {
      actual++;
      if (
        !record(test) ||
        typeof test.projectId !== "string" ||
        typeof test.projectName !== "string"
      ) {
        reasons.push("用例缺少项目身份");
        continue;
      }
      const project = JSON.stringify([test.projectId, test.projectName]);
      if (!projectIDs.has(test.projectId) || projectIDs.get(test.projectId) !== test.projectName)
        reasons.push(`用例引用未注册项目：${project}`);
      const id = JSON.stringify([spec.id, test.projectId, test.projectName]);
      if (caseIDs.has(id)) reasons.push(`重复项目用例：${id}`);
      caseIDs.add(id);
      if (
        test.expectedStatus !== "passed" ||
        test.status !== "expected" ||
        !annotations(test.annotations) ||
        !satisfiesFirstPassPolicy(test) ||
        !Array.isArray(test.results) ||
        test.results.length !== 1
      ) {
        reasons.push(`非首轮通过或未执行用例：${id}`);
        continue;
      }
      const result = test.results[0];
      if (
        !record(result) ||
        result.status !== "passed" ||
        result.retry !== 0 ||
        !isNonNegativeFinite(result.duration) ||
        !timestamp(result.startTime) ||
        !Array.isArray(result.errors) ||
        result.errors.length ||
        result.error ||
        !annotations(result.annotations) ||
        !satisfiesFirstPassPolicy(result)
      ) {
        reasons.push(`结果失败、重试或记录损坏：${id}`);
        continue;
      }
      executed++;
    }
  }
  if (!actual) reasons.push("没有逐项执行记录");
  if (
    validTotals &&
    (stats.expected !== actual ||
      stats.unexpected !== 0 ||
      stats.skipped !== 0 ||
      stats.flaky !== 0 ||
      executed !== actual)
  )
    reasons.push("逐项执行数量与框架统计不一致，或存在未通过用例");
  return {
    passed: reasons.length === 0,
    reasons,
    total: actual,
    executed,
    skipped: validTotals ? stats.skipped : 0,
  };
}

// 使用 Vitest 原生报告生命周期，将 JSON 默认省略的首轮执行信息写入元数据。
export default class FirstPassReporter {
  onTestCaseResult(testCase) {
    const diagnostic = testCase.diagnostic();
    const suiteIDs = [];
    let parent = testCase.parent;
    while (parent?.type === "suite") {
      suiteIDs.unshift(parent.id);
      parent = parent.parent;
    }
    testCase.meta().redberry = {
      version: 1,
      id: testCase.id,
      fileID: testCase.module.id,
      suiteIDs,
      mode: testCase.options.mode,
      configuredRetry: testCase.options.retry ?? 0,
      configuredRepeats: testCase.options.repeats ?? 0,
      retryCount: diagnostic?.retryCount ?? null,
      repeatCount: diagnostic?.repeatCount ?? null,
      flaky: diagnostic?.flaky ?? null,
      fails: testCase.options.fails ?? false,
    };
  }
}
