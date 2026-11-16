# 添加任务体验调研

调研日期：2026-11-16。范围：表单组织、脚本编辑、多步骤与纠错。本轮只调研，未修改产品代码或安装产品依赖。

2026-11-17 更新：用户已确定切换 Bash，整体提案见[任务创建与 Bash 脚本编辑方案](task-creation-design.md)。下文 sh 描述保留为调研时的源码事实，不再作为目标执行器与静态检查语言的建议。

## 结论

建议采用“脚本优先、配置按需展开”的单页编辑流程。默认完成路径是填写任务名称、确认工作目录、输入脚本、创建任务；复杂任务在同一份表单中添加步骤和配置覆盖。此结论是结合官方实践和本项目约束的设计建议，尚未通过用户操作实测。

## 已确认的现状

- `tasks/frontend/task-editor.tsx` 将任务配置与步骤分成左右两个滚动区，初始展示超时、同名策略、并行和两级变量入口。
- 新建任务默认 `/tmp`、`30m`、等待、串行；步骤名初始为空且必填。步骤目录允许空值，但控件未提示继承关系。
- 正式 ui 的 `NoteField` 固定 autosize、最少 3 行、最多 6 行，未公开行数、等宽字体等参数。当前脚本编辑空间受到此封装限制。
- `EditorPanel` 支持 modal/drawer，当前任务使用宽 modal。源码确认空闲时允许点击遮罩或 Escape 关闭；未见脏表单保护。
- 已有提交期间锁定、服务端字段错误映射和保留未编辑 commands 数组语义，应继续保留。
- 历史记录 `docs/rebuild.md` 表明双滚动区曾用于解决 1280×720 下保存按钮被顶出的问题；调整布局必须再次验证操作区可达，不能简单移除高度约束。

## 官方实践与适用判断

| 问题 | 来源事实 | deployd 建议（项目推断） |
| --- | --- | --- |
| 初始信息过多 | GOV.UK Details 建议按需展示仅部分用户需要的内容，明确反对隐藏多数用户必需的信息 | 名称、目录、脚本常显；超时与同名策略显示默认摘要并可展开；变量保留明显入口，不能因“高级”标签难以发现 |
| 步骤越来越长 | Rundeck 使用步骤卡片，支持添加、编辑、删除、排序；步骤变更最终通过任务 Create/Update 保存 | 单步骤直接展开；多步骤可折叠为名称摘要，新增步骤展开并聚焦；移动按钮保留键盘操作能力 |
| 脚本难编辑 | Windmill 为脚本提供专门代码编辑器，并将编辑、测试、设置区分 | 首先增加等宽字体、稳定编辑高度、扩展编辑空间；是否引入完整编辑器另做适配验证 |
| 提交后难纠错 | GOV.UK Error summary 要求汇总错误、链接到对应字段并管理焦点，同时保留字段旁错误 | 提交失败展示具体错误入口，自动展开出错区域并定位；网络失败保留全部输入 |
| 折叠行为实现 | Mantine 文档提供受控 Accordion、Collapse；9.x Collapse 使用 expanded，useCollapse 提供无障碍状态与动画行为 | 优先复用官方能力，经正式 ui 公共入口提供；不在业务内自行重写折叠动画与键盘行为 |
| 编辑空间实现 | Mantine Textarea 支持 autosize、minRows/maxRows 和 resize | 可先补正式 NoteField 的必要公开参数；完整代码编辑器不是改善高度的前提 |

## 候选方案

| 方案 | 适用条件与代价 | 本轮判断 |
| --- | --- | --- |
| 单页渐进展示 | 名称、目录、脚本可连续填写；多步骤仍在同一提交边界；需做好折叠摘要和错误定位 | 优先建议 |
| 分步向导 | 多个阶段存在明显依赖或必须逐步决策时适用；当前字段大部分可独立填写，会增加切换 | 暂不优先，若新手观察显示必须分阶段再评估 |
| 完整工作流画布/IDE | 适合复杂流程或大量脚本开发；需承担依赖、主题、可访问性、语言和加载成本 | 当前证据不足以支持直接采用 |

## 建议的界面结构

```text
新增任务
任务名称                 工作目录
说明（选填）

执行步骤
步骤 1：执行脚本          [步骤设置]
┌──────────────────────────────────┐
│ Shell 脚本：主要编辑空间          │
│                                  │
└──────────────────────────────────┘
[添加步骤]

环境变量（0）             [展开]
执行设置 · 30 分钟超时 · 等待前次完成 · 串行

[创建任务] [取消]
```

这只是信息层级示意，最终列数和容器根据实际宽度决定。单步骤名称可预填为“执行脚本”，保持可编辑并满足现有 API；这是提案，尚未确认。步骤目录以“继承任务目录”明确表达空值含义，不将继承路径写入覆盖字段。

## 分批建议与待验证项

第一批优先改善信息层级、脚本高度、默认步骤名、继承提示、错误定位和关闭时的输入保护。环境变量可能包含秘密，不自动落入 localStorage。保留当前服务端任务语义与独立 Shell 命令数组往返规则。

第二批按真实使用结果决定是否加入复制现有任务、完整代码编辑器、模板及“创建并运行”。Windmill 的即时测试依赖其自身执行模型；deployd 运行真实 Shell，若提供运行入口应明确标为真实执行，并独立呈现保存成功与执行受理失败。

必须验证：

- 单脚本场景只需用户填写名称、确认目录、输入脚本；默认配置可见可理解。
- 多步骤增删排序、变量及目录覆盖可达，折叠与展开不丢输入。
- 隐藏字段失败时自动展开并定位；网络失败可直接重试。
- 长脚本、多步骤、中文/英文、键盘、窄屏、1280×720 下保存与取消始终可达。
- 未改脚本文本时保留原 commands 数组；改动后仍遵循现有失败即停约定。
- 意外关闭保护与明确取消的行为一致；测试环境使用独立数据，不执行开发任务。

当前没有完成浏览器可用性对比，不能声称上述方案已提高创建速度。可用同一组单脚本、多步骤、故意输错场景，对比完成时间、额外点击和纠错路径。

## 来源与版本范围

脚本编辑专项的补充调研见下文；其中 CodeMirror 为优先验证候选，尚未定案。

- [GOV.UK Details](https://design-system.service.gov.uk/components/details/)
- [GOV.UK Accordion](https://design-system.service.gov.uk/components/accordion/)
- [GOV.UK Error summary](https://design-system.service.gov.uk/components/error-summary/)
- [Rundeck Job Workflows](https://docs.rundeck.com/docs/manual/jobs/job-workflows.html)
- [Windmill Script editor](https://www.windmill.dev/docs/script_editor)
- [Windmill Code editor](https://www.windmill.dev/docs/code_editor)
- [Windmill Instant preview & testing](https://www.windmill.dev/docs/core_concepts/instant_preview)
- [Mantine Textarea](https://mantine.dev/core/textarea/)
- [Mantine Accordion](https://mantine.dev/core/accordion/)
- [Mantine Collapse](https://mantine.dev/core/collapse/)

Mantine 通过 Context7 CLI 先解析 `/mantinedev/mantine` 再分别查询 Textarea 与折叠能力，共 3 条命令。项目 catalog 为 9.7.4；Context7 可列出版本最高为 9.0.0，本轮返回当前主线文档，不能视为 9.7.4 的逐项验证。实现前须对照实际安装包类型与行为；本轮未升级任何框架依赖。

## 脚本编写专项调研

日期：2026-11-16。结论：脚本是产品主要输入，建议将代码编辑能力纳入首批改造，优先验证 CodeMirror 6；单纯放大文本框可作最低成本方案，但不能覆盖高亮、查找、行号和编辑辅助需求。本结论是项目推断，不是已完成接入的选型。

### 执行语义必须先对齐

源码 `tasks/backend/execute.go` 使用 `/bin/sh -c`，不是按文本 shebang 选择解释器。编辑器应明确展示 `Shell（sh）`；默认按 sh 提示，不能宣称写入 `#!/bin/bash` 就能切换执行器。

当前 `commandsFor` 在脚本文本改变时加 `set -e`；未改变时保留原 commands 数组。高亮、聚焦、换主题、切换扩展编辑状态不能触发内容修改。原数组有多个独立 Shell 命令时，拼成一段文本编辑会改变执行边界，必须给出清楚说明。诊断应基于用户原始文本，若检查生成脚本，则将前缀带来的行号偏移映射回编辑器。

### 候选比较

| 候选 | 已查事实与来源 | 适用条件及判断 |
| --- | --- | --- |
| Mantine Textarea / 正式 NoteField | Textarea 支持可调行数；现有 NoteField 固定 3–6 行。Mantine CodeHighlight 文档将其定义为代码片段展示组件 | 适合纯文本输入或低成本过渡；高亮展示组件不能直接代替编辑器；未找到当前正式 ui 的代码编辑公共能力 |
| CodeMirror 6 | 官方提供模块化编辑、移动支持、MIT 许可；legacy-modes 提供 Shell 流式语言模式；可接补全源与诊断源 | 优先验证。Shell 高亮不等于完整解析、智能缩进或静态检查；这些必须分别验证，不假定开箱即用 |
| Monaco Editor | 官方提供可扩展语言能力，MIT 许可；FAQ 明确移动浏览器不受支持，VS Code 扩展也不能直接视为可用 | 若未来明确仅桌面、需要 IDE 级能力可以再评估；当前需要窄屏体验，优先级低于 CodeMirror |
| 自制高亮文本框 | 可以自行叠加展示层与输入层，但本次没有找到足以抵消成熟编辑器收益的项目约束 | 不建议；需承担选区、滚动同步、中文输入法、撤销、键盘与无障碍维护 |

维护状态说明：CodeMirror legacy-modes 的 GitHub 仓库于 2026-04-15 归档，但 README 明确说明迁移到 `code.haverbeke.berlin/codemirror/legacy-modes`，不能据此判为停维。本轮新站访问返回 403，尚未确认迁移后的发布节奏；采用前核对实际 npm 版本、来源、依赖图和发布记录。CodeMirror 核心及 Shell 模式标注 MIT，Monaco 标注 MIT；ShellCheck 为 GPLv3，交付集成方式应单独核对。

### 建议首批提供的体验

- 编辑区以脚本为主体，桌面初始约 12–16 行是待实测起点，支持扩展编辑；保持保存与取消可达，窄屏适配软键盘。
- 等宽字体、行号、当前行提示、Shell 高亮、查找替换、撤销重做、选区缩进；仅对已确认支持的语法启用智能缩进和括号辅助。
- 提供软换行，原始文本不插入换行；粘贴保留空白、引号和 here-document 内容，不自动格式化或 trim。
- 可从任务和步骤声明中补全变量名，插入 `${NAME}`；不在候选中展示秘密值。补全是额外数据源，编辑器本身不知道服务器安装的命令、路径和工具参数。
- 清楚展示执行目录及其继承关系，让用户在写脚本时知道执行上下文。
- 输入、失焦和表单错误接入既有表单，扩展编辑复用同一编辑状态与撤销历史；主题、语言变化不重建文档。

键盘特别约束：CodeMirror 官方默认不接管 Tab，以避免键盘陷阱。若增加 Tab 缩进，应展示可用的退出方法；官方提供 Escape 后 Tab 的逃生方式，而当前弹窗会响应 Escape 关闭，必须验证事件优先级。补全列表 Escape 应先关闭补全；退出编辑焦点不能误关整个表单。不要默认把 Ctrl+Enter 绑定为真实执行。

### 检查与执行分层

推荐后续评估本机 ShellCheck，以 sh 模式做静态诊断并映射到行列；官方工具可输出 JSON，能检查常见语法与语义问题。编辑器 lint 模块只是展示与调用框架，必须接入实际检查器。Shell 高亮模式不能替代 ShellCheck。

可先做手动“检查脚本”，后续再按耗时决定是否空闲后检查。诊断请求须绑定文档版本，旧结果不覆盖新文本；未部署检查器时显示不可用，不能显示“检查通过”。普通警告不直接阻止任务保存。检查脚本不执行任务，也不证明命令存在、目录可用或任务执行成功。

默认不将脚本发送到第三方检查服务。ShellCheck 使用 stdin 输入，并限制请求大小、超时与并发；不默认启用读取外部 source 文件的能力。是否内置、作为可选本机工具或采用浏览器 WASM 尚未定案：本机工具增加部署依赖，WASM 需要另查可信发布、体积、许可证与浏览器行为。本轮没有安装或运行候选。

### 最小验证范围与通过判据

在正式 ui 中验证通用代码字段，由 tasks 提供 Shell 模式、变量名和诊断；底层新增依赖在框架统一维护，消费应用只走公共入口。

1. 使用 20 行与 500 行脚本，含 if/fi、引号、变量展开、管道、反斜杠续行、here-document 和中文注释；验证高亮、输入法、缩进、复制粘贴及撤销，不修改原文。
2. 在宽弹窗、1280×720、窄屏及真实移动浏览器软键盘下验证选择、滚动、查找和操作可达；桌面模拟窄屏不能代替移动设备验证。
3. 反复折叠步骤、扩展编辑、切换主题与语言、改变变量、提交失败再重试，文本、光标、选区和撤销历史保留；多步骤之间不串状态。
4. 验证 Tab/Shift+Tab、补全 Escape、弹窗 Escape、屏幕阅读器标题与错误可达；加载中、只读与禁用状态正确。
5. 若引入检查器，用 sh 不支持的语法、未闭合引号和迟到响应验证诊断；位置对应用户文本，检查过程不执行脚本。
6. 在隔离数据环境核对未改 commands 数组原样提交；编辑后仍按现有单脚本约定提交。
7. 实测构建增量、按需加载网络请求和首次可编辑耗时。尚未做 bundle 测量，不以“CodeMirror 更轻”作为已证实结论。

### 专项来源与证据边界

- [Mantine CodeHighlight](https://mantine.dev/code-highlight/code-highlight/)：展示用途；线上页面为 9.8.x，项目为 9.7.4，不视为安装版新增能力证据。
- [CodeMirror 官方](https://codemirror.net/)：模块化、移动和许可说明。
- [CodeMirror Tab handling](https://codemirror.net/examples/tab/)：默认 Tab 行为与键盘逃生。
- [CodeMirror Autocompletion](https://codemirror.net/examples/autocompletion/)：补全源与快捷键。
- [CodeMirror Reference](https://codemirror.net/docs/ref/)：StreamLanguage、linter 与诊断扩展。
- [CodeMirror Shell 模式及迁移说明](https://github.com/codemirror/legacy-modes)。
- [Monaco 官方仓库与 FAQ](https://github.com/microsoft/monaco-editor)。
- [ShellCheck 官方](https://github.com/koalaman/shellcheck)与[命令手册](https://github.com/koalaman/shellcheck/blob/master/shellcheck.1.md)。

本轮 Context7 共 3 条命令：解析 CodeMirror、解析 Monaco，再查询 `/websites/codemirror_net` 的 Shell 语言与诊断接入。CodeMirror 官网部分直接读取返回 403，相关结论结合官方搜索索引、官方仓库及 Context7 文档；未将网页抓取成功等同于浏览器接入验证。
