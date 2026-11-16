import { createRoute, type AnyRootRoute } from "@tanstack/react-router";
import { TasksPage } from "./tasks";
import { RunsPage } from "./runs";
import { moduleNamespace } from "./messages";
import { searchSchema } from "./list-state";
import { taskMenuIcon, runsMenuIcon } from "./menu-icons";
/** 页面由 CLI 默认装配，列表条件归 Router URL 所有。 */
export function createRoutes(parent: AnyRootRoute) {
  return [
    createRoute({
      getParentRoute: () => parent,
      path: "/",
      validateSearch: (value) => searchSchema.parse(value),
      staticData: {
        menu: { title: "任务", titleKey: `${moduleNamespace}:title`, icon: taskMenuIcon },
      },
      component: TasksPage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/runs",
      validateSearch: (value) => searchSchema.parse(value),
      staticData: {
        menu: { title: "运行历史", titleKey: `${moduleNamespace}:history`, icon: runsMenuIcon },
      },
      component: RunsPage,
    }),
  ];
}
export { createProvider } from "./module";
export type { ModuleContext } from "./module";
export { TasksPage, ModulePage } from "./tasks";
export { RunsPage } from "./runs";
export { translations, moduleNamespace } from "./messages";
