import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { expect, test, vi } from "vitest";
import { validateApplicationPaths } from "../../scripts/frontend/application.vite";

function origin(server: ViteDevServer) {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("应用未监听");
  return `http://127.0.0.1:${address.port}`;
}

test("CLI 已启动其他应用时，真实后台 Vite 只代理且不会接管其生命周期", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "redberry-app-ownership-"));
  const children: ViteDevServer[] = [];
  let admin: ViteDevServer | undefined;
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await mkdir(path.join(root, ".redberry"));
    await mkdir(path.join(root, "scripts/frontend"), { recursive: true });
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
    const apps: Record<
      string,
      { directory: string; path: string; dev: { target: string; command: string[] } }
    > = {};
    for (const name of ["portal", "third"]) {
      const directory = path.join(root, name);
      await mkdir(directory);
      await writeFile(path.join(directory, "index.html"), `<html>${name}-ready</html>`);
      const child = await createServer({
        configFile: false,
        root: directory,
        base: `/${name}/`,
        server: { port: 0, host: "127.0.0.1", strictPort: true },
      });
      children.push(child);
      await child.listen();
      apps[name] = {
        directory: name,
        path: `/${name}/`,
        dev: { target: origin(child), command: ["node", "must-not-run.mjs"] },
      };
    }
    await mkdir(path.join(root, "frontend"));
    await writeFile(path.join(root, "frontend/index.html"), "<html>admin-ready</html>");
    apps.admin = {
      directory: "frontend",
      path: "/",
      dev: { target: "http://127.0.0.1:5173", command: ["pnpm", "exec", "vite"] },
    };
    await writeFile(path.join(root, ".redberry/web-apps.json"), JSON.stringify({ apps }));
    await writeFile(
      path.join(root, ".redberry/module-graph.json"),
      JSON.stringify({ modules: [{ dir: "." }] }),
    );
    await copyFile(
      path.resolve("frontend/vite.config.ts"),
      path.join(root, "frontend/vite.config.ts"),
    );
    await copyFile(
      path.resolve("scripts/frontend/application.vite.ts"),
      path.join(root, "scripts/frontend/application.vite.ts"),
    );
    vi.stubEnv("VITE_API_TARGET", "http://127.0.0.1:1");
    admin = await createServer({
      configFile: path.join(root, "frontend/vite.config.ts"),
      root: path.join(root, "frontend"),
      server: { port: 0 },
    });
    await admin.listen();
    for (const [route, body] of [
      ["/", "admin-ready"],
      ["/portal/", "portal-ready"],
      ["/third/", "third-ready"],
    ] as const) {
      const response = await fetch(`${origin(admin)}${route}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(body);
    }
    await admin.close();
    admin = undefined;
    for (const child of children)
      expect((await fetch(`${origin(child)}${child.config.base}`)).status).toBe(200);
  } finally {
    await admin?.close();
    await Promise.all(children.map((child) => child.close()));
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test("移除重复进程管理后仍拒绝冲突、API占用与路径穿越", () => {
  expect(() =>
    validateApplicationPaths({ admin: { path: "/" }, portal: { path: "/portal/" } }),
  ).not.toThrow();
  for (const invalid of [
    "/api/",
    "/api/users/",
    "/a/../b/",
    "/a//b/",
    "/a?b/",
    "relative/",
    "/no-trailing",
  ])
    expect(() => validateApplicationPaths({ portal: { path: invalid } })).toThrow();
  expect(() =>
    validateApplicationPaths({ first: { path: "/portal/" }, second: { path: "/portal/" } }),
  ).toThrow("应用路径冲突");
});
