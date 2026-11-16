import { expect, it, vi } from "vitest";
import { readEvents, type StreamEvent } from "../frontend/log-stream";

function streamOf(text: string, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, (offset += chunkSize)));
    },
    cancel,
  });
  return { body, cancel };
}

for (const [name, newline] of [
  ["LF", "\n"],
  ["CRLF", "\r\n"],
  ["CR", "\r"],
]) {
  it(`SSE ${name}逐字节跨块、UTF8、多行data、注释和event映射`, async () => {
    const { body } = streamOf(
      [
        ": heartbeat",
        "id: 6",
        "event: log",
        'data: {"data":',
        'data: "你好","offset":6}',
        "",
        "",
      ].join(newline),
    );
    const events: StreamEvent[] = [];
    await readEvents(body, (event) => events.push(event));
    expect(events).toEqual([{ type: "log", value: { data: "你好", offset: 6 } }]);
    expect(body.locked).toBe(false);
  });
}

it("EOF不派发未完成事件，下一连接不会继承上一帧", async () => {
  const incomplete = streamOf('data: {"secret":"unfinished"}');
  const events: StreamEvent[] = [];
  await readEvents(incomplete.body, (event) => events.push(event));
  expect(events).toEqual([]);
  expect(incomplete.body.locked).toBe(false);
  const complete = streamOf('data: {"status":"success"}\n\n', 20);
  await readEvents(complete.body, (event) => events.push(event));
  expect(events).toEqual([{ type: "message", value: { status: "success" } }]);
});

it("JSON与消费者错误均取消reader并释放锁，原异常不被吞掉", async () => {
  for (const invalidJSON of [false, true]) {
    const { body, cancel } = streamOf(
      invalidJSON ? "data: not-json\n\n" : 'data: {"offset":1}\n\n',
      4,
    );
    await expect(
      readEvents(body, () => {
        throw new Error("consumer");
      }),
    ).rejects.toThrow(invalidJSON ? /JSON|Unexpected/ : "consumer");
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  }
});

it("未完成SSE帧缓冲有界，合法16KiB原始日志帧仍可消费", async () => {
  const oversized = streamOf(`data: ${"x".repeat(70 * 1024)}`, 1024);
  await expect(readEvents(oversized.body, () => undefined)).rejects.toThrow("streamFailed");
  expect(oversized.cancel).toHaveBeenCalledOnce();
  expect(oversized.body.locked).toBe(false);
  const data = btoa("x".repeat(16 * 1024));
  const normal = streamOf(
    `event: log\ndata: ${JSON.stringify({ data, offset: 16 * 1024 })}\n\n`,
    4096,
  );
  const receive = vi.fn();
  await readEvents(normal.body, receive);
  expect(receive).toHaveBeenCalledWith({ type: "log", value: { data, offset: 16 * 1024 } });
});
