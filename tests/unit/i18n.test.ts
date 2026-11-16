import { expect, test } from "vitest";
import { i18n } from "../../frontend/i18n";

test("模块命名空间隔离，缺失消息及不支持语言回退中文", async () => {
  i18n.addResourceBundle("zh-CN", "module-a", { same: "甲", fallback: "中文回退" });
  i18n.addResourceBundle("en", "module-a", { same: "A" });
  i18n.addResourceBundle("en", "module-b", { same: "B" });
  try {
    await i18n.changeLanguage("en");
    expect(i18n.t("same", { ns: "module-a" })).toBe("A");
    expect(i18n.t("same", { ns: "module-b" })).toBe("B");
    expect(i18n.t("fallback", { ns: "module-a" })).toBe("中文回退");
    await i18n.changeLanguage("fr-FR");
    expect(i18n.resolvedLanguage).toBe("zh-CN");
    expect(i18n.t("same", { ns: "module-a" })).toBe("甲");
  } finally {
    await i18n.changeLanguage("zh-CN");
  }
});
