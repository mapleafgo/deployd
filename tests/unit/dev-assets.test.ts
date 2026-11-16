import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { expect, test } from "vitest";

test("开发代理保留请求头并透传目标响应", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "redberry-vite-assets-"));
  await writeFile(path.join(directory, "index.html"), "<html>page</html>");
  await writeFile(path.join(directory, "present.js"), "export default 1");
  const target = await createServer({
    configFile: false,
    root: directory,
    plugins: [
      {
        name: "api-accept",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url?.includes("report.pdf")) {
              response.setHeader("content-type", "text/html");
              response.end("登录页面");
              return;
            }
            if (request.url?.includes("missing.js")) {
              response.statusCode = 404;
              response.end("missing");
              return;
            }
            if (!request.url?.includes("report.csv")) return next();
            response.end(request.headers.accept);
          });
        },
      },
    ],
    server: { port: 0, host: "127.0.0.1" },
  });
  await target.listen();
  const targetAddress = target.httpServer?.address();
  if (!targetAddress || typeof targetAddress === "string") throw new Error("目标监听失败");
  const host = await createServer({
    configFile: false,
    root: directory,
    base: "/admin/",
    server: {
      port: 0,
      host: "127.0.0.1",
      proxy: {
        "/api": { target: `http://127.0.0.1:${targetAddress.port}` },
        "/youpu/": {
          target: `http://127.0.0.1:${targetAddress.port}`,
          rewrite: (url) => url.replace(/^\/youpu/, ""),
        },
      },
    },
  });
  await host.listen();
  try {
    const address = host.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("宿主监听失败");
    const api = await fetch(`http://127.0.0.1:${address.port}/api/report.csv`, {
      headers: { accept: "application/json" },
    });
    expect(await api.text()).toBe("application/json");
    const app = await fetch(`http://127.0.0.1:${address.port}/youpu/report.csv`, {
      headers: { accept: "text/csv" },
    });
    expect(await app.text()).toBe("text/csv");
    const page = await fetch(`http://127.0.0.1:${address.port}/youpu/report.pdf`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("登录页面");
    expect((await fetch(`http://127.0.0.1:${address.port}/youpu/missing.js`)).status).toBe(404);
    for (const [url, status] of [
      ["/admin/users", 200],
      ["/admin/present.js", 200],
      ["/youpu/present.js", 200],
    ] as const) {
      expect((await fetch(`http://127.0.0.1:${address.port}${url}`)).status, url).toBe(status);
    }
  } finally {
    await host.close();
    await target.close();
    await rm(directory, { recursive: true, force: true });
  }
});
