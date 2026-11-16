import { expect, test } from "@playwright/test";
import { loadBrowserSetups } from "../../scripts/frontend/browser-setup.mjs";

const setups = await loadBrowserSetups();

test("真实API接受的Go时长原值可保留并编辑其他字段", async ({ page, baseURL }) => {
  test.setTimeout(60000);
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  for (const [index, timeout] of [".5h", "+30m", "1000000us"].entries()) {
    const name = `duration-${Date.now()}-${index}`;
    // 只改变发送给真实后端的创建输入，不伪造响应或编辑请求。
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body: unknown = route.request().postDataJSON();
      if (!body || typeof body !== "object") throw new Error("任务创建输入必须为对象");
      await route.continue({ postData: JSON.stringify({ ...body, timeout }) });
    });
    await page.getByRole("button", { name: "新增", exact: true }).click();
    const create = page.getByRole("dialog", { name: "新增任务", exact: true });
    await create.getByRole("textbox", { name: "名称", exact: true }).fill(name);
    await create.getByRole("button", { name: /步骤设置/ }).click();
    await create.getByRole("textbox", { name: "步骤名称", exact: true }).fill("保留时长");
    await create.getByRole("textbox", { name: "Bash 脚本", exact: true }).fill("printf untouched");
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/tasks",
    );
    await create.getByRole("button", { name: /^(保存|创建任务)$/, exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("timeout" in body))
      throw new Error("任务响应缺少超时字段");
    expect(body.timeout).toBe(timeout);
    await expect(create).not.toBeVisible();
    await page.unroute("**/api/tasks");

    const row = page.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: "编辑任务", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑任务", exact: true });
    await editor.getByRole("button", { name: /执行设置/ }).click();
    await expect(editor.getByRole("textbox", { name: "超时", exact: true })).toHaveValue(timeout);
    await editor.getByRole("button", { name: "说明", exact: true }).click();
    await editor
      .getByRole("textbox", { name: "说明", exact: true })
      .fill("只改说明，保留API合法原值");
    const updated = page.waitForResponse(
      (result) =>
        result.request().method() === "PUT" &&
        new URL(result.url()).pathname === `/api/tasks/${name}`,
    );
    await editor.getByRole("button", { name: /^(保存|创建任务)$/, exact: true }).click();
    const saved = await updated;
    expect(saved.ok()).toBe(true);
    const value: unknown = await saved.json();
    if (!value || typeof value !== "object" || !("timeout" in value) || !("description" in value))
      throw new Error("更新响应字段缺失");
    expect(value.timeout).toBe(timeout);
    expect(value.description).toBe("只改说明，保留API合法原值");
    await expect(editor).not.toBeVisible();
    await row.getByRole("button", { name: "删除任务", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "删除任务", exact: true });
    await confirm.getByRole("button", { name: "删除任务", exact: true }).click();
    await expect(confirm).not.toBeVisible();
    await expect(row).toHaveCount(0);
  }
});
