import { expect, test, type Page } from "@playwright/test";
import { loadBrowserSetups } from "../../scripts/frontend/browser-setup.mjs";

const setups = await loadBrowserSetups();

function gate() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

async function createTask(page: Page, name: string, script = "printf 'verified\\n'") {
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
  await editor.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  await editor.getByRole("textbox", { name: "工作目录", exact: true }).first().fill("/tmp");
  await editor.getByRole("button", { name: /步骤设置/ }).click();
  await editor.getByRole("textbox", { name: "步骤名称", exact: true }).fill("验证");
  await editor.getByRole("textbox", { name: "Bash 脚本", exact: true }).fill(script);
  await editor.getByRole("button", { name: /^(保存|创建任务)$/, exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
}

async function deleteTask(page: Page, name: string) {
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "删除任务", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", { name: "删除任务", exact: true });
  await confirmation.getByRole("button", { name: "删除任务", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
}

test("真实触发结果迟到不抢走后发提交，提交期间关闭保护持续有效", async ({ page, baseURL }) => {
  test.setTimeout(45000);
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  const suffix = Date.now();
  const original = `late-run-${suffix}`;
  const created = `late-create-${suffix}`;
  await createTask(page, original);
  const triggerReached = gate();
  const releaseTrigger = gate();
  const saveReached = gate();
  const releaseSave = gate();
  await page.route("**/api/tasks/*/runs", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    triggerReached.release();
    await releaseTrigger.promise;
    await route.fulfill({ response });
  });
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    saveReached.release();
    await releaseSave.promise;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole("row")
      .filter({ hasText: original })
      .getByRole("button", { name: "运行任务", exact: true })
      .click();
    await triggerReached.promise;
    await page.getByRole("button", { name: "新增", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
    await editor.getByRole("textbox", { name: "名称", exact: true }).fill(created);
    await editor.getByRole("button", { name: /步骤设置/ }).click();
    await editor.getByRole("textbox", { name: "步骤名称", exact: true }).fill("后发提交");
    await editor.getByRole("textbox", { name: "Bash 脚本", exact: true }).fill("printf saved");
    await editor.getByRole("button", { name: /^(保存|创建任务)$/, exact: true }).click();
    await saveReached.promise;
    releaseTrigger.release();
    await expect(
      page.getByRole("button", {
        name: `查看已受理运行（${original}）`,
        exact: true,
        includeHidden: true,
      }),
    ).toHaveCount(1);
    await expect(
      editor.getByRole("button", { name: /^(保存|创建任务)$/, exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(editor).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    releaseSave.release();
    await expect(editor).not.toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: created })).toBeVisible();
    await page.getByRole("button", { name: `查看已受理运行（${original}）`, exact: true }).click();
    await expect(page).toHaveURL(/\/runs\?.*run=/);
    const log = page.getByRole("dialog", { name: "查看日志", exact: true });
    await expect(log.getByText("verified", { exact: false })).toBeVisible();
    await page.goto("/");
    await deleteTask(page, created);
    await deleteTask(page, original);
  } finally {
    releaseTrigger.release();
    releaseSave.release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("真实活动冲突后取消运行，原删除确认重试成功不残留旧错误", async ({ page, baseURL }) => {
  test.setTimeout(45000);
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  const name = `retry-delete-${Date.now()}`;
  await createTask(page, name, "printf 'running\\n'\nsleep 30");
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith(`/api/tasks/${name}/runs`),
  );
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "运行任务", exact: true })
    .click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  const run: unknown = await response.json();
  if (typeof run !== "object" || run === null || !("id" in run) || typeof run.id !== "string")
    throw new Error("受理响应缺少运行ID");
  const runId = run.id;
  const authorization = response.request().headers().authorization;
  if (!authorization) throw new Error("隔离测试请求缺少认证头");
  const headers = { Authorization: authorization };
  try {
    await expect(page.getByRole("dialog", { name: "查看日志", exact: true })).toBeVisible();
    await page.goto("/");
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "删除任务", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", { name: "删除任务", exact: true });
    const rejected = page.waitForResponse(
      (value) =>
        value.request().method() === "DELETE" && value.url().endsWith(`/api/tasks/${name}`),
    );
    await confirmation.getByRole("button", { name: "删除任务", exact: true }).click();
    const rejection = await rejected;
    expect(rejection.status()).toBe(409);
    await expect(confirmation.getByText("状态冲突", { exact: false })).toBeVisible();
    const requestId = rejection.headers()["x-request-id"];
    if (!requestId) throw new Error("真实错误反馈缺少关联编号");
    await expect(confirmation.getByText(requestId, { exact: false })).toBeVisible();
    const canceled = await page.request.post(`/api/runs/${runId}/cancel`, { headers });
    expect(canceled.status()).toBe(204);
    await expect
      .poll(async () => {
        const result = await page.request.get(`/api/runs/${runId}`, { headers });
        const body: unknown = await result.json();
        return typeof body === "object" && body !== null && "status" in body
          ? body.status
          : undefined;
      })
      .toBe("cancelled");
    await confirmation.getByRole("button", { name: "删除任务", exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
    await expect(page.getByText("状态冲突", { exact: false })).toHaveCount(0);
  } finally {
    await page.request.post(`/api/runs/${runId}/cancel`, { headers });
    await page.request.delete(`/api/tasks/${name}`, { headers });
  }
});
