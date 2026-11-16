import { expect, test } from "@playwright/test";
import { loadBrowserSetups } from "../../scripts/frontend/browser-setup.mjs";

const setups = await loadBrowserSetups();

test("只填名称和Bash脚本即可创建，任务与步骤变量作用域清楚", async ({ page, baseURL }) => {
  test.setTimeout(60000);
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
  const name = `bash-create-${Date.now()}`;
  await expect(editor.getByRole("button", { name: /步骤 1/ })).toBeDisabled();
  await expect(editor.getByRole("button", { name: /任务环境变量/ })).toBeVisible();
  await expect(editor.getByRole("button", { name: /步骤环境变量/ })).toBeVisible();
  await expect(
    editor.getByRole("textbox", { name: "Bash 脚本", exact: true }).first(),
  ).toBeInViewport();
  await page.screenshot({
    path: "test-results/task-creation-initial-desktop.png",
    animations: "disabled",
  });
  await editor.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  await editor
    .getByRole("textbox", { name: "Bash 脚本", exact: true })
    .fill("values=(hello bash)\n[[ ${values[1]} == bash ]]\nprintf '%s\\n' \"${values[*]}\"");
  await editor.getByRole("button", { name: "创建任务", exact: true }).click();
  await expect(editor).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "运行任务", exact: true }).click();
  const log = page.getByRole("dialog", { name: "查看日志", exact: true });
  await expect(log.getByText("hello bash", { exact: false })).toBeVisible();
  await expect(log.getByText("成功", { exact: true })).toBeVisible();
  await page.goto("/");
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "删除任务", exact: true })
    .click();
  const deletion = page.getByRole("dialog", { name: "删除任务", exact: true });
  await deletion.getByRole("button", { name: "删除任务", exact: true }).click();
  await expect(deletion).not.toBeVisible();
});

test("新增草稿关闭先确认，继续编辑保留内容", async ({ page, baseURL }) => {
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
  await editor.getByRole("textbox", { name: "名称", exact: true }).fill("unsaved-draft");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "放弃未保存的修改？", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "名称", exact: true })).toHaveValue(
    "unsaved-draft",
  );
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(editor).not.toBeVisible();
});

test("任务变量继承、步骤覆盖与空值覆盖保存后真实执行", async ({ page, baseURL }) => {
  test.setTimeout(60000);
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
  const name = `env-scope-${Date.now()}`;
  await editor.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  await editor.getByRole("button", { name: /任务环境变量/ }).click();
  const taskVariables = editor.getByRole("region", { name: "任务环境变量", exact: true });
  await taskVariables.getByRole("button", { name: "添加", exact: true }).click();
  await taskVariables.getByRole("textbox", { name: "变量名", exact: true }).fill("DEPLOY_ENV");
  await taskVariables.getByRole("textbox", { name: "变量值", exact: true }).fill("staging");
  await editor
    .getByRole("textbox", { name: "Bash 脚本", exact: true })
    .fill('printf "first=<%s>\\n" "$DEPLOY_ENV"');
  await editor.getByRole("button", { name: /步骤环境变量/ }).click();
  const stepVariables = editor.getByRole("region", { name: "步骤环境变量", exact: true });
  await stepVariables.getByRole("button", { name: "添加", exact: true }).click();
  await stepVariables.getByRole("textbox", { name: "变量名", exact: true }).fill("DEPLOY_ENV");
  await expect(stepVariables.getByText("覆盖任务变量", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "添加步骤", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Bash 脚本", exact: true })
    .nth(1)
    .fill('printf "second=<%s>\\n" "$DEPLOY_ENV"');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/tasks",
  );
  await editor.getByRole("button", { name: "创建任务", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    env: { DEPLOY_ENV: "staging" },
    steps: [{ env: { DEPLOY_ENV: "" } }, { env: {} }],
  });
  await expect(editor).not.toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "运行任务", exact: true })
    .click();
  const log = page.getByRole("dialog", { name: "查看日志", exact: true });
  await expect(log.getByText("first=<>", { exact: false })).toBeVisible();
  await expect(log.getByText("second=<staging>", { exact: false })).toBeVisible();
  await expect(log.getByText("成功", { exact: true })).toBeVisible();
  await page.goto("/");
  await page
    .getByRole("row")
    .filter({ hasText: name })
    .getByRole("button", { name: "删除任务", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "删除任务", exact: true })
    .getByRole("button", { name: "删除任务", exact: true })
    .click();
});
