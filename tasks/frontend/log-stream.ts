import { createParser } from "eventsource-parser";

/** 字节位置属于服务端协议；展示截断不改变续传位置或 UTF-8 解码器。 */
export class LogBuffer {
  offset = 0;
  text = "";
  truncated = false;
  private decoder = new TextDecoder();
  constructor(private limit = 1024 * 1024) {}
  append(base64: string, end: number) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const start = end - bytes.length;
    if (!Number.isSafeInteger(end) || start < 0 || start > this.offset)
      throw new Error("streamFailed");
    if (end <= this.offset) return;
    const fresh = bytes.subarray(this.offset - start);
    this.text += this.decoder.decode(fresh, { stream: true });
    this.offset = end;
    this.trim();
  }
  private trim() {
    const encoded = new TextEncoder().encode(this.text);
    if (encoded.length <= this.limit) return;
    let start = encoded.length - this.limit;
    while (start < encoded.length && ((encoded[start] ?? 0) & 0xc0) === 0x80) start++;
    this.text = new TextDecoder().decode(encoded.subarray(start));
    this.truncated = true;
  }
  finish() {
    this.text += this.decoder.decode();
    this.trim();
  }
}
export type StreamEvent = { type: string; value: Record<string, unknown> };
/** ReadableStream 没有适用的 Mantine hook；reader 在成功、错误及取消时均释放。 */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  receive: (event: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createParser({
    // 服务端每块最多16KiB原始日志；64KiB字符可容纳Base64及事件字段，限制未完成帧。
    maxBufferSize: 64 * 1024,
    onEvent: (event) => receive({ type: event.event ?? "message", value: JSON.parse(event.data) }),
    onError: (error) => {
      if (error.type === "max-buffer-size-exceeded") throw new Error("streamFailed");
      // SSE规范忽略未知字段及无效retry；业务JSON异常由onEvent保留失败语义。
    },
  });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      parser.feed(decoder.decode(value, { stream: !done }));
      if (done) {
        // EOF不能把未以空行结束的事件当成完整业务消息。
        parser.reset();
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export const terminal = (status: string) => !["queued", "running"].includes(status);
