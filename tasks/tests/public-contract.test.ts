import { expect, it } from "vitest";
import { typecheckDiagnostics } from "./typecheck-command";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

it("类型检查进程非零且仅有stderr也必须失败并保留诊断", () => {
  const diagnostics = typecheckDiagnostics(process.execPath, [
    "-e",
    'process.stderr.write("stderr-only-probe"); process.exit(42)',
  ]);
  expect(diagnostics).not.toBe("");
  expect(diagnostics).toContain("42");
  expect(diagnostics).toContain("stderr-only-probe");
});

it("静默非零与启动失败均不能通过类型检查闸门", () => {
  expect(typecheckDiagnostics(process.execPath, ["-e", "process.exit(3)"])).not.toBe("");
  expect(typecheckDiagnostics("/does-not-exist/typecheck-probe", [])).not.toBe("");
  expect(typecheckDiagnostics(process.execPath, ["-e", "process.exit(0)"])).toBe("");
});

it("正式包入口公开ModuleContext与TasksPage，并保留ModulePage兼容别名", () => {
  // 包内独立消费者以包名自引用，真实经过 package.json exports，而非深导入。
  const directory = mkdtempSync(path.resolve("tasks/frontend/.public-contract-"));
  const file = path.join(directory, "consumer.ts");
  try {
    writeFileSync(
      file,
      'import { createProvider, TasksPage, ModulePage, type ModuleContext } from "@mapleafgo/tasks";\ndeclare const context: ModuleContext;\ncreateProvider(context);\nconst compatible: typeof TasksPage = ModulePage;\nvoid compatible;',
    );
    const config = path.join(directory, "tsconfig.json");
    writeFileSync(
      config,
      JSON.stringify({
        extends: path.resolve("frontend/tsconfig.app.json"),
        compilerOptions: { composite: false, incremental: false, types: ["vite/client"] },
        include: [],
        files: [file],
      }),
    );
    expect(
      typecheckDiagnostics("pnpm", [
        "exec",
        "tsc",
        "--project",
        config,
        "--noEmit",
        "--incremental",
        "false",
      ]),
    ).toBe("");
  } finally {
    // directory 来自拥有的 frontend 内 mkdtemp，不接受外部路径。
    rmSync(directory, { recursive: true });
  }
});
