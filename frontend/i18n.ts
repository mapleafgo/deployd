import { createInstance, type i18n as I18n } from "i18next";
import { useTranslation } from "react-i18next";
import zh from "./locales/zh-CN.json";
import en from "./locales/en.json";

export const i18n: I18n = createInstance();
void i18n.init({
  initAsync: false,
  lng: "zh-CN",
  fallbackLng: "zh-CN",
  supportedLngs: ["zh-CN", "en"],
  defaultNS: "app",
  keySeparator: false,
  interpolation: { escapeValue: false },
  resources: { "zh-CN": { app: zh }, en: { app: en } },
  react: { useSuspense: false },
});
export function useAppTranslation() {
  return useTranslation("app", { i18n, useSuspense: false });
}
