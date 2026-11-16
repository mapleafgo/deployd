import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { devNull } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPnpm } from "./pnpm.mjs";
import { version as compilerVersion } from "typescript";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { checkBoundaries } from "./boundaries.mjs";

const version = "7.0.2";
const root = realpathSync(process.cwd());
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
let checkedRoots = [root];
const inside = (file) =>
  checkedRoots.some((directory) => {
    const rel = path.relative(directory, file);
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  });
function command(args) {
  const result = runPnpm(args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `pnpm ${args.join(" ")} 失败\n${String(result.stdout ?? "")}${String(result.stderr ?? "")}`,
    );
  return result.stdout;
}
function parseConfig(file) {
  const api = new API({ cwd: root });
  try {
    return api.parseConfigFile(file);
  } finally {
    api.close();
  }
}
function graphRoots() {
  const graph = json(path.join(root, ".redberry/module-graph.json"));
  if (!Array.isArray(graph.modules) || !graph.modules.length)
    throw new Error("模块图为空，请运行 redberry gen");
  const ids = new Set();
  const dirs = new Set();
  const roots = graph.modules.map((entry) => {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !entry.id ||
      typeof entry.dir !== "string" ||
      path.isAbsolute(entry.dir)
    )
      throw new Error("模块图身份或目录无效");
    const dir = realpathSync(path.resolve(root, entry.dir));
    if (ids.has(entry.id) || dirs.has(dir)) throw new Error("模块图目录越界或身份重复");
    ids.add(entry.id);
    dirs.add(dir);
    return dir;
  });
  if (!dirs.has(root)) throw new Error("模块图缺少根项目");
  return roots;
}
const configName = (name) =>
  /^\.(?:oxlint|oxfmt|eslint|prettier)/.test(name) ||
  [
    ".npmrc",
    "pnpm-workspace.yaml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.ts",
    "prettier.config.js",
    "prettier.config.mjs",
  ].includes(name);
function collect(directories, failures) {
  const files = new Set();
  const seen = new Set();
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    const physical = realpathSync(directory);
    if (!inside(physical)) throw new Error(`检查目录软链接越界：${directory}`);
    if (seen.has(physical)) return;
    seen.add(physical);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        ["node_modules", ".git", "dist", "coverage", "test-results", "playwright-report"].includes(
          entry.name,
        )
      )
        continue;
      const file = path.join(directory, entry.name);
      if (configName(entry.name)) failures.push(`禁止局部工具配置覆盖统一规则：${file}`);
      if (
        /^tsconfig.*\.json$/.test(entry.name) &&
        path.dirname(file) !== path.join(root, "frontend")
      ) {
        const parsed = parseConfig(file);
        if (
          ["strict", "exactOptionalPropertyTypes", "noUncheckedIndexedAccess"].some(
            (option) => parsed.options[option] !== true,
          )
        )
          failures.push(`模块配置不得关闭统一 TypeScript 严格规则：${file}`);
      }
      const info = statSync(file);
      if (info.isDirectory()) {
        walk(file);
        continue;
      }
      if (
        !info.isFile() ||
        !/\.(?:[cm]?[jt]sx?|json|jsonc|html|css|scss|sass|less)$/.test(entry.name)
      )
        continue;
      if (!inside(realpathSync(file))) throw new Error(`检查文件软链接越界：${file}`);
      files.add(file);
    }
  };
  for (const dir of directories) walk(dir);
  return [...files].sort((a, b) => a.localeCompare(b));
}
function compilerPolicy(packages, failures) {
  const require = createRequire(path.join(root, "package.json"));
  const compiler = realpathSync(require.resolve("typescript"));
  if (compilerVersion !== version)
    failures.push(`根 TypeScript 版本必须为 ${version}，实际 ${compilerVersion}`);
  if (json(path.join(root, "package.json")).devDependencies?.typescript !== "catalog:")
    failures.push("根工具包必须显式声明 TypeScript catalog:");
  const catalog = JSON.parse(command(["config", "get", "catalog", "--json"]));
  if (catalog.typescript !== version) failures.push(`catalog.typescript 必须精确固定 ${version}`);
  if (JSON.parse(command(["config", "get", "strict-peer-dependencies", "--json"])) !== true)
    failures.push("必须启用 strictPeerDependencies");
  for (const directory of packages) {
    const manifest = json(path.join(directory, "package.json"));
    for (const group of ["dependencies", "devDependencies", "peerDependencies"]) {
      const declared = manifest[group]?.typescript;
      if (declared !== undefined && declared !== "catalog:")
        failures.push(`TypeScript 必须声明 catalog:：${directory}`);
    }
    const from = createRequire(path.join(directory, "package.json"));
    // 未声明私有编译器的模块使用宿主统一编译器；显式安装的副本仍需核对。
    let compilerRequire = from;
    try {
      from.resolve("typescript");
    } catch {
      compilerRequire = require;
    }
    const resolved = realpathSync(compilerRequire.resolve("typescript"));
    const installed = json(compilerRequire.resolve("typescript/package.json"));
    if (resolved !== compiler || installed.version !== version)
      failures.push(
        `workspace 解析到第二份 TypeScript：${directory} -> ${resolved} (${installed.version})`,
      );
  }
  const dependencyTree = JSON.parse(
    command(["list", "typescript", "-r", "--depth", "Infinity", "--json"]),
  );
  if (!Array.isArray(dependencyTree) || !dependencyTree.length)
    throw new Error("pnpm 未返回实际依赖树");
  let found = 0;
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (
        key === "typescript" &&
        entry &&
        typeof entry === "object" &&
        typeof entry.path === "string"
      ) {
        found++;
        if (
          entry.version !== version ||
          realpathSync(
            createRequire(path.join(entry.path, "package.json")).resolve("typescript"),
          ) !== compiler
        )
          failures.push(`实际 pnpm 树存在第二份 TypeScript：${entry.path} (${entry.version})`);
      }
      visit(entry);
    }
  };
  visit(dependencyTree);
  if (!found) throw new Error("实际 pnpm 树缺少 TypeScript");
}
export function applicationProjects(projectRoot = root) {
  const web = json(path.join(projectRoot, ".redberry/web-apps.json"));
  return Object.entries(web.apps)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, app]) => {
      const generated = path.join(projectRoot, ".redberry/frontend", name);
      const { inputs } = json(path.join(generated, "shell.metadata.json"));
      if (!Array.isArray(inputs)) throw new Error(`应用 ${name} 缺少生成输入，请运行 redberry gen`);
      return {
        name,
        directory: path.resolve(projectRoot, app.directory),
        config: path.join(generated, "tsconfig.modules.json"),
        tests: path.join(generated, "tsconfig.tests.json"),
        inputs,
      };
    });
}
function strictConfigurations(failures, applications) {
  const projects = new Map();
  // 应用代码使用所属生成工程；工具与根测试仍使用模板维护的 Node/test 配置。
  const files = [
    ...applications.map((app) => app.config),
    path.join(root, "frontend/tsconfig.node.json"),
    path.join(root, "frontend/tsconfig.test.json"),
    ...applications.filter((app) => app.name !== "admin").map((app) => app.tests),
  ];
  for (const file of files) {
    const parsed = parseConfig(file);
    for (const option of ["strict", "exactOptionalPropertyTypes", "noUncheckedIndexedAccess"])
      if (parsed.options[option] !== true) failures.push(`不允许关闭 ${option}：${file}`);
    projects.set(file, new Set(parsed.fileNames.map((item) => realpathSync(item))));
  }
  // 保留对应用自己维护的严格选项的检查，不允许迁移后偷偷降低标准。
  for (const app of applications) {
    const file = path.join(app.directory, "tsconfig.app.json");
    if (!existsSync(file)) continue;
    const parsed = parseConfig(file);
    for (const option of ["strict", "exactOptionalPropertyTypes", "noUncheckedIndexedAccess"])
      if (parsed.options[option] !== true) failures.push(`不允许关闭 ${option}：${file}`);
  }
  return projects;
}
// Node 配置不能借浏览器工程的上下文进行类型感知 lint；共同依赖仍优先归浏览器工程。
export function lintProjects(files, projects, nodeProject = "node") {
  const names = [...projects.keys()];
  const groups = new Map(names.map((name) => [name, []]));
  for (const file of files) {
    const project =
      names.find((name) => projects.get(name).has(file)) ??
      (file.endsWith(".mjs") ? nodeProject : names[0]);
    groups.get(project).push(file);
  }
  return groups;
}
function inlineOverrides(file, failures) {
  const scanner = ts.createScanner(false, ts.LanguageVariant.JSX, readFileSync(file, "utf8"));
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFile; token = scanner.scan()) {
    if (
      (token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia) &&
      /@ts-(?:ignore|nocheck)|(?:oxlint|oxfmt|eslint|prettier)-(?:disable|ignore)/.test(
        scanner.getTokenText(),
      )
    )
      failures.push(`禁止局部注释关闭检查：${file}`);
  }
}

export function runChecks() {
  const failures = [];
  const graph = graphRoots();
  checkedRoots = graph;
  const applications = applicationProjects();
  const projects = strictConfigurations(failures, applications);
  const active = new Set([root]);
  for (const app of applications)
    for (const input of app.inputs) {
      const directory = realpathSync(path.dirname(path.dirname(input.file)));
      if (!graph.includes(directory))
        throw new Error(`应用 ${app.name} 的模块输入不在安装图：${input.file}`);
      active.add(directory);
    }
  const modules = graph.filter((directory) => active.has(directory));
  const packages = [
    root,
    ...applications
      .map((app) => app.directory)
      .filter((directory) => existsSync(path.join(directory, "package.json"))),
  ];
  for (const directory of modules) {
    if (directory !== root)
      for (const name of readdirSync(directory))
        if (configName(name))
          failures.push(`禁止模块配置覆盖统一规则：${path.join(directory, name)}`);
    const frontend = path.join(directory, "frontend");
    if (existsSync(path.join(frontend, "package.json"))) packages.push(frontend);
  }
  compilerPolicy([...new Set(packages)], failures);
  const files = collect(
    [
      ...modules
        .filter((directory) => directory !== root)
        .map((directory) => path.join(directory, "frontend")),
      ...applications.map((app) => app.directory),
      path.join(root, ".redberry/frontend"),
      path.join(root, "tests"),
      path.join(root, "scripts/frontend"),
    ],
    failures,
  );
  for (const name of ["vitest.config.ts", "playwright.config.ts"])
    if (existsSync(path.join(root, name))) files.push(path.join(root, name));
  const covered = new Set([...projects.values()].flatMap((files) => [...files]));
  for (const file of files) {
    if (/\.[cm]?[jt]sx?$/.test(file)) inlineOverrides(file, failures);
    if (/\.(?:ts|tsx|mts|cts)$/.test(file) && !covered.has(realpathSync(file)))
      failures.push(`源码未纳入统一 TypeScript 检查：${file}`);
  }
  for (const app of applications) failures.push(...checkBoundaries(root, app.config));
  if (failures.length) throw new Error(failures.join("\n"));
  for (const config of projects.keys())
    command([
      "exec",
      "tsc",
      "--project",
      config,
      "--noEmit",
      "--composite",
      "false",
      "--incremental",
      "false",
    ]);
  const lint = files.filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith(".d.ts"));
  // 空集合不能算通过：没有任何文件时下面两个循环一次都不执行，
  // 会打印「检查通过」并退出 0，与报告闸门的空集合判据冲突。
  if (!files.length || !lint.length)
    throw new Error(
      `前端检查未收集到可检查文件：files=${files.length} lint=${lint.length}；请确认模块图与源码目录`,
    );
  for (const [project, files] of lintProjects(
    lint,
    projects,
    path.join(root, "frontend/tsconfig.node.json"),
  ))
    for (let index = 0; index < files.length; index += 200)
      command([
        "exec",
        "oxlint",
        "--type-aware",
        "--deny-warnings",
        "--disable-nested-config",
        "--no-ignore",
        "--tsconfig",
        project,
        "-c",
        ".oxlintrc.json",
        ...files.slice(index, index + 200),
      ]);
  for (let index = 0; index < files.length; index += 200)
    command([
      "exec",
      "oxfmt",
      "--check",
      "--disable-nested-config",
      "--ignore-path",
      devNull,
      ...files.slice(index, index + 200),
    ]);
  console.log(
    `前端检查通过：${modules.length} 个模块，${files.length} 个文件，TypeScript ${version}`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runChecks();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
