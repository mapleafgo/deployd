import { expect, it, vi } from "vitest";
import { streamResponse, renewLogAccess } from "../frontend/stream-auth";
it("fetch拒绝保留stale错误体与requestId供公开session限定重试", async () => {
  const response = new Response(JSON.stringify({ code: "token_claims_stale" }), {
    status: 401,
    headers: { "X-Request-ID": "req-sse" },
  });
  await expect(streamResponse(response)).rejects.toMatchObject({
    status: 401,
    info: { code: "token_claims_stale" },
    requestId: "req-sse",
  });
});
it("SSE旧access拒绝只续传读取且使用会话即时凭据，不主动注销", async () => {
  const authorization = vi.fn().mockResolvedValue("Bearer rotated");
  await expect(renewLogAccess({ authorization })).resolves.toBeUndefined();
  expect(authorization).toHaveBeenCalledOnce();
});
