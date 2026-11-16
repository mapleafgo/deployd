import type { ReactNode } from "react";
import { beforeEach } from "vitest";
import { UIProvider as BaseUIProvider } from "@red-berry-kit/ui";
import { registerModuleTranslations } from "../../.redberry/frontend/admin/resources";
import { i18n } from "../../frontend/i18n";
import { useBrand } from "../../frontend/brand";

export * from "@red-berry-kit/ui";
registerModuleTranslations(i18n);
// 各用例显式选择语言；不要继承前一用例写入的应用偏好。
beforeEach(() => {
  for (const key of ["locale", "theme", "color-scheme"])
    localStorage.removeItem(`component-test/admin.${key}`);
});

// 真实公共 Provider；测试只补齐显式环境，不替换任何控件或业务行为。
export function UIProvider({ children }: { children: ReactNode }) {
  const brand = useBrand();
  return (
    <BaseUIProvider i18n={i18n} scope="component-test/admin" brand={brand}>
      {children}
    </BaseUIProvider>
  );
}
