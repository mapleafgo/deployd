import { useTranslation } from "react-i18next";
import { moduleNamespace } from "./messages";
import { useTasksContext } from "./module";
export function useTasksTranslation() {
  return useTranslation(moduleNamespace, { i18n: useTasksContext().i18n, useSuspense: false });
}
export function failureCode(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error) {
    if (error.status === 401) return "loginRequired";
    if (error.status === 403) return "forbidden";
    if (error.status === 409) return "conflict";
    if (error.status === 422) return "invalidInput";
  }
  return "requestFailed";
}
