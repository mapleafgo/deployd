import { expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

test("应用显式运行环境绑定客户端，同对象可重用且拒绝第二环境", async () => {
  vi.resetModules();
  const { createModuleProviders } = await import("../../.redberry/frontend/admin/providers");
  const { createTransport, request } = await import("../../.redberry/frontend/admin/http");
  const { i18n } = await import("../../frontend/i18n");
  const queryClient = new QueryClient();
  const http = createTransport({ i18n, origin: "https://app.test" });
  const runtime: Parameters<typeof createModuleProviders>[0] = {
    appName: "admin",
    i18n,
    http,
    queryClient,
  };
  vi.stubGlobal("fetch", async () => Response.json({ ok: true }));
  try {
    await expect(request("/api/runtime-test")).rejects.toThrow("尚未绑定");
    expect(typeof createModuleProviders(runtime)).toBe("function");
    await expect(request("/api/runtime-test")).resolves.toEqual({ ok: true });
    expect(() => createModuleProviders(runtime)).not.toThrow();
    expect(() => createModuleProviders({ ...runtime })).toThrow("另一运行环境");
    http.dispose();
    await expect(request("/api/runtime-test")).rejects.toThrow("已释放");
  } finally {
    http.dispose();
    queryClient.clear();
    vi.unstubAllGlobals();
  }
});
