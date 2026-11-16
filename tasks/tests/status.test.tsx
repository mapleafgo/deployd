import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { UIProvider, translations as uiTranslations } from "@red-berry-kit/ui";
import { i18n } from "../../frontend/i18n";
import { createProvider, type ModuleContext } from "../frontend/module";
import { createRoutes, translations, moduleNamespace } from "../frontend";

it("真实应用flat i18n下历史终态显示已取消而不是翻译键", async () => {
  for (const language of ["zh-CN", "en"] as const) {
    i18n.addResourceBundle(language, moduleNamespace, translations[language]);
    i18n.addResourceBundle(language, "red-berry-kit/ui", uiTranslations[language]);
  }
  await i18n.changeLanguage("zh-CN");
  const queryClient = new QueryClient();
  const unavailable = async (): Promise<never> => {
    throw new Error("unused");
  };
  const context: ModuleContext = {
    i18n,
    queryClient,
    scope: "status-regression",
    http: { use: () => () => undefined },
    api: {
      listTasks: unavailable,
      createTask: unavailable,
      updateTask: unavailable,
      deleteTask: unavailable,
      triggerTask: unavailable,
      cancelRun: unavailable,
      getStreamRunLogUrl: () => "",
      listRuns: async () => ({
        items: [
          {
            id: "run-1",
            name: "demo",
            status: "cancelled",
            created_at: "2026-11-13T10:00:00Z",
            started_at: null,
            finished_at: null,
          },
        ],
        page: 1,
        size: 20,
        total: 1,
      }),
    },
  };
  const Provider = createProvider(context);
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren(createRoutes(root)),
    history: createMemoryHistory({ initialEntries: ["/runs"] }),
  });
  const screen = await render(
    <UIProvider i18n={i18n} scope="status-regression-ui" brand={{ name: "test", homeHref: "/" }}>
      <QueryClientProvider client={queryClient}>
        <Provider>
          <RouterProvider router={router} />
        </Provider>
      </QueryClientProvider>
    </UIProvider>,
  );
  await expect.element(page.getByRole("cell", { name: "名称", exact: true })).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "任务名称", exact: true })).toBeVisible();
  await expect.element(
    page.getByPlaceholder("按任务名称包含匹配，不区分大小写", { exact: true }),
  ).toBeVisible();
  await expect.element(page.getByText("已取消", { exact: true })).toBeVisible();
  await i18n.changeLanguage("en");
  await expect.element(page.getByRole("cell", { name: "Name", exact: true })).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "Task name", exact: true })).toBeVisible();
  await expect.element(
    page.getByPlaceholder("Substring match on task name, case-insensitive", { exact: true }),
  ).toBeVisible();
  await expect.element(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await screen.unmount();
  queryClient.clear();
});

it("任务页复合筛选的标题与说明在双语下分别可读", async () => {
  for (const language of ["zh-CN", "en"] as const) {
    i18n.addResourceBundle(language, moduleNamespace, translations[language]);
    i18n.addResourceBundle(language, "red-berry-kit/ui", uiTranslations[language]);
  }
  await i18n.changeLanguage("zh-CN");
  const queryClient = new QueryClient();
  const unavailable = async (): Promise<never> => {
    throw new Error("unused");
  };
  const context: ModuleContext = {
    i18n,
    queryClient,
    scope: "tasks-search-copy",
    http: { use: () => () => undefined },
    api: {
      listTasks: async () => ({ items: [], page: 1, size: 20, total: 0 }),
      createTask: unavailable,
      updateTask: unavailable,
      deleteTask: unavailable,
      triggerTask: unavailable,
      cancelRun: unavailable,
      getStreamRunLogUrl: () => "",
      listRuns: async () => ({ items: [], page: 1, size: 20, total: 0 }),
    },
  };
  const Provider = createProvider(context);
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren(createRoutes(root)),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const screen = await render(
    <UIProvider i18n={i18n} scope="tasks-search-copy-ui" brand={{ name: "test", homeHref: "/" }}>
      <QueryClientProvider client={queryClient}>
        <Provider>
          <RouterProvider router={router} />
        </Provider>
      </QueryClientProvider>
    </UIProvider>,
  );
  await expect.element(page.getByRole("textbox", { name: "关键词", exact: true })).toBeVisible();
  await expect.element(page.getByPlaceholder("任务名称或说明", { exact: true })).toBeVisible();
  await i18n.changeLanguage("en");
  await expect.element(page.getByRole("textbox", { name: "Keyword", exact: true })).toBeVisible();
  await expect
    .element(page.getByPlaceholder("Task name or description", { exact: true }))
    .toBeVisible();
  await screen.unmount();
  queryClient.clear();
});
