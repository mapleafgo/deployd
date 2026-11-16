import { expect, it, vi } from "vitest";
import { createAuthSession, type AuthAPI } from "@red-berry-kit/auth";
import { streamResponse, renewLogAccess } from "./stream-auth";
it("真实公开会话仅限定重试stale，只读SSE续传使用轮换凭据，撤销清身份", async () => {
  const pair = (token: string) => ({
    access_token: token,
    token_type: "Bearer",
    expires_at: new Date(Date.now() + 60000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  const refresh = vi.fn<AuthAPI["refresh"]>().mockResolvedValue(pair("rotated"));
  const api: AuthAPI = {
    challenge: async () => {
      throw new Error("unused");
    },
    login: async () => pair("initial"),
    csrf: async () => ({ csrf: "csrf" }),
    refresh,
    logout: async () => undefined,
    account: async () => ({
      id: "admin",
      source: "config",
      session_id: "same",
      name: "admin",
      claims: {},
    }),
  };
  const session = createAuthSession(api, `sse-test-${crypto.randomUUID()}`);
  try {
    await session.login({
      username: "admin",
      challenge: "",
      binding: "",
      answer: "",
      password_envelope: { enc: "", ciphertext: "" },
    });
    const headers: string[] = [];
    const result = await session.request(async (options) => {
      headers.push(new Headers(options.headers).get("Authorization") ?? "");
      return streamResponse(
        headers.length === 1
          ? new Response(JSON.stringify({ code: "token_claims_stale" }), { status: 401 })
          : new Response("ok"),
      );
    });
    expect(await result.text()).toBe("ok");
    expect(headers).toEqual(["Bearer initial", "Bearer rotated"]);
    expect(refresh).toHaveBeenCalledOnce();
    await renewLogAccess(session);
    expect(session.snapshot().account?.id).toBe("admin");
    await expect(
      session.request(() => streamResponse(new Response("{}", { status: 401 }))),
    ).rejects.toMatchObject({ status: 401 });
    expect(session.snapshot().account).toBeNull();
  } finally {
    session.close();
  }
});
