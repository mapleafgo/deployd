import { expect, test } from "@playwright/test";

// 页面与静态文档均以应用品牌为准，不依赖脚本改写框架默认标题。
test("首页可访问", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
});

test("禁用脚本时静态文档仍使用应用品牌", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("测试配置必须提供 baseURL");
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    const response = await page.goto(baseURL);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("deployd · 任务管理");
  } finally {
    await context.close();
  }
});
