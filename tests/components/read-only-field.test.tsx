import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ReadOnlyField, UIProvider } from "../support/ui";

// 最小骨架带一个组件用例，保持统一测试层的结构与门槛。
it("只读字段同时展示标签与值", async () => {
  const screen = await render(
    <UIProvider>
      <ReadOnlyField label="模块" value="示例值" />
    </UIProvider>,
  );
  await expect.element(screen.getByText("示例值")).toBeVisible();
  await expect.element(screen.getByText("模块")).toBeVisible();
});
