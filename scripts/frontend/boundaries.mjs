import { version } from "typescript";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const forbiddenProps = new Set([
  "style",
  "className",
  "classNames",
  "styles",
  "vars",
  "unstyled",
  "sx",
  "css",
  "component",
  "renderRoot",
]);
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};
const owned = (filename) => {
  try {
    return realpathSync(filename);
  } catch {
    return path.resolve(filename);
  }
};

function moduleGraph(root) {
  let graph;
  try {
    graph = JSON.parse(readFileSync(path.join(root, ".redberry/module-graph.json"), "utf8"));
  } catch (error) {
    throw new Error(
      `无法读取生成模块图 .redberry/module-graph.json，请先运行 redberry gen：${error.message}`,
    );
  }
  if (!graph || !Array.isArray(graph.modules) || !graph.modules.length)
    throw new Error("生成模块图 modules 必须是非空数组");
  const ids = new Set();
  const roots = new Set();
  const modules = graph.modules.map((entry) => {
    if (
      typeof entry.id !== "string" ||
      !entry.id ||
      typeof entry.dir !== "string" ||
      path.isAbsolute(entry.dir)
    )
      throw new Error("生成模块图需要有效 id 和相对 dir");
    const directory = realpathSync(path.resolve(root, entry.dir));
    if (ids.has(entry.id) || roots.has(directory))
      throw new Error(`生成模块图目录越界或身份重复：${entry.id}`);
    ids.add(entry.id);
    roots.add(directory);
    return {
      id: entry.id,
      directory,
      publicEntry: owned(path.join(directory, "frontend/index.ts")),
    };
  });
  if (!roots.has(root)) throw new Error("生成模块图缺少根项目");
  return {
    modules: modules.sort((a, b) => b.directory.length - a.directory.length),
    ui: graph.targets?.["red-berry-kit/ui"] ?? "red-berry-kit/ui",
    web: graph.targets?.["red-berry-kit/web"] ?? "red-berry-kit/web",
  };
}

export function checkBoundaries(projectRoot = process.cwd(), config) {
  const root = realpathSync(projectRoot);
  const { modules, ui, web } = moduleGraph(root);
  const configFile = path.resolve(root, config ?? "frontend/tsconfig.app.json");
  const metadataFile = path.join(path.dirname(configFile), "shell.metadata.json");
  const consumer = existsSync(metadataFile)
    ? JSON.parse(readFileSync(metadataFile, "utf8")).consumer
    : undefined;
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configFile] });
    const project = snapshot.getProject(configFile);
    if (!project) throw new Error(`无法加载 TypeScript 项目：${configFile}`);
    const { program, checker } = project;
    const errors = [];
    if (version !== "7.0.2") errors.push(`TypeScript 必须统一使用 7.0.2，实际 ${version}`);
    const ownerOf = (file) => modules.find((module) => inside(module.directory, file));
    for (const source of program.getSourceFileNames().map((file) => program.getSourceFile(file))) {
      const file = owned(source.fileName);
      const current = ownerOf(file);
      if (!current || program.isSourceFileDefaultLibrary(source)) continue;
      if (path.relative(current.directory, file).split(path.sep).includes("node_modules")) continue;
      const frontend = owned(path.join(current.directory, "frontend"));
      const business = current.id !== ui || !inside(frontend, file);
      const shell = (current.id === web || current.id === consumer) && inside(frontend, file);
      // 布局只复用具名原生原语，不为整个壳层开放控件或任意样式属性。
      const layoutNames = new Set([
        "ActionIcon",
        "Breadcrumbs",
        "Button",
        "Drawer",
        "Menu",
        "NavLink",
        "ScrollArea",
        "Stack",
        "Text",
        "Tooltip",
      ]);
      const layoutAliases = new Map();
      const routerLinks = new Set();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const item of bindings.elements) {
          const original = item.propertyName?.text ?? item.name.text;
          if (statement.moduleSpecifier.text === "@mantine/core" && layoutNames.has(original))
            layoutAliases.set(item.name.text, original);
          if (statement.moduleSpecifier.text === "@tanstack/react-router" && original === "Link")
            routerLinks.add(item.name.text);
        }
      }
      const layoutImport = (node, name) => {
        const bindings = node.importClause?.namedBindings;
        return (
          shell &&
          name === "@mantine/core" &&
          ts.isImportDeclaration(node) &&
          !node.importClause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.every((item) =>
            layoutNames.has(item.propertyName?.text ?? item.name.text),
          )
        );
      };
      const layoutCSS = (name) =>
        shell &&
        name.startsWith(".") &&
        /\.module\.css$/.test(name) &&
        inside(frontend, owned(path.resolve(path.dirname(file), name)));
      if (business && /@ts-(ignore|nocheck)/.test(source.text))
        errors.push(`${source.fileName}: 禁止绕过类型检查`);
      function reject(node, message) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        errors.push(`${source.fileName}:${line + 1}: ${message}`);
      }
      function checkImport(node, name, literal = node.moduleSpecifier ?? node) {
        if (
          business &&
          ((name.startsWith("@mantine/") &&
            name !== "@mantine/hooks" &&
            !layoutImport(node, name)) ||
            (/\.(css|scss|sass|less)(?:\?|$)/.test(name) && !layoutCSS(name)))
        )
          reject(node, "业务必须经统一 UI 入口引用样式与组件");
        if (name.startsWith(".") && /\.(css|scss|sass|less)(?:\?|$)/.test(name)) {
          const asset = owned(path.resolve(path.dirname(file), name.split("?")[0]));
          const target = ownerOf(asset);
          if (!target) reject(node, "本地引用目标不在生成模块图内");
          else if (target.id !== current.id)
            reject(node, "跨模块只允许公开 frontend/index.ts 入口");
          return; // CSS 的通配声明不代表资源文件归属。
        }
        const resolvedFile = checker.getSymbolAtLocation(literal)?.declarations[0]?.path;
        if (!resolvedFile) return; // 无法解析的引用由同入口的 tsc 检查。
        const targetFile = owned(resolvedFile);
        if (
          business &&
          ((targetFile.includes(`${path.sep}@mantine${path.sep}`) &&
            !targetFile.includes(`${path.sep}@mantine${path.sep}hooks${path.sep}`) &&
            !layoutImport(node, name)) ||
            (/\.(css|scss|sass|less)(?:\.d\.ts)?$/.test(targetFile) && !layoutCSS(name)))
        )
          reject(node, "业务必须经统一 UI 入口引用样式与组件");
        const target = ownerOf(targetFile);
        const relativeTarget = target ? path.relative(target.directory, targetFile) : targetFile;
        if (relativeTarget.split(path.sep).includes("node_modules")) return;
        if (!target) {
          reject(node, "本地引用目标不在生成模块图内");
          return;
        }
        if (target.id !== current.id && targetFile !== target.publicEntry)
          reject(node, "跨模块只允许公开 frontend/index.ts 入口");
      }
      function checkLiteral(node, argument) {
        if (
          !argument ||
          !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
        ) {
          reject(node, "动态导入必须使用固定字符串字面量");
          return;
        }
        checkImport(node, argument.text, argument);
      }
      function visit(node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          checkImport(node, node.moduleSpecifier.text);
          const bindings = ts.isImportDeclaration(node)
            ? node.importClause?.namedBindings
            : node.exportClause;
          if (
            business &&
            node.moduleSpecifier.text === "react" &&
            bindings &&
            (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
          ) {
            for (const item of bindings.elements)
              if (
                ["createElement", "cloneElement"].includes(
                  item.propertyName?.text ?? item.name.text,
                )
              )
                reject(item, "业务使用 TSX 标签创建元素");
          }
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
          checkLiteral(node, node.arguments[0]);
        if (ts.isImportTypeNode(node)) {
          if (ts.isLiteralTypeNode(node.argument)) checkLiteral(node, node.argument.literal);
          else reject(node, "动态导入必须使用固定字符串字面量");
        }
        if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference)
        )
          checkLiteral(node, node.moduleReference.expression);
        if (business && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
          const tag = node.tagName.getText(source);
          const nativeLayout =
            shell && /^(div|main|section|header|footer|aside|nav|span|strong|small|a)$/.test(tag);
          const [base, member] = tag.split(".");
          const primitive = layoutAliases.get(base);
          const linkTarget =
            shell &&
            ((!member && ["NavLink", "Button"].includes(primitive)) ||
              (primitive === "Menu" && member === "Item"));
          for (const attribute of node.attributes.properties) {
            if (ts.isJsxAttribute(attribute)) {
              const name = attribute.name.getText(source);
              const expression =
                attribute.initializer && ts.isJsxExpression(attribute.initializer)
                  ? attribute.initializer.expression
                  : undefined;
              const allowed =
                (name === "className" && nativeLayout) ||
                (name === "component" &&
                  linkTarget &&
                  expression &&
                  ts.isIdentifier(expression) &&
                  routerLinks.has(expression.text));
              if (forbiddenProps.has(name) && !allowed) reject(attribute, "业务禁止底层样式属性");
            } else if (ts.isJsxSpreadAttribute(attribute)) {
              for (const property of checker.getPropertiesOfType(
                checker.getTypeAtLocation(attribute.expression),
              ))
                if (
                  forbiddenProps.has(property.name) &&
                  !(property.name === "className" && nativeLayout)
                )
                  reject(attribute, `展开包含样式属性 ${property.name}`);
            }
          }
        }
        if (
          business &&
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ["createElement", "cloneElement"].includes(node.expression.name.text)
        )
          reject(node, "业务使用 TSX 标签创建元素");
        node.forEachChild(visit);
      }
      visit(source);
    }
    return errors;
  } finally {
    api.close();
  }
}
