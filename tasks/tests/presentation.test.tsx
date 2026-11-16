import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { createInstance } from "i18next";
import { EditorPanel, UIProvider, translations } from "@red-berry-kit/ui";
import { useExitPresentation } from "../frontend/presentation";

it("真实EditorPanel退出完成清理快照；快速重开后旧onClosed不得清新对象（含reduced motion）", async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { "red-berry-kit/ui": translations["zh-CN"] } },
  });
  let choose!: (value: string | undefined) => void;
  let closed!: () => void;
  let retained: string | undefined;
  function Example() {
    const [selected, setSelected] = useState<string | undefined>("first");
    const presentation = useExitPresentation(selected);
    useLayoutEffect(() => {
      choose = setSelected;
      closed = presentation.onClosed;
      retained = presentation.value;
    }, [presentation.onClosed, presentation.value]);
    return (
      <EditorPanel
        opened={selected !== undefined}
        title={presentation.value ?? "empty"}
        onClose={() => setSelected(undefined)}
        onClosed={presentation.onClosed}
      >
        {presentation.value && <input aria-label="presented" value={presentation.value} readOnly />}
      </EditorPanel>
    );
  }
  const screen = await render(
    <UIProvider i18n={i18n} scope={crypto.randomUUID()} brand={{ name: "test", homeHref: "/" }}>
      <Example />
    </UIProvider>,
  );
  await expect.element(page.getByRole("dialog", { name: "first", exact: true })).toBeVisible();
  flushSync(() => {
    choose(undefined);
  });
  const oldClosed = closed;
  flushSync(() => {
    choose("second");
  });
  flushSync(() => {
    oldClosed();
  });
  await expect.element(page.getByRole("dialog", { name: "second", exact: true })).toBeVisible();
  await expect.element(page.getByRole("textbox", { name: "presented" })).toHaveValue("second");
  await page.getByRole("button", { name: "关闭编辑面板", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.poll(() => retained).toBeUndefined();
  await screen.unmount();
});
