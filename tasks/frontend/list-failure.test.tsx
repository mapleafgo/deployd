import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useListFailure } from "./list-failure";

function Example({
  error,
  loading,
  requestKey,
}: {
  error: Error | null;
  loading: boolean;
  requestKey: string;
}) {
  const failure = useListFailure(error, loading, requestKey);
  return <output aria-label="查询反馈">{failure?.message ?? "无错误"}</output>;
}

it("同一查询重新请求时不把清空error当成恢复，成功完成后才清除", async () => {
  const error = new Error("网络故障");
  const screen = await render(<Example error={error} loading={false} requestKey="tasks:a" />);
  await expect.element(screen.getByLabelText("查询反馈")).toHaveTextContent("网络故障");
  await screen.rerender(<Example error={null} loading requestKey="tasks:a" />);
  await expect.element(screen.getByLabelText("查询反馈")).toHaveTextContent("网络故障");
  await screen.rerender(<Example error={null} loading={false} requestKey="tasks:a" />);
  await expect.element(screen.getByLabelText("查询反馈")).toHaveTextContent("无错误");
});

it("切换查询条件后不展示旧查询的错误", async () => {
  const screen = await render(
    <Example error={new Error("旧查询故障")} loading={false} requestKey="tasks:a" />,
  );
  await screen.rerender(<Example error={null} loading requestKey="tasks:b" />);
  await expect.element(screen.getByLabelText("查询反馈")).toHaveTextContent("无错误");
});

it("重试返回新错误时替换旧失败，下一次复查保留新错误", async () => {
  const screen = await render(
    <Example error={new Error("首次故障")} loading={false} requestKey="runs:a" />,
  );
  await screen.rerender(
    <Example error={new Error("新的故障")} loading={false} requestKey="runs:a" />,
  );
  await screen.rerender(<Example error={null} loading requestKey="runs:a" />);
  await expect.element(screen.getByLabelText("查询反馈")).toHaveTextContent("新的故障");
});
