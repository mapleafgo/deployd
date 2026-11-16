import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("生成的 Node 配置使用 Node 工程检查，业务和生成运行时代码继续使用浏览器工程", () => {
  const script = pathToFileURL(path.resolve("scripts/frontend/check.mjs")).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import * as checks from ${JSON.stringify(script)};
    const groups = checks.lintProjects?.(
      ["/app/.redberry/frontend/admin/http.ts", "/app/.redberry/frontend/orval.config.ts", "/app/tests/unit/a.test.ts", "/app/scripts/frontend/check.mjs"],
      new Map([
        ["app", new Set(["/app/.redberry/frontend/admin/http.ts"])],
        ["node", new Set(["/app/.redberry/frontend/orval.config.ts"])],
        ["test", new Set(["/app/tests/unit/a.test.ts"])],
      ]),
    );
    console.log(JSON.stringify(groups ? Object.fromEntries(groups) : null));
  `,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    app: ["/app/.redberry/frontend/admin/http.ts"],
    node: ["/app/.redberry/frontend/orval.config.ts", "/app/scripts/frontend/check.mjs"],
    test: ["/app/tests/unit/a.test.ts"],
  });
});

test("两个应用从各自元数据取得模块输入，ui-only 不扫描 web 或未参与模块", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "redberry-check-apps-"));
  const write = (file: string, value: unknown) => {
    const filename = path.join(root, file);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, JSON.stringify(value));
  };
  try {
    write(".redberry/web-apps.json", {
      apps: { admin: { directory: "frontend" }, portal: { directory: "portal" } },
    });
    write(".redberry/frontend/admin/shell.metadata.json", {
      inputs: [{ moduleID: "poc/ui", file: path.join(root, "ui/frontend/index.ts") }],
    });
    write(".redberry/frontend/portal/shell.metadata.json", {
      inputs: [{ moduleID: "poc/web", file: path.join(root, "web/frontend/index.ts") }],
    });
    const script = pathToFileURL(path.resolve("scripts/frontend/check.mjs")).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import * as checks from ${JSON.stringify(script)};
      const apps = checks.applicationProjects?.(${JSON.stringify(root)});
      console.log(JSON.stringify(apps?.map(app => ({name:app.name, inputs:app.inputs.map(input=>input.moduleID), config:app.config})) ?? null));
    `,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      {
        name: "admin",
        inputs: ["poc/ui"],
        config: path.join(root, ".redberry/frontend/admin/tsconfig.modules.json"),
      },
      {
        name: "portal",
        inputs: ["poc/web"],
        config: path.join(root, ".redberry/frontend/portal/tsconfig.modules.json"),
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
