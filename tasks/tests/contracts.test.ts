import { describe, expect, it } from "vitest";
import {
  commandsFor,
  scriptFor,
  variablesSchema,
  variablesToObject,
} from "../frontend/editor-model";
import { LogBuffer, readEvents } from "../frontend/log-stream";
import { webhookCommand, runDestination } from "../frontend/navigation";
it("Webhook凭据只放请求头，触发导航携带run", () => {
  const command = webhookCommand("https://example.com", "demo", "secret");
  expect(command).toBe(
    "curl -X POST 'https://example.com/api/hooks/demo' -H 'X-Hook-Token: secret'",
  );
  expect(command).not.toContain("?token=");
  expect(runDestination("demo", "run-1").search).toMatchObject({
    name: "demo",
    run: "run-1",
    page: 1,
  });
});

describe("编辑无损契约", () => {
  it("未改脚本保留独立 shell，修改后单脚本 set-e", () => {
    const original = ["cd /tmp", "echo done"];
    const script = scriptFor(original);
    expect(commandsFor(script, script, original)).toEqual(original);
    expect(commandsFor("false\necho no", script, original)).toEqual(["set -e\nfalse\necho no"]);
  });
  it("变量保留空值与等号，拒绝空名和重复名", () => {
    expect(
      variablesToObject([
        { key: "A", value: "" },
        { key: "B", value: "a=b" },
      ]),
    ).toEqual({ A: "", B: "a=b" });
    expect(variablesSchema.safeParse([{ key: "", value: "x" }]).success).toBe(false);
    expect(
      variablesSchema.safeParse([
        { key: "A", value: "" },
        { key: "A", value: "b" },
      ]).success,
    ).toBe(false);
  });
});
describe("日志字节契约", () => {
  it("中文展示按UTF8字节上限裁剪且保留原始offset", () => {
    const buffer = new LogBuffer();
    const chunk = "中".repeat(200000);
    const encoded = new TextEncoder().encode(chunk);
    const base64 = btoa(Array.from(encoded, (byte) => String.fromCharCode(byte)).join(""));
    for (let i = 1; i <= 3; i++) buffer.append(base64, encoded.length * i);
    expect(buffer.offset).toBe(1800000);
    expect(new TextEncoder().encode(buffer.text).length).toBeLessThanOrEqual(1024 * 1024);
    expect(buffer.text).not.toContain("�");
    expect(buffer.truncated).toBe(true);
  });
  it("跨事件 UTF8 与重传去重，offset 按字节", () => {
    const buffer = new LogBuffer();
    buffer.append(btoa(String.fromCharCode(0xe4, 0xbd)), 2);
    buffer.append(btoa(String.fromCharCode(0xe4, 0xbd)), 2);
    buffer.append(btoa(String.fromCharCode(0xa0)), 3);
    expect(buffer.text).toBe("你");
    expect(buffer.offset).toBe(3);
  });
  it("跨网络块 CRLF 和 UTF8，消费者错误取消 reader", async () => {
    const encoded = new TextEncoder().encode(
      'event: log\r\ndata: {"data":"你好","offset":6}\r\n\r\n',
    );
    let index = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < encoded.length) controller.enqueue(encoded.slice(index, ++index));
      },
      cancel() {
        cancelled = true;
      },
    });
    const values: unknown[] = [];
    await expect(
      readEvents(stream, (event) => {
        values.push(event.value);
        throw new Error("consumer");
      }),
    ).rejects.toThrow("consumer");
    expect(values).toEqual([{ data: "你好", offset: 6 }]);
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });
  it("拒绝日志缺口并限制展示内存", () => {
    const buffer = new LogBuffer(8);
    expect(() => buffer.append(btoa("a"), 4)).toThrow();
    buffer.append(btoa("1234567890"), 10);
    expect(buffer.text).toBe("34567890");
    expect(buffer.truncated).toBe(true);
  });
});
