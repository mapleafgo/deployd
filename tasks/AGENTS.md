# tasks 模块开发入口

## 必用 Skill 与依赖版本

- 每次开始或继续本目录及子目录的任务，始终使用已安装的 `$using-redberry`，实际读取其 `SKILL.md`，并按入口指引读取和使用适用的专业 Skill。Skills 由开发者独立安装与更新，CLI 不管理 Skills。
- 红莓框架带入的底层依赖及其版本跟随红莓框架统一维护，包括运行库、CLI 模板、pnpm catalog、overrides 和锁文件中的对应依赖。消费应用或模块不得自行升级这些依赖、修改框架内的依赖版本或用 override／replace 绕过版本约束；需要升级时在红莓框架中统一改造、验证，再同步到消费项目。业务自行引入且不属于框架底层的依赖由业务维护。

模块 ID 为 `github.com/mapleafgo/deployd/tasks`。使用模块先读 [README.LLMS.md](README.LLMS.md)。

- **维护模块**：在源码仓库修改 `backend/` 与 `frontend/`，跨模块只使用公开入口；公共 API、组件、插口或配置变化同步更新 README.LLMS.md 中的具体用法；README 只维护模块介绍。独立后端开发示例的运行方式见源码仓库 `examples/basic/README.md`，该开发目录不随模块安装。
- **交付说明**：本文件、根 README.LLMS.md、根 README 与所链接的 `docs/` 随源码版本一起交付，保持相对链接可达，不把使用必需说明仅放在忽略的开发目录，也不在 `.redberryignore` 排除它们。消费方须显式读取依赖说明，不依赖使用说明自动加载；`.redberry/` 受管副本不手工编辑。

- 前端通用控件与页面容器从 `@red-berry-kit/ui` 公共入口消费，不直接引用底层 Mantine 组件或样式表。
- 页面文案通过本模块命名空间读取。

使用中文维护文档与代码注释，代码标识符、命令和路径保持原样。
