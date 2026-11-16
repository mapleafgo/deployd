/** 保留公开 AuthSession.request 的 status/info.code 协议，不自行重放写入。 */
export async function streamResponse(response: Response) {
  if (response.ok) return response;
  const info: unknown = await response.json().catch(() => undefined);
  throw Object.assign(new Error("streamFailed"), {
    status: response.status,
    info,
    requestId: response.headers.get("X-Request-ID") ?? undefined,
  });
}
/** 只读连接的旧 Access 复查拒绝需重新取得即时凭据；真实 401 仍交 request 的身份边界。 */
export async function renewLogAccess(session: { authorization: () => Promise<string> }) {
  await session.authorization();
}
