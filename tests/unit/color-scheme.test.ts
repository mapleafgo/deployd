import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { appName, preferenceScope, legacyPreferenceKeys } from "../../frontend/application";

const html = readFileSync("frontend/index.html", "utf8");
const script = (() => {
  const value = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!value) throw new Error("缺少首次绘制主题脚本");
  return value;
})();

function firstPaint(
  values: Record<string, string>,
  options: { app?: string; dark?: boolean; denied?: boolean } = {},
) {
  const document = { documentElement: { dataset: { mantineColorScheme: "" } } };
  const reads: string[] = [];
  const context = {
    appName: "",
    preferenceScope: "",
    document,
    localStorage: {
      getItem(key: string) {
        if (options.denied) throw new Error("存储禁用");
        reads.push(key);
        return values[key] ?? null;
      },
    },
    matchMedia: () => ({ matches: options.dark ?? false }),
  };
  // 其他应用并非由默认模板自动生成；这里明确替换应用选择来验证同一脚本的回退策略。
  const source = options.app
    ? script.replace('var appName = "admin";', `var appName = ${JSON.stringify(options.app)};`)
    : script;
  runInNewContext(source, context);
  return { ...context, reads, scheme: document.documentElement.dataset.mantineColorScheme };
}

const key = `${preferenceScope}.color-scheme`;
const legacy = legacyPreferenceKeys.colorScheme;

test("首次绘制使用与应用入口一致的应用身份和偏好scope", () => {
  const result = firstPaint({});
  expect(result.appName).toBe(appName);
  expect(result.preferenceScope).toBe(preferenceScope);
});

test("新作用域主题优先旧全局键且不读取旧值", () => {
  const result = firstPaint({ [key]: "dark", [legacy]: "light" });
  expect(result.scheme).toBe("dark");
  expect(result.reads).toEqual([key]);
});

test("仅缺少新键的默认admin回退旧主题", () => {
  expect(firstPaint({ [legacy]: "dark" }).scheme).toBe("dark");
  const other = firstPaint({ [legacy]: "dark" }, { app: "store" });
  expect(other.appName).toBe("store");
  expect(other.scheme).toBe("light");
  expect(other.reads).not.toContain(legacy);
});

test("新键非法时回退light而不认领旧dark", () => {
  const result = firstPaint({ [key]: "invalid", [legacy]: "dark" });
  expect(result.scheme).toBe("light");
  expect(result.reads).toEqual([key]);
});

test.each([false, true])("auto在首次绘制遵循系统深色偏好%s", (dark) => {
  expect(firstPaint({ [key]: "auto" }, { dark }).scheme).toBe(dark ? "dark" : "light");
});

test("存储禁用仍安全回退light", () => {
  expect(firstPaint({}, { denied: true, dark: true }).scheme).toBe("light");
});
