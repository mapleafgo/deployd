import { expect, test } from "@playwright/test";
import { loadBrowserSetups } from "../../scripts/frontend/browser-setup.mjs";

const setups = await loadBrowserSetups();

test("720高桌面任务面板分栏独立滚动且保存始终可见", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
  const name = editor.getByLabel("名称", { exact: true });
  await name.fill("desktop-draft");
  const before = await name.boundingBox();
  const steps = editor
    .getByRole("region", { name: "执行步骤", exact: true })
    .and(editor.locator('[tabindex="0"]'));
  const stepsBox = await steps.boundingBox();
  if (!before || !stepsBox) throw new Error("编辑字段尚未布局");
  expect(stepsBox.x).toBeGreaterThan(before.x + before.width);
  for (let i = 0; i < 5; i++)
    await editor.getByRole("button", { name: "添加步骤", exact: true }).click();
  expect(await steps.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await steps.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  const after = await name.boundingBox();
  if (!after) throw new Error("任务名称字段消失");
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  console.log(
    "按钮几何",
    JSON.stringify({
      viewport: page.viewportSize(),
      save: await editor.getByRole("button", { name: "保存", exact: true }).boundingBox(),
      cancel: await editor.getByRole("button", { name: "取消", exact: true }).boundingBox(),
      dialog: await editor.boundingBox(),
    }),
  );
  await expect(editor.getByRole("button", { name: "保存", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(editor.getByRole("button", { name: "取消", exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(name).toHaveValue("desktop-draft");
  console.log("桌面布局、独立滚动、保存可见性和草稿断言已通过");
  await page.screenshot({
    path: "test-results/rebuild-desktop.png",
    fullPage: true,
    animations: "disabled",
    timeout: 10000,
  });
  console.log("桌面截图已保存");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).not.toBeVisible();
});
