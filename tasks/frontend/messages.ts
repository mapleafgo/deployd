import zh from "./locales/zh-CN.json";
import en from "./locales/en.json";

/** 本模块的 i18n 命名空间；独立接入时保留此值，与页面及菜单翻译键保持一致。 */
export const moduleNamespace = "github.com/mapleafgo/deployd/tasks";
/**
 * 按语言提供模块翻译资源，CLI 生成装配会自动注册。
 * 未使用生成装配时，在渲染页面前遍历本资源，调用应用 i18n 实例的
 * addResourceBundle(language, moduleNamespace, resources) 注册每种语言。
 * 通过模块前端公共入口导入 translations 和 moduleNamespace，不复制资源内容。
 */
export const translations = { "zh-CN": zh, en };
