import { afterEach, beforeEach, expect, test, vi } from "vitest";

let request: typeof import("../../.redberry/frontend/admin/http").request;
let transport: ReturnType<typeof import("../../.redberry/frontend/admin/http").createTransport>;
beforeEach(async () => {
  vi.resetModules();
  const generated = await import("../../.redberry/frontend/admin/http");
  const { i18n } = await import("../../frontend/i18n");
  transport = generated.createTransport({ i18n, origin: "https://app.test" });
  generated.bindRuntime({ appName: "admin", i18n, http: transport });
  request = generated.request;
});
afterEach(() => {
  transport?.dispose();
  vi.unstubAllGlobals();
});

test("请求中间件保留取消信号，卸载后不再附加头，业务写请求不重试", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const stop = transport.use((next) => (url, options) => {
    const headers = new Headers(options?.headers);
    headers.set("X-Test-Module", "active");
    return next(url, { ...options, headers });
  });
  try {
    const controller = new AbortController();
    await expect(
      request("/api/test", { method: "POST", signal: controller.signal }),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("X-Test-Module")).toBe("active");
    stop();
    await request("/api/test");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).has("X-Test-Module")).toBe(false);
  } finally {
    stop();
  }
});

test("HTTP错误保留status和Problem，供会话识别401", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ detail: "拒绝" }, { status: 401 })),
  );
  await expect(request("/api/test")).rejects.toMatchObject({
    status: 401,
    info: { detail: "拒绝" },
  });
});

test("成功状态的损坏响应保持结果不确定，不能伪装成确定的认证失败", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("invalid-json", { status: 200 })),
  );
  const failure: unknown = await request("/api/test").then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toHaveProperty("status");
});

test("无内容响应返回undefined", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  await expect(request("/api/test")).resolves.toBeUndefined();
});

test("同源请求跟随当前语言且不把语言设置泄漏给外部来源", async () => {
  const { i18n } = await import("../../frontend/i18n");
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await i18n.changeLanguage("en");
    await request("/api/test");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Accept-Language")).toBe("en");
    await i18n.changeLanguage("zh-CN");
    await request("/api/test");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("Accept-Language")).toBe("zh-CN");
    await request("https://other.test/api/test");
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).has("Accept-Language")).toBe(false);
  } finally {
    await i18n.changeLanguage("zh-CN");
  }
});
