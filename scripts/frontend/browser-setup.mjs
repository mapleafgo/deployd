import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 只读取安装图中的公开测试入口，不导入生产Provider或猜测模块的认证协议。
export async function loadBrowserSetups(root = process.cwd(), appName = "admin") {
  const graph = JSON.parse(readFileSync(path.join(root, ".redberry/module-graph.json"), "utf8"));
  const metadata = JSON.parse(
    readFileSync(path.join(root, ".redberry/frontend", appName, "shell.metadata.json"), "utf8"),
  );
  const participating = new Set(metadata.inputs.map((input) => input.moduleID));
  const modules = new Map(graph.modules.map((module) => [module.id, module]));
  const visited = new Set();
  const active = new Set();
  const setups = [];
  async function visit(id) {
    if (visited.has(id)) return;
    if (active.has(id)) throw new Error("模块浏览器测试准备存在依赖环");
    const module = modules.get(id);
    if (!module) throw new Error(`测试安装图缺少模块 ${id}`);
    active.add(id);
    for (const dependency of Object.keys(module.deps ?? {}).sort((left, right) =>
      left.localeCompare(right),
    ))
      await visit(graph.targets?.[dependency] ?? dependency);
    const filename = path.resolve(root, module.dir, "testing/browser.mjs");
    if (existsSync(filename)) {
      const setup = await import(pathToFileURL(filename).href);
      if (typeof setup.setup !== "function") throw new Error(`模块 ${id} 未导出测试setup`);
      if (setup.prepare !== undefined && typeof setup.prepare !== "function")
        throw new Error(`模块 ${id} 的测试prepare必须是函数`);
      if (setup.settle !== undefined && typeof setup.settle !== "function")
        throw new Error(`模块 ${id} 的测试settle必须是函数`);
      if (setup.snapshotSuffix !== undefined && !/^[a-zA-Z0-9_-]+$/.test(setup.snapshotSuffix))
        throw new Error(`模块 ${id} 的测试快照名称无效`);
      // 后端模块仍安装：API 数据准备不得随前端选择丢失；只过滤页面阶段。
      if (participating.has(id)) setups.push(setup);
      else if (setup.prepare) setups.push({ prepare: setup.prepare });
    }
    active.delete(id);
    visited.add(id);
  }
  for (const id of [...modules.keys()].sort((left, right) => left.localeCompare(right)))
    await visit(id);
  return setups;
}
