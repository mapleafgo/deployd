import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBrowserSetups } from "../../scripts/frontend/browser-setup.mjs";

it("模块测试准备按依赖执行，保留匿名场景且加载失败不静默跳过", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "redberry-browser-"));
  try {
    const select = (ids: string[]) => {
      mkdirSync(path.join(root, ".redberry/frontend/admin"), { recursive: true });
      writeFileSync(
        path.join(root, ".redberry/frontend/admin/shell.metadata.json"),
        JSON.stringify({ inputs: ids.map((moduleID) => ({ moduleID })) }),
      );
    };
    select(["a-dependent", "z-provider"]);
    for (const name of ["first", "second"])
      mkdirSync(path.join(root, name, "testing"), { recursive: true });
    writeFileSync(
      path.join(root, ".redberry/module-graph.json"),
      JSON.stringify({
        modules: [
          { id: "a-dependent", dir: "second", deps: { "z-provider": "^0.1.0" } },
          { id: "z-provider", dir: "first", deps: {} },
        ],
        targets: {},
      }),
    );
    writeFileSync(
      path.join(root, "first/testing/browser.mjs"),
      'export async function setup({page}) {page.push("first")}',
    );
    writeFileSync(
      path.join(root, "second/testing/browser.mjs"),
      'export async function prepare({page}) {page.push("prepared")}; export const snapshotSuffix="auth"; export async function setup({page}) {if(page[0]!=="prepared" || page[1]!=="first") throw new Error("依赖尚未准备");page.push("second")}',
    );
    const modules = await loadBrowserSetups(root);
    const page: string[] = [];
    for (const module of modules) await module.prepare?.({ page });
    for (const module of modules) await module.setup?.({ page });
    expect(page).toEqual(["prepared", "first", "second"]);
    expect(modules.map((module) => module.snapshotSuffix).filter(Boolean)).toEqual(["auth"]);
    writeFileSync(
      path.join(root, ".redberry/module-graph.json"),
      JSON.stringify({ modules: [{ id: "app", dir: ".", deps: {} }], targets: {} }),
    );
    select([]);
    expect(await loadBrowserSetups(root)).toEqual([]);
    writeFileSync(
      path.join(root, ".redberry/module-graph.json"),
      JSON.stringify({ modules: [{ id: "broken", dir: "broken", deps: {} }], targets: {} }),
    );
    mkdirSync(path.join(root, "broken/testing"), { recursive: true });
    writeFileSync(
      path.join(root, "broken/testing/browser.mjs"),
      'throw new Error("准备入口加载失败")',
    );
    select(["broken"]);
    await expect(loadBrowserSetups(root)).rejects.toThrow("准备入口加载失败");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("未参与前端的模块仍准备API数据，但不执行其页面setup或settle", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "redberry-browser-selection-"));
  const write = (file: string, value: string) => {
    const filename = path.join(root, file);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, value);
  };
  try {
    write(
      ".redberry/module-graph.json",
      JSON.stringify({
        modules: [
          { id: "poc/auth", dir: "auth", deps: {} },
          { id: "poc/user", dir: "user", deps: { "poc/auth": "^0.1.0" } },
        ],
        targets: {},
      }),
    );
    write(
      ".redberry/frontend/admin/shell.metadata.json",
      JSON.stringify({ inputs: [{ moduleID: "poc/auth" }] }),
    );
    write(
      "auth/testing/browser.mjs",
      'export async function setup({page}) { if(page[0]!=="backend-ready") throw new Error("账户未准备"); page.push("auth"); }',
    );
    write(
      "user/testing/browser.mjs",
      'export const snapshotSuffix="user"; export async function prepare({page}) { page.push("backend-ready"); } export async function setup() { throw new Error("不得访问未装配users页面"); } export async function settle() { throw new Error("不得等待未装配users页面"); }',
    );
    const modules = await loadBrowserSetups(root);
    const page: string[] = [];
    for (const module of modules) await module.prepare?.({ page });
    for (const module of modules) await module.setup?.({ page });
    for (const module of modules) await module.settle?.({ page });
    expect(page).toEqual(["backend-ready", "auth"]);
    expect(modules.map((module) => module.snapshotSuffix).filter(Boolean)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
