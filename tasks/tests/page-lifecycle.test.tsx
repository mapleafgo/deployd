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
import { UIProvider, translations as uiTranslations } from "@red-berry-kit/ui";
import { createRoutes } from "../frontend";
import { createProvider, type ModuleContext, type Task, type Run } from "../frontend/module";
import { translations, moduleNamespace } from "../frontend/messages";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const task: Task = {
  name: "sample",
  description: "original",
  workdir: "/tmp",
  timeout: "30m",
  queue: "wait",
  parallel: false,
  env: {},
  steps: [{ name: "main", workdir: "", env: {}, commands: ["echo done"] }],
  token: "test-only",
  updated_at: "2026-01-01T00:00:00Z",
};
async function setup(overrides: Partial<ModuleContext["api"]> = {}) {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: {
      "zh-CN": {
        [moduleNamespace]: translations["zh-CN"],
        "red-berry-kit/ui": uiTranslations["zh-CN"],
      },
      en: { [moduleNamespace]: translations.en, "red-berry-kit/ui": uiTranslations.en },
    },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Provider = createProvider({
    i18n,
    queryClient,
    scope: crypto.randomUUID(),
    http: { use: () => () => undefined },
    api: {
      listTasks: async () => ({ items: [task], page: 1, size: 20, total: 1 }),
      createTask: async () => task,
      updateTask: async () => task,
      deleteTask: async () => undefined,
      triggerTask: async () => {
        throw new Error("unused");
      },
      listRuns: async () => ({ items: [], page: 1, size: 20, total: 0 }),
      cancelRun: async () => undefined,
      getStreamRunLogUrl: () => "",
      ...overrides,
    },
  });
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren(createRoutes(root)),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const screen = await render(
    <UIProvider i18n={i18n} scope={crypto.randomUUID()} brand={{ name: "test", homeHref: "/" }}>
      <QueryClientProvider client={queryClient}>
        <Provider>
          <RouterProvider router={router} />
        </Provider>
      </QueryClientProvider>
    </UIProvider>,
  );
  await expect.element(page.getByText("original", { exact: true })).toBeVisible();
  return { screen, i18n, router };
}

it("旧运行请求完成不能解除仍在提交的编辑面板保护", async () => {
  const run = deferred<Run>();
  const save = deferred<Task>();
  const createTask = vi.fn(() => save.promise);
  const { screen } = await setup({ triggerTask: () => run.promise, createTask });
  await page.getByRole("button", { name: "运行任务", exact: true }).click();
  await page.getByRole("button", { name: translations["zh-CN"].create, exact: true }).click();
  await page
    .getByRole("textbox", { name: translations["zh-CN"].name, exact: true })
    .first()
    .fill("new-task");
  await page
    .getByRole("textbox", { name: translations["zh-CN"].stepNameLabel, exact: true })
    .last()
    .fill("main");
  await page.getByRole("textbox", { name: "Shell 脚本", exact: true }).fill("echo done");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await vi.waitFor(() => expect(createTask).toHaveBeenCalledOnce());
  run.reject({ status: 500, requestId: "old-trigger" });
  await expect.element(page.getByText("old-trigger", { exact: false })).toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "关闭编辑面板", exact: true }))
    .toBeDisabled();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  save.resolve(task);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await screen.unmount();
});

it("旧运行成功迟到不能导航卸载后发编辑；仍提供已受理运行入口", async () => {
  const run = deferred<Run>();
  const { screen, router } = await setup({ triggerTask: () => run.promise });
  await page.getByRole("button", { name: "运行任务", exact: true }).click();
  await page.getByRole("button", { name: translations["zh-CN"].create, exact: true }).click();
  await page
    .getByRole("textbox", { name: translations["zh-CN"].name, exact: true })
    .first()
    .fill("retained-draft");
  run.resolve({
    id: "accepted",
    name: "sample",
    status: "queued",
    created_at: "2026-01-01T00:00:00Z",
    started_at: null,
    finished_at: null,
  });
  await expect
    .element(page.getByRole("button", { name: "查看已受理运行（sample）", exact: true }))
    .toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/");
  await expect
    .element(page.getByRole("textbox", { name: translations["zh-CN"].name, exact: true }).first())
    .toHaveValue("retained-draft");
  await screen.unmount();
});

it("删除失败原面板重试成功后不留下旧错误", async () => {
  const deleteTask = vi
    .fn<ModuleContext["api"]["deleteTask"]>()
    .mockRejectedValueOnce({ status: 409, requestId: "delete-first" })
    .mockResolvedValueOnce(undefined);
  const { screen } = await setup({ deleteTask });
  await page.getByRole("button", { name: "删除任务", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除任务", exact: true }).click();
  await expect
    .element(page.getByRole("dialog").getByText("delete-first", { exact: false }))
    .toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "删除任务", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(deleteTask).toHaveBeenCalledTimes(2);
  await expect.element(page.getByText("delete-first", { exact: false })).not.toBeInTheDocument();
  await screen.unmount();
});

it("删除成功后刷新失败归列表，关闭动画仍保留删除对象", async () => {
  const listTasks = vi
    .fn<ModuleContext["api"]["listTasks"]>()
    .mockResolvedValueOnce({ items: [task], page: 1, size: 20, total: 1 })
    .mockRejectedValue({ status: 503, requestId: "refresh-only" });
  const { screen } = await setup({ listTasks });
  await page.getByRole("button", { name: "删除任务", exact: true }).click();
  const button = page
    .getByRole("dialog")
    .getByRole("button", { name: "删除任务", exact: true })
    .element();
  if (!(button instanceof HTMLButtonElement)) throw new Error("删除入口必须为按钮");
  button.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("确定删除任务 sample");
  }
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(page.getByText("refresh-only", { exact: false })).toBeVisible();
  await screen.unmount();
});

it("关闭意图后退出动画保留编辑对象及标题，完成后再次新增是空表单", async () => {
  const { screen } = await setup();
  await page.getByRole("button", { name: "编辑任务", exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "编辑任务", exact: true })).toBeVisible();
  // 同一事件内观察关闭后的下一帧，避免自动等待跨过退出动画。
  const close = page.getByRole("button", { name: "取消", exact: true }).element();
  if (!(close instanceof HTMLButtonElement)) throw new Error("取消入口必须为按钮");
  close.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const dialog = document.querySelector('[role="dialog"]');
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    expect(dialog?.textContent).toContain("编辑任务");
    expect(dialog?.querySelector("input")?.value).toBe("sample");
  }
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await page.getByRole("button", { name: translations["zh-CN"].create, exact: true }).click();
  await expect
    .element(page.getByRole("textbox", { name: translations["zh-CN"].name, exact: true }).first())
    .toHaveValue("");
  await screen.unmount();
});
