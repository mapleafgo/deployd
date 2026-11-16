import { expect, test, type Locator, type Page } from "@playwright/test";
import { loadBrowserSetups } from "../../scripts/frontend/browser-setup.mjs";

const setups = await loadBrowserSetups();
const noMatches = "无匹配结果";

function gate() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

function tableFrame(page: Page) {
  return page.locator("[aria-busy]").filter({ has: page.getByRole("table") });
}

async function assertVisibleBodyCenter(frame: Locator) {
  const status = frame.getByRole("status").filter({ hasText: noMatches });
  await expect(status).toBeVisible();
  const measure = () =>
    status.evaluate((element) => {
      const boundary = element.closest("[aria-busy]");
      const header = boundary?.querySelector("thead");
      if (!boundary || !header) throw new Error("缺少表格边界或表头");
      const box = boundary.getBoundingClientRect();
      const heading = header.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return {
        horizontal: Math.abs((text.left + text.right) / 2 - (box.left + box.right) / 2),
        vertical: Math.abs((text.top + text.bottom) / 2 - (heading.bottom + box.bottom) / 2),
        contained:
          text.left >= box.left &&
          text.right <= box.right &&
          text.top >= heading.bottom &&
          text.bottom <= box.bottom,
      };
    });
  await expect
    .poll(async () => {
      const geometry = await measure();
      return {
        contained: geometry.contained,
        horizontalCentered: geometry.horizontal <= 4,
        verticalCentered: geometry.vertical <= 5,
      };
    })
    .toEqual({ contained: true, horizontalCentered: true, verticalCentered: true });
}

test("空结果在可见表体居中，窄屏横滚与全屏不漂移", async ({ page, baseURL }) => {
  for (const setup of setups) await setup.setup?.({ page, baseURL });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "任务", level: 1, exact: true })).toBeVisible();
  await page.getByLabel("关键词", { exact: true }).fill(`no-match-${Date.now()}`);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const frame = tableFrame(page);
  await assertVisibleBodyCenter(frame);
  await page.screenshot({ path: "test-results/datatable-empty-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await assertVisibleBodyCenter(frame);
  const viewport = frame.getByRole("region", { name: "业务记录", exact: true });
  const overflow = await viewport.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeGreaterThan(0);
  await viewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await assertVisibleBodyCenter(frame);
  await page.screenshot({
    path: "test-results/datatable-empty-mobile-scrolled.png",
    fullPage: true,
  });
  await viewport.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await assertVisibleBodyCenter(frame);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "表格面板全屏", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await assertVisibleBodyCenter(frame);
  // 原生全屏的系统Escape行为不能依赖CDP模拟；验证公开退出按钮及真实fullscreenchange。
  await page.getByRole("button", { name: "退出表格面板全屏", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(frame.getByText(noMatches, { exact: true })).toHaveCount(0);
});

for (const entry of [
  { name: "Tasks", path: "/", api: "tasks" },
  { name: "Runs", path: "/runs", api: "runs" },
]) {
  test(`${entry.name} 列表通信失败后重试，pending保留错误而真实200后显示空结果`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(45000);
    for (const setup of setups) await setup.setup?.({ page, baseURL });
    let reject = true;
    const reached = gate();
    const release = gate();
    await page.route(`**/api/${entry.api}?*`, async (route) => {
      if (reject) return route.abort("failed");
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      reached.release();
      await release.promise;
      await route.fulfill({ response });
    });
    try {
      await page.goto(`${entry.path}?q=no-match-retry-${Date.now()}`);
      const frame = tableFrame(page);
      await expect(frame.getByRole("alert")).toBeVisible({ timeout: 20000 });
      await expect(frame.getByText(noMatches, { exact: true })).toHaveCount(0);
      reject = false;
      await frame.getByRole("button", { name: "刷新", exact: true }).click();
      await reached.promise;
      if (entry.api === "runs") {
        // 保留真实2秒轮询；所有重试响应共享闸门，跨过一次轮询周期后仍须保留错误。
        await page.waitForTimeout(2200);
      }
      await expect(frame).toHaveAttribute("aria-busy", "true");
      await expect(frame.getByRole("alert")).toBeVisible();
      await expect(frame.getByText(noMatches, { exact: true })).toHaveCount(0);
      release.release();
      await expect(frame).toHaveAttribute("aria-busy", "false");
      await expect(frame.getByRole("alert")).toHaveCount(0);
      await assertVisibleBodyCenter(frame);
    } finally {
      release.release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
