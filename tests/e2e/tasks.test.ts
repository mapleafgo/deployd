import { expect, test } from "@playwright/test";
import { loadBrowserSetups } from "../../scripts/frontend/browser-setup.mjs";

const setups = await loadBrowserSetups();

test("匿名访问任务 API 被拒绝，真实验证码登录后进入任务页面", async ({
  page,
  request,
  baseURL,
}) => {
  const anonymous = await request.get("/api/tasks");
  expect(anonymous.status()).toBe(401);
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "任务", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增", exact: true })).toBeVisible();
});

test("新增任务、真实运行实时日志、取消并删除任务", async ({ page, baseURL }) => {
  test.setTimeout(60000);
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  const name = `e2e-${Date.now()}`;
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
  await editor.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  await editor.getByRole("textbox", { name: "工作目录", exact: true }).first().fill("/tmp");
  await editor.getByRole("button", { name: /步骤设置/ }).click();
  await editor.getByRole("textbox", { name: "步骤名称", exact: true }).fill("输出");
  await editor
    .getByRole("textbox", { name: "Bash 脚本", exact: true })
    .fill("printf '实时首段中文\\n'\nsleep 20\nprintf '结束尾段\\n'");
  await editor.getByRole("button", { name: /^(保存|创建任务)$/, exact: true }).click();
  await expect(editor).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "运行任务", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\?.*run=/);
  const log = page.getByRole("dialog", { name: "查看日志", exact: true });
  await expect(log).toBeVisible();
  await expect(log.getByText("实时首段中文", { exact: false })).toBeVisible();
  await expect(log.getByText("结束尾段", { exact: false })).not.toBeVisible();
  await log.getByRole("button", { name: "取消运行", exact: true }).click();
  await expect(log.getByText("已取消", { exact: true })).toBeVisible({ timeout: 10000 });
  await page.goto("/");
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "删除任务", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "删除任务", exact: true });
  await confirm.getByRole("button", { name: "删除任务", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
});

test("窄屏任务编辑保持字段和提交操作可达", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
  await editor.getByRole("textbox", { name: "名称", exact: true }).fill("mobile-draft");
  await editor.getByRole("textbox", { name: "Bash 脚本", exact: true }).fill("printf mobile");
  await editor
    .getByRole("button", { name: /^(保存|创建任务)$/, exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    editor.getByRole("button", { name: /^(保存|创建任务)$/, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/rebuild-mobile.png", fullPage: true });
  await expect(editor.getByRole("textbox", { name: "名称", exact: true })).toHaveValue(
    "mobile-draft",
  );
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(editor).not.toBeVisible();
});

test("取消失败保留反馈，真实日志仍继续输出", async ({ page, baseURL }) => {
  test.setTimeout(45000);
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  const name = `cancel-error-${Date.now()}`;
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
  await editor.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  await editor.getByRole("button", { name: /步骤设置/ }).click();
  await editor.getByRole("textbox", { name: "步骤名称", exact: true }).fill("持续输出");
  await editor
    .getByRole("textbox", { name: "Bash 脚本", exact: true })
    .fill("printf '取消前输出\\n'\nsleep 2\nprintf '取消失败后仍输出\\n'\nsleep 15");
  await editor.getByRole("button", { name: /^(保存|创建任务)$/, exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "运行任务", exact: true })
    .click();
  const log = page.getByRole("dialog", { name: "查看日志", exact: true });
  await expect(log.getByText("取消前输出", { exact: false })).toBeVisible();
  await page.route("**/api/runs/*/cancel", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({ status: 503, code: "serverUnavailable" }),
    }),
  );
  await log.getByRole("button", { name: "取消运行", exact: true }).click();
  await expect(log.getByText("取消失败：", { exact: false })).toBeVisible();
  await expect(log.getByText("取消失败后仍输出", { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(log.getByText("取消失败：", { exact: false })).toBeVisible();
  await page.unroute("**/api/runs/*/cancel");
  await log.getByRole("button", { name: "取消运行", exact: true }).click();
  await expect(log.getByText("已取消", { exact: true })).toBeVisible();
  await page.goto("/");
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "删除任务", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "删除任务", exact: true });
  await confirm.getByRole("button", { name: "删除任务", exact: true }).click();
  await expect(confirm).not.toBeVisible();
});
