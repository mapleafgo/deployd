import { expect, it } from "vitest";
import { Fragment } from "react";
import { render } from "vitest-browser-react";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { page, userEvent } from "vitest/browser";
import { createInstance } from "i18next";
import { UIProvider, translations as uiTranslations } from "@red-berry-kit/ui";
import {
  WorkspaceShell,
  translations as webTranslations,
  type NavigationItem,
} from "@red-berry-kit/web";
import { translations, moduleNamespace } from "../frontend/index";
import { createRoutes } from "../frontend/index";

it("路由贡献不同的语义图标，不依赖工作台默认占位", async () => {
  const routes = createRoutes(createRootRoute());
  const screen = await render(
    <>
      {routes.map((route, index) => (
        <Fragment key={index}>{route.options.staticData?.menu?.icon}</Fragment>
      ))}
    </>,
  );
  const icons = document.querySelectorAll("svg[data-operation-icon]");
  expect(Array.from(icons, (icon) => icon.getAttribute("data-operation-icon"))).toEqual([
    "terminal",
    "history",
  ]);
  for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
  await screen.unmount();
});

it("真实工作台消费路由菜单：双语、折叠、移动及键盘保留名称和不同图标", async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    fallbackLng: "en",
    resources: {
      "zh-CN": {
        [moduleNamespace]: translations["zh-CN"],
        "red-berry-kit/ui": uiTranslations["zh-CN"],
        "red-berry-kit/web": webTranslations["zh-CN"],
      },
      en: {
        [moduleNamespace]: translations.en,
        "red-berry-kit/ui": uiTranslations.en,
        "red-berry-kit/web": webTranslations.en,
      },
    },
  });
  let navigation: NavigationItem[] = [];
  const root = createRootRoute({
    component: () => (
      <WorkspaceShell brand={{ name: "test", homeHref: "/" }} navigation={navigation}>
        <p>菜单验证</p>
      </WorkspaceShell>
    ),
  });
  const routes = createRoutes(root);
  navigation = routes.map((route, index) => {
    const menu = route.options.staticData?.menu;
    if (!menu) throw new Error("任务路由缺少菜单声明");
    return { href: index ? "/runs" : "/", ...menu };
  });
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await page.viewport(1200, 800);
  const screen = await render(
    <UIProvider i18n={i18n} scope="tasks-menu-regression" brand={{ name: "test", homeHref: "/" }}>
      <RouterProvider router={router} />
    </UIProvider>,
  );
  try {
    await expect.element(page.getByRole("link", { name: "任务", exact: true })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "运行历史", exact: true })).toBeVisible();
    await i18n.changeLanguage("en");
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    const history = page.getByRole("link", { name: "Run history", exact: true });
    await expect.element(history).toBeVisible();
    const historyElement = history.element();
    historyElement.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => router.state.location.pathname).toBe("/runs");
    expect(
      document.querySelector('a[aria-label="Tasks"] svg')?.getAttribute("data-operation-icon"),
    ).toBe("terminal");
    expect(
      document
        .querySelector('a[aria-label="Run history"] svg')
        ?.getAttribute("data-operation-icon"),
    ).toBe("history");
    await page.viewport(390, 844);
    await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
    await expect.element(page.getByRole("link", { name: "Tasks", exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Run history", exact: true }))
      .toBeVisible();
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("移动导航抽屉未打开");
    expect(
      Array.from(dialog.querySelectorAll("nav svg[data-operation-icon]"), (icon) =>
        icon.getAttribute("data-operation-icon"),
      ),
    ).toEqual(["terminal", "history"]);
    await i18n.changeLanguage("zh-CN");
    await expect.element(page.getByRole("link", { name: "任务", exact: true })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "运行历史", exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await page.viewport(1200, 800);
  }
});
