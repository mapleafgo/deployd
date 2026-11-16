function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
export function webhookCommand(origin: string, name: string, token: string) {
  return `curl -X POST ${shellQuote(`${origin}/api/hooks/${encodeURIComponent(name)}`)} -H ${shellQuote(`X-Hook-Token: ${token}`)}`;
}
export function runDestination(name: string, run: string) {
  return { to: "/runs" as const, search: { page: 1, size: 20, q: "", name, run } };
}
