import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// pnpm 脚本优先复用当前包管理器；它既可能是 JS 入口，也可能是原生可执行文件。
// Windows 的 corepack.cmd 不能直接 spawn，改用已安装包声明的 Node bin 入口。
export function pnpmCommand(env = process.env, platform = process.platform) {
  const entry = env.npm_execpath;
  if (
    entry &&
    /^pnpm\//.test(env.npm_config_user_agent ?? "") &&
    !/\.(?:cmd|bat|ps1)$/i.test(entry)
  ) {
    return /\.[cm]?js$/i.test(entry) ? [process.execPath, entry] : [entry];
  }
  if (platform !== "win32") return ["corepack", "pnpm"];

  const search = [
    process.cwd(),
    path.dirname(process.execPath),
    ...(env.PATH ?? env.Path ?? "").split(path.delimiter),
  ];
  let manifest;
  try {
    manifest = require.resolve("corepack/package.json", { paths: search });
  } catch (cause) {
    throw new Error("无法定位 Corepack 的 Node 入口，请安装 Corepack 或通过 pnpm 运行此脚本", {
      cause,
    });
  }
  const bin = JSON.parse(readFileSync(manifest, "utf8")).bin?.corepack;
  if (typeof bin !== "string") throw new Error("Corepack 安装缺少 bin.corepack 入口");
  return [process.execPath, path.resolve(path.dirname(manifest), bin), "pnpm"];
}

export function runPnpm(args, options = {}) {
  const [command, ...prefix] = pnpmCommand(options.env ?? process.env);
  const result = spawnSync(command, [...prefix, ...args], { ...options, shell: false });
  if (result.error)
    throw new Error(`无法启动 pnpm：${result.error.message}`, { cause: result.error });
  return result;
}
