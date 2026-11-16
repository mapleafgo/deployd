import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { createInstance } from "i18next";
import { QueryClient } from "@tanstack/react-query";
import { UIProvider, translations as uiTranslations } from "@red-berry-kit/ui";
import { createProvider, type ModuleContext, type Task } from "../frontend/module";
import { translations, moduleNamespace } from "../frontend/messages";
import { TaskEditor } from "../frontend/task-editor";

it("保存失败保留字段，重试不改原独立commands，语言变化不丢草稿", async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    fallbackLng: "en",
    resources: {
      "zh-CN": {
        [moduleNamespace]: translations["zh-CN"],
        "red-berry-kit/ui": uiTranslations["zh-CN"],
      },
      en: { [moduleNamespace]: translations.en, "red-berry-kit/ui": uiTranslations.en },
    },
  });
  const task: Task = {
    name: "sample",
    description: "original",
    workdir: "/tmp",
    timeout: ".5h",
    queue: "wait",
    parallel: false,
    env: { A: "a=b", EMPTY: "" },
    steps: [{ name: "main", workdir: "", env: {}, commands: ["cd /tmp", "echo done"] }],
    token: "secret",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const updateTask = vi
    .fn<ModuleContext["api"]["updateTask"]>()
    .mockRejectedValueOnce({
      status: 409,
      requestId: "req-form",
      info: {
        errors: [
          { location: "body.description" },
          { location: "body.workdir", code: "absoluteWorkdir" },
          { location: "body.workdir", code: "noNul" },
          { location: "body.steps[0].name" },
          { location: "body.env.A", code: "envName", message: "secret-env-value" },
        ],
      },
    })
    .mockResolvedValue(task);
  const context: ModuleContext = {
    i18n,
    queryClient: new QueryClient(),
    scope: "tasks-test",
    http: { use: () => () => undefined },
    api: {
      updateTask,
      listTasks: async () => ({ items: [], page: 1, size: 20, total: 0 }),
      createTask: async () => task,
      deleteTask: async () => undefined,
      triggerTask: async () => {
        throw new Error("unused");
      },
      listRuns: async () => ({ items: [], page: 1, size: 20, total: 0 }),
      cancelRun: async () => undefined,
      getStreamRunLogUrl: () => "",
    },
  };
  const Provider = createProvider(context);
  const saved = vi.fn();
  const screen = await render(
    <UIProvider i18n={i18n} scope="tasks-editor-regression" brand={{ name: "test", homeHref: "/" }}>
      <Provider>
        <TaskEditor
          task={task}
          onBusy={() => undefined}
          onCancel={() => undefined}
          onSaved={saved}
        />
      </Provider>
    </UIProvider>,
  );
  await page.getByRole("textbox", { name: "说明", exact: true }).fill("draft");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .element(page.getByText("状态冲突，活动任务无法删除或同名任务已存在。 · req-form"))
    .toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "说明", exact: true }))
    .toHaveValue("draft");
  await expect
    .element(page.getByText("请输入绝对工作目录路径。; 输入不能包含空字符。", { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByText("环境变量名称须以字母或下划线开头，且仅含字母、数字和下划线。", {
        exact: true,
      }),
    )
    .toBeVisible();
  expect(document.body.textContent).not.toContain("secret-env-value");
  expect(saved).not.toHaveBeenCalled();
  await expect.element(page.getByText("req-form", { exact: false })).toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "说明", exact: true }))
    .toHaveAttribute("aria-invalid", "true");
  await expect
    .element(page.getByRole("textbox", { name: "工作目录", exact: true }).first())
    .toHaveAttribute("aria-invalid", "true");
  await page.getByRole("textbox", { name: "说明", exact: true }).fill("draft-corrected");
  await expect
    .element(page.getByRole("textbox", { name: "说明", exact: true }))
    .not.toHaveAttribute("aria-invalid", "true");
  await expect
    .element(page.getByRole("textbox", { name: "工作目录", exact: true }).first())
    .toHaveAttribute("aria-invalid", "true");
  await expect
    .element(page.getByRole("textbox", { name: "步骤名称", exact: true }).first())
    .toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "添加步骤", exact: true }).click();
  await page.getByRole("button", { name: "删除步骤", exact: true }).nth(1).click();
  await expect
    .element(page.getByRole("textbox", { name: "步骤名称", exact: true }).first())
    .toHaveAttribute("aria-invalid", "true");
  await page.getByRole("textbox", { name: "步骤名称", exact: true }).first().fill("main-corrected");
  await page.getByRole("textbox", { name: "工作目录", exact: true }).first().fill("/tmp/.");
  await i18n.changeLanguage("en");
  await expect
    .element(
      page.getByText(
        "Environment variable names must start with a letter or underscore and contain only letters, digits and underscores.",
        { exact: true },
      ),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "Description", exact: true }))
    .toHaveValue("draft-corrected");
  await page
    .getByRole("textbox", { name: "Variable name", exact: true })
    .first()
    .fill("A_corrected");
  await page.getByRole("textbox", { name: "Variable name", exact: true }).first().fill("A");
  await expect
    .element(
      page.getByText(
        "Environment variable names must start with a letter or underscore and contain only letters, digits and underscores.",
        { exact: true },
      ),
    )
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(updateTask.mock.calls[1]?.[1].steps[0]?.commands).toEqual(["cd /tmp", "echo done"]);
  expect(updateTask.mock.calls[1]?.[1].env).toEqual({ A: "a=b", EMPTY: "" });
  expect(updateTask.mock.calls[1]?.[1].timeout).toBe(".5h");
  const timeout = page.getByRole("textbox", { name: "Timeout", exact: true });
  for (const invalid of ["999999999ns", "24h1ns", "-1s", "1d"]) {
    await timeout.fill(invalid);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(timeout).toHaveAttribute("aria-invalid", "true");
    expect(updateTask).toHaveBeenCalledTimes(2);
  }
  for (const valid of [
    "+30m",
    "1000000us",
    "1000000µs",
    "1000000μs",
    "1.s",
    "24h",
    "9223372036854775808ns9223372036854775808ns1s",
    "9223372036854775808ns9223372036854775808ns24h",
  ]) {
    const before = updateTask.mock.calls.length;
    await timeout.fill(valid);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledTimes(before + 1));
    expect(updateTask.mock.calls[before]?.[1].timeout).toBe(valid);
  }
  await screen.unmount();
});
