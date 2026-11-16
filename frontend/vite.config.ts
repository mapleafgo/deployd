import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { validateApplicationPaths } from "../scripts/frontend/application.vite.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const web: {
  apps: Record<
    string,
    {
      directory: string;
      path: string;
      dev: { target: string; command: string[] };
    }
  >;
} = JSON.parse(readFileSync(new URL("../.redberry/web-apps.json", import.meta.url), "utf8"));
// 全部应用进程由 CLI 统一启动和关闭；后台只代理其他应用，不能再次接管生命周期。
const declarations = web.apps;
const applications = Object.fromEntries(
  Object.entries(declarations).filter(([name]) => name !== "admin"),
);
const graph: { modules: { dir: string }[] } = JSON.parse(
  readFileSync(new URL("../.redberry/module-graph.json", import.meta.url), "utf8"),
);

const adminApp = declarations.admin;
if (!adminApp) throw new Error("redberry.yaml 缺少 web.apps.admin 声明");
const adminBase = adminApp.path;
validateApplicationPaths(declarations);

// 按最长路径优先代理，并排除其他应用和后台的页面入口。
const proxyEntries = Object.entries(applications)
  .sort(([, a], [, b]) => b.path.length - a.path.length)
  .map(([name, app]) => {
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const excluded = [
      adminBase,
      "/api/",
      ...Object.entries(applications)
        .filter(([other]) => other !== name)
        .flatMap(([, other]) => [other.path]),
    ]
      .filter((value) => value !== "/" && value.startsWith(app.path) && value !== app.path)
      .map((value) => `${escape(value.slice(app.path.length).replace(/\/$/, ""))}(?:/|$)`);
    const key = `^${escape(app.path)}${excluded.length ? `(?!(?:${excluded.join("|")}))` : ""}`;
    return [key, { target: app.dev.target, ws: true }] as const;
  });

export default defineConfig({
  base: adminBase,
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "i18next",
      "react-i18next",
      "@tanstack/react-router",
      "@tanstack/react-query",
      "@mantine/core",
      "@mantine/hooks",
      "@mantine/dates",
    ],
  },
  server: {
    // 端口由 redberry.yaml 的 dev.target 决定，CLI 通过 --port 传入。
    host: "127.0.0.1",
    strictPort: true,
    fs: {
      allow: [
        projectRoot,
        ...graph.modules.map((module) => path.resolve(projectRoot, module.dir, "frontend")),
      ],
    },
    // 开发时 CLI 注入后端地址；未注入说明不是经 CLI 启动，代理保持关闭。
    proxy: process.env.VITE_API_TARGET
      ? {
          "/api": { target: process.env.VITE_API_TARGET },
          ...Object.fromEntries(proxyEntries),
        }
      : {},
  },
});
