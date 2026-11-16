// 应用身份与偏好命名空间由入口显式选择，不从生成 Provider 反向读取。
export const appName = "admin" as const;
export const preferenceScope = "github.com/mapleafgo/deployd/admin";
// 仅默认应用迁移旧单应用偏好，其他应用不要复用此配置。
export const legacyPreferenceKeys = {
  theme: "redberry.theme",
  language: "redberry.locale",
  colorScheme: "mantine-color-scheme-value",
};
