# deployd 开发入口

## 必用 Skill 与依赖版本

- 每次开始或继续本目录及子目录的任务，始终使用已安装的 `$using-redberry`，实际读取其 `SKILL.md`，并按入口指引读取和使用适用的专业 Skill。Skills 由开发者独立安装与更新，CLI 不管理 Skills。
- 红莓框架带入的底层依赖及其版本跟随红莓框架统一维护，包括运行库、CLI 模板、pnpm catalog、overrides 和锁文件中的对应依赖。消费应用或模块不得自行升级这些依赖、修改框架内的依赖版本或用 override／replace 绕过版本约束；需要升级时在红莓框架中统一改造、验证，再同步到消费项目。业务自行引入且不属于框架底层的依赖由业务维护。

使用中文维护文档与注释。后端入口为 `cmd/deployd`；应用品牌与通用装配放 `backend/`、`frontend/`，任务领域业务放自有 `tasks/` 模块。

使用 `redberry create mod github.com/mapleafgo/deployd/<目录>` 创建模块，模块 ID 后缀即项目内目录；`redberry add/install/rm/up/list/outdated` 维护依赖。使用 `pnpm dev/gen/check/test/build` 执行统一任务；`pnpm build:split` 生成分离部署产物。

`.redberry/` 是可恢复生成目录，不手工编辑。修改 Go API 后执行 `pnpm gen`，前端通过生成客户端与模块公开入口引用；通用控件与页面容器从正式 `@red-berry-kit/ui` 公共入口消费，工作台由 `@red-berry-kit/web` 提供。配置放 `config/`，迁移放各模块 `migrations/`。发布产物不包含运行配置。

模块默认能力由 CLI 装配：前端入口可导出 `createProvider` 接收生成 API、应用 scope、共享 i18n、缓存与可卸载 HTTP 请求扩展（上下文不再包含 UI 能力，控件直接来自正式 ui 模块），应用只挂载通用容器和根 ModuleRouteBoundary；模块可导出 RouteGuard 统一控制路由访问。普通模块声明路由 `staticData.menu` 进入工作台；全屏页声明 `staticData.layout: "fullscreen"`，布局不代表访问权限。添加模块后不复制模块专属接线，验收从干净应用真实添加并填写必要配置开始。

前端功能先检索 Mantine 组件与 `@mantine/hooks`，核对项目已有能力；不适配再评估成熟社区方案，最后才自行实现并记录具体缺口。

前端新增与改造优先遵循当前版本 Mantine 官方文档与设计语言；先用原生组件、公开参数和统一主题，参考案例用于布局与交互。主题色、圆角与偏好作用域由正式 `@red-berry-kit/ui` 的 `UIProvider` 统一维护，应用入口显式传入 i18n、偏好 scope 与品牌；业务不单独覆盖组件皮肤，也不在应用内另建主题副本。

使用项目或依赖前，读取 [README](README.md) 的运行说明，再按实际安装图定位各模块根 `README.LLMS.md`。

## 项目特有规则

- 管理接口必须核验 auth 配置账户管理员身份，应用名或已登录状态不代表任务管理权限。Webhook 由任务令牌独立授权。
- 任务以服务进程身份执行 Shell，不提供沙箱。保留同名调度、快照、进程组取消和落盘失败恢复的不变量；改动这些链路时以真实命令及存储故障验证。
- `data/` 与私有配置包含任务令牌、运行输出及认证秘密，测试使用独立目录，不覆盖开发数据。
