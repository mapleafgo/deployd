import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function checkBoundaries(root: string, config?: string): string[] {
  const script = pathToFileURL(path.resolve("scripts/frontend/boundaries.mjs")).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {checkBoundaries} from ${JSON.stringify(script)};try{console.log(JSON.stringify(checkBoundaries(undefined, ${JSON.stringify(config)})));}catch(error){console.error(error.message);process.exitCode=2;}`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});
function write(root: string, file: string, value: string) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}
function fixture(source: string, importer = "frontend/consumer.ts") {
  const root = mkdtempSync(path.join(os.tmpdir(), "redberry-boundaries-"));
  temporary.push(root);
  mkdirSync(path.join(root, "frontend/ui"), { recursive: true });
  const dirs = ["modules/team/lib", ".redberry/modules/github.com/vendor/deep/lib"];
  const modules = [
    { id: "example.com/acme/app", dir: ".", deps: {} },
    ...dirs.map((dir, index) => ({ id: `example.com/acme/module${index}`, dir, deps: {} })),
  ];
  write(root, ".redberry/module-graph.json", JSON.stringify({ modules, targets: {} }));
  write(
    root,
    "frontend/tsconfig.app.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        paths: {
          "@local/*": ["../modules/team/lib/frontend/*"],
          "@remote/*": ["../.redberry/modules/github.com/vendor/deep/lib/frontend/*"],
        },
      },
      include: [
        "./**/*.ts",
        "./**/*.tsx",
        "../modules/**/*.ts",
        "../modules/**/*.tsx",
        "../.redberry/**/*.ts",
      ],
    }),
  );
  for (const dir of dirs) {
    write(root, `${dir}/frontend/index.ts`, 'export { value } from "./private";\n');
    write(root, `${dir}/frontend/private.ts`, "export const value = 1;\n");
  }
  write(root, importer, source);
  return { root, dirs };
}

function foundation(
  root: string,
  dirs: string[],
  role: "ui" | "web",
  id = `red-berry-kit/${role}`,
) {
  write(
    root,
    ".redberry/module-graph.json",
    JSON.stringify({
      modules: [
        { id: "example.com/acme/app", dir: "." },
        ...dirs.map((dir, index) => ({ id: index === 0 ? id : "example.com/acme/module1", dir })),
      ],
      targets: { [`red-berry-kit/${role}`]: id },
    }),
  );
}

describe("模块图与真实文件边界", () => {
  it.each(["red-berry-kit/ui", "example.com/vendor/visual"])(
    "正式或替代 UI %s 拥有组件样式",
    (id) => {
      const { root, dirs } = fixture(
        'import { Button } from "@mantine/core"; import "./controls.module.css"; export const View = () => <Button className="control" />;',
        "modules/team/lib/frontend/view.tsx",
      );
      foundation(root, dirs, "ui", id);
      write(root, "modules/team/lib/frontend/controls.module.css", ".control { display: flex; }");
      expect(checkBoundaries(root)).toEqual([]);
    },
  );

  it("应用私有 UI 目录不再拥有组件样式权限", () => {
    const { root } = fixture(
      'import { Button } from "@mantine/core"; export const View = () => <Button className="control" />;',
      "frontend/ui/view.tsx",
    );
    expect(checkBoundaries(root).some((error) => error.includes("统一 UI 入口"))).toBe(true);
  });

  it("web 允许原生布局、账户链接和自有 CSS Modules", () => {
    const { root, dirs } = fixture(
      'import { NavLink, Menu } from "@mantine/core"; import styles from "./shell.module.css"; import { Link } from "@tanstack/react-router"; export const View = () => <div className={styles.shell}><NavLink component={Link} /><Menu.Item component={Link}>账户</Menu.Item></div>;',
      "modules/team/lib/frontend/view.tsx",
    );
    foundation(root, dirs, "web", "example.com/vendor/shell");
    write(root, "modules/team/lib/frontend/shell.module.css", ".shell { display: flex; }");
    expect(checkBoundaries(root)).toEqual([]);
  });

  it.each([
    'import { ColorInput } from "@mantine/core";',
    'import * as Mantine from "@mantine/core";',
    'import "./global.css";',
    'import { Text } from "@mantine/core"; const view = <Text className="custom"/>;',
    'const view = <div style={{color:"red"}}/>;',
  ])("web 不获得任意控件或样式权限 %s", (source) => {
    const { root, dirs } = fixture(source, "modules/team/lib/frontend/view.tsx");
    foundation(root, dirs, "web");
    expect(checkBoundaries(root).length).toBeGreaterThan(0);
  });

  it("自定义静态消费者使用相同布局限制，不绑定私有文件名", () => {
    const { root } = fixture(
      'import { Button } from "@mantine/core"; import { Link as AppLink } from "@tanstack/react-router"; export const View = () => <Button component={AppLink}/>;',
      "modules/team/lib/frontend/custom.tsx",
    );
    const config = ".redberry/frontend/custom/tsconfig.modules.json";
    write(root, config, JSON.stringify({ extends: "../../../frontend/tsconfig.app.json" }));
    write(
      root,
      ".redberry/frontend/custom/shell.metadata.json",
      JSON.stringify({ consumer: "example.com/acme/module0" }),
    );
    expect(checkBoundaries(root, config)).toEqual([]);
  });

  it("web 不能用布局例外指定任意组件", () => {
    const { root, dirs } = fixture(
      'import { Button } from "@mantine/core"; const Other = () => null; export const View = () => <Button component={Other}/>;',
      "modules/team/lib/frontend/view.tsx",
    );
    foundation(root, dirs, "web");
    expect(checkBoundaries(root).some((error) => error.includes("底层样式属性"))).toBe(true);
  });

  it("UI 的跨模块 CSS 引用仍遵守私有边界", () => {
    const { root, dirs } = fixture(
      'import "../../../../frontend/private.module.css";',
      "modules/team/lib/frontend/index.ts",
    );
    foundation(root, dirs, "ui");
    write(root, "frontend/private.module.css", ".private { display: flex; }");
    expect(checkBoundaries(root).some((error) => error.includes("跨模块只允许公开"))).toBe(true);
  });

  it("UI 不能反向导入应用私有国际化", () => {
    const { root, dirs } = fixture(
      'export { value } from "../../../../frontend/i18n";',
      "modules/team/lib/frontend/index.ts",
    );
    foundation(root, dirs, "ui");
    write(root, "frontend/i18n.ts", "export const value = 1;");
    expect(checkBoundaries(root).some((error) => error.includes("跨模块只允许公开"))).toBe(true);
  });
  it("允许公开入口、模块内部引用和固定字面动态公开导入", () => {
    const { root } = fixture(
      'import { value } from "@local/index";\nexport { value as remote } from "@remote/index";\nvoid import("@local/index");\nvoid import(`@remote/index`);\n',
    );
    expect(checkBoundaries(root)).toEqual([]);
  });

  it.each([
    ["直接私有导入", 'import { value } from "@local/private";'],
    ["私有再导出", 'export { value } from "@local/private";'],
    ["外部多层私有再导出", 'export * from "@remote/private";'],
    ["动态私有导入", 'void import("@local/private");'],
    ["类型私有导入", 'type Secret = import("@remote/private").value;'],
  ])("拒绝%s", (_name, source) => {
    const { root } = fixture(source);
    expect(checkBoundaries(root).some((error: string) => error.includes("跨模块只允许公开"))).toBe(
      true,
    );
  });

  it.each([
    'const name = "@local/index"; void import(name);',
    'const suffix = "index"; void import(`@local/${suffix}`);',
  ])("拒绝非固定字面动态路径 %s", (source) => {
    const { root } = fixture(source);
    expect(checkBoundaries(root).some((error: string) => error.includes("固定字符串字面量"))).toBe(
      true,
    );
  });

  it("业务不能经自己的 index 转出其他模块私有内容", () => {
    const { root } = fixture(
      'export { value } from "@remote/private";',
      "modules/team/lib/frontend/index.ts",
    );
    expect(checkBoundaries(root).some((error: string) => error.includes("跨模块只允许公开"))).toBe(
      true,
    );
  });

  it("软链接与路径别名按目标真实归属检查", () => {
    const { root } = fixture('export { value } from "./shortcut";');
    symlinkSync(
      path.join(root, "modules/team/lib/frontend/private.ts"),
      path.join(root, "frontend/shortcut.ts"),
    );
    expect(checkBoundaries(root).some((error: string) => error.includes("跨模块只允许公开"))).toBe(
      true,
    );
  });

  it("声明文件与隐藏生成包同样检查跨模块引用", () => {
    const { root } = fixture(
      'export { value } from "@remote/private";',
      ".redberry/frontend/leak.d.ts",
    );
    expect(checkBoundaries(root).some((error: string) => error.includes("跨模块只允许公开"))).toBe(
      true,
    );
  });

  it("跨模块目录软链接仍按实际目标检查", () => {
    const { root } = fixture('export { value } from "./linked/private";');
    symlinkSync(
      path.join(root, ".redberry/modules/github.com/vendor/deep/lib/frontend"),
      path.join(root, "frontend/linked"),
      "dir",
    );
    expect(checkBoundaries(root).some((error: string) => error.includes("跨模块只允许公开"))).toBe(
      true,
    );
  });

  it("UI路径别名不能暴露底层样式文件", () => {
    const { root, dirs } = fixture('export { theme } from "@local/theme";');
    foundation(root, dirs, "ui");
    write(root, "modules/team/lib/frontend/theme.ts", 'export const theme = { color: "red" };');
    expect(checkBoundaries(root).some((error: string) => error.includes("跨模块只允许公开"))).toBe(
      true,
    );
  });

  it("允许行为hooks但继续禁止直接引入UI组件", () => {
    const { root } = fixture(
      'import { useMediaQuery } from "@mantine/hooks"; export { useMediaQuery };',
    );
    expect(checkBoundaries(root).some((error) => error.includes("统一 UI 入口"))).toBe(false);
    write(root, "frontend/consumer.ts", 'export { Button } from "@mantine/core";');
    expect(checkBoundaries(root).some((error) => error.includes("统一 UI 入口"))).toBe(true);
  });

  it("隐藏生成文件不能充当 UI 组件的绕行入口", () => {
    const { root } = fixture(
      'export { Button } from "@mantine/core";',
      ".redberry/frontend/leak.ts",
    );
    expect(checkBoundaries(root).some((error: string) => error.includes("统一 UI 入口"))).toBe(
      true,
    );
  });

  it("缺少生成模块图时明确失败", () => {
    const { root } = fixture("export {};\n");
    rmSync(path.join(root, ".redberry/module-graph.json"));
    expect(() => checkBoundaries(root)).toThrow(/模块图/);
  });

  it("UI限制同样覆盖再导出、动态导入和展开的样式对象", () => {
    const { root } = fixture(
      'export { Button } from "@mantine/core"; void import("./theme.css"); const attrs={ style: {color:"red"} }; const view=<div {...attrs}/>;',
      "frontend/consumer.tsx",
    );
    const errors = checkBoundaries(root);
    expect(errors.some((error: string) => error.includes("统一 UI 入口"))).toBe(true);
    expect(errors.some((error: string) => error.includes("展开包含样式属性 style"))).toBe(true);
  });
});
