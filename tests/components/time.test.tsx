import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { UIProvider, DateTimePicker, formatTime } from "../support/ui";

it("公共时间格式化保留偏移语义并拒绝无偏移与非法值", () => {
  expect(formatTime("2026-10-21T00:30:00.123Z", "en")).toBe(
    formatTime("2026-10-21T08:30:00.123+08:00", "en"),
  );
  expect(formatTime("not-a-time", "en")).toBe("—");
  expect(formatTime("2026-10-21T00:30:00", "en")).toBe("—");
});

it("公共时间控件消费带时区的原始值，初始展示不提交转换结果", async () => {
  const change = vi.fn();
  const screen = await render(
    <UIProvider>
      <DateTimePicker
        label="事件时间"
        value="2026-10-21T00:30:00.123Z"
        onChange={change}
        onBlur={() => {}}
        disabled={false}
        error={undefined}
      />
    </UIProvider>,
  );
  await expect.element(screen.getByLabelText("事件时间", { exact: true })).toBeVisible();
  expect(change).not.toHaveBeenCalled();
});
