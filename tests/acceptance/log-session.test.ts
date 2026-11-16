import { expect, test } from "@playwright/test";
import { loadBrowserSetups } from "../../scripts/frontend/browser-setup.mjs";

const setups = await loadBrowserSetups();
const expires = process.env.DEPLOYD_LOG_MODE === "expiry";

test(
  expires ? "真实短Access到期后自动续传不中断任务" : "真实产物60秒断流后按字节自动续传",
  async ({ page, baseURL }) => {
    test.setTimeout(expires ? 75000 : 100000);
    for (const setup of setups) await setup.setup?.({ page, baseURL });
    await page.goto("/");
    const name = `artifact-${Date.now()}`;
    await page.getByRole("button", { name: "新增", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "新增任务", exact: true });
    await editor.getByLabel("名称", { exact: true }).fill(name);
    await editor.getByLabel("步骤名称", { exact: true }).fill("长连接");
    await editor
      .getByLabel("Shell 脚本", { exact: true })
      .fill(`printf '流首段中文\\n'\nsleep ${expires ? 34 : 64}\nprintf '续传尾段中文\\n'`);
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).not.toBeVisible();
    const connections: { at: number; offset: number }[] = [];
    const credentials = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!/^\/api\/runs\/[^/]+\/events$/.test(url.pathname)) return;
      connections.push({ at: Date.now(), offset: Number(url.searchParams.get("offset")) });
      const authorization = request.headers().authorization;
      if (authorization) credentials.add(authorization);
    });
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "运行任务", exact: true })
      .click();
    const log = page.getByRole("dialog", { name: "查看日志", exact: true });
    const viewport = log.getByRole("region", { name: "查看日志", exact: true });
    await expect(viewport).toContainText("流首段中文");
    await expect(viewport).toContainText("续传尾段中文", { timeout: expires ? 45000 : 75000 });
    await expect(log.getByText("成功", { exact: true })).toBeVisible();
    const text = await viewport.textContent();
    expect(text?.match(/流首段中文/g)).toHaveLength(1);
    expect(text?.match(/续传尾段中文/g)).toHaveLength(1);
    expect(connections.length).toBeGreaterThanOrEqual(2);
    const first = connections[0];
    const next = connections[1];
    if (!first || !next) throw new Error("缺少真实续连请求");
    expect(next.offset).toBeGreaterThan(0);
    expect(next.at - first.at).toBeGreaterThanOrEqual(expires ? 29000 : 59000);
    if (expires) expect(credentials.size).toBeGreaterThanOrEqual(2);
    await page.goto("/");
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "删除任务", exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: "删除任务", exact: true });
    await confirm.getByRole("button", { name: "删除任务", exact: true }).click();
    await expect(confirm).not.toBeVisible();
  },
);
