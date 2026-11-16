import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { createInstance } from "i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { AuthProvider, createAuthSession, type AuthAPI } from "@red-berry-kit/auth";
import { UIProvider, translations as uiTranslations } from "@red-berry-kit/ui";
import { createProvider, type ModuleContext } from "./module";
import { translations, moduleNamespace } from "./messages";
import { createRoutes } from "./index";

it("关闭立即取消日志订阅但保留退出展示；身份失效立即清除敏感日志", async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: {
      "zh-CN": {
        [moduleNamespace]: translations["zh-CN"],
        "red-berry-kit/ui": uiTranslations["zh-CN"],
      },
    },
  });
  const pair = {
    access_token: "test-only",
    token_type: "Bearer",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 3600000).toISOString(),
  };
  const auth: AuthAPI = {
    challenge: async () => {
      throw new Error("unused");
    },
    login: async () => pair,
    csrf: async () => ({ csrf: "test" }),
    refresh: async () => pair,
    logout: async () => undefined,
    account: async () => ({
      id: "admin",
      source: "config",
      session_id: "test-session",
      name: "admin",
      claims: {},
    }),
  };
  const session = createAuthSession(auth, crypto.randomUUID());
  await session.login({
    username: "admin",
    challenge: "",
    binding: "",
    answer: "",
    password_envelope: { enc: "", ciphertext: "" },
  });
  const canceled = vi.fn();
  let signal: AbortSignal | null | undefined;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `event: log\ndata: ${JSON.stringify({ data: btoa("sensitive-output"), offset: 16 })}\n\n`,
          ),
        );
        signal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      },
      cancel: canceled,
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  });
  const unused = async (): Promise<never> => {
    throw new Error("unused");
  };
  const context: ModuleContext = {
    i18n,
    queryClient: new QueryClient(),
    scope: crypto.randomUUID(),
    http: { use: () => () => undefined },
    api: {
      listTasks: unused,
      createTask: unused,
      updateTask: unused,
      deleteTask: unused,
      triggerTask: unused,
      listRuns: async () => ({ items: [], page: 1, size: 20, total: 0 }),
      cancelRun: unused,
      getStreamRunLogUrl: () => "/test/events",
    },
  };
  const Provider = createProvider(context);
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren(createRoutes(root)),
    history: createMemoryHistory({ initialEntries: ["/runs?run=test"] }),
  });
  const screen = await render(
    <UIProvider i18n={i18n} scope={crypto.randomUUID()} brand={{ name: "test", homeHref: "/" }}>
      <AuthProvider session={session} i18n={i18n}>
        <QueryClientProvider client={context.queryClient}>
          <Provider>
            <RouterProvider router={router} />
          </Provider>
        </QueryClientProvider>
      </AuthProvider>
    </UIProvider>,
  );
  try {
    await expect
      .element(page.getByRole("region", { name: "查看日志", exact: true }))
      .toHaveTextContent("sensitive-output");
    await router.navigate({ to: "/runs", search: { page: 1, size: 20, q: "" } });
    await expect.poll(() => signal?.aborted).toBe(true);
    expect(router.state.location.search).not.toHaveProperty("run");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("sensitive-output");
    }
    // URL重新选择才重新打开；不由呈现快照另造selected状态。
    await router.navigate({ to: "/runs", search: { page: 1, size: 20, q: "", run: "test" } });
    await expect.element(page.getByRole("dialog", { name: "查看日志", exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("region", { name: "查看日志", exact: true }))
      .toHaveTextContent("sensitive-output");
    session.invalidate();
    await expect
      .element(page.getByText("sensitive-output", { exact: false }))
      .not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    fetchSpy.mockRestore();
    session.close();
  }
});
