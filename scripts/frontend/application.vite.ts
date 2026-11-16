// 校验开发路径归属，避免不同应用抢占同一入口或 API。
// 后台同样是声明中的一项，不在参数里重复传入。
export function validateApplicationPaths(applications: Record<string, { path: string }>): void {
  const owners = new Map<string, string>();
  for (const [name, app] of Object.entries(applications)) {
    const value = app.path;
    if (
      !value.startsWith("/") ||
      (value !== "/" && !value.endsWith("/")) ||
      ["?", "#", "%", "\\"].some((character) => value.includes(character)) ||
      value.includes("//") ||
      value.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error(`应用 ${name} 的路径无效：${value}`);
    const normalized = value.replace(/\/+$/, "") || "/";
    if (normalized === "/api" || normalized.startsWith("/api/"))
      throw new Error(`应用 ${name} 的路径占用 API：${value}`);
    const owner = owners.get(normalized);
    if (owner && owner !== name) throw new Error(`应用路径冲突：${value}`);
    owners.set(normalized, name);
  }
}
