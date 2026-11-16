# 任务创建改造独立验收

验收者：`/root/independent_acceptance`。日期：2026-11-17。首轮与定点复验记录维护于本文，当前状态：**六项已复现问题均已定点复验关闭；本机桌面浏览器与后端验收完成，真实移动软键盘、中文 IME 和屏幕阅读器仍未验**。

## 范围与环境

依据 `AGENTS.md`、using-redberry、redberry-verification、redberry-code-review、任务创建设计与调研，以及实际安装的 tasks/ui `README.LLMS.md`。范围为 Bash、渐进创建与编辑、两级变量、正式 ui 代码字段、错误与草稿生命周期。ShellCheck 明确排除。

首轮源码基点为 deployd `3bc4ea2593f5d80b2154f831b3c906bead2ec4d4` 加交接工作区；ui 为同级正式源码，无 Git 元数据，首轮文件哈希见证据目录 `ui.sha256`。首轮静态产物哈希见 `initial-artifacts.sha256`。最终 split 产物与 ui 文件哈希分别为 `final-artifacts.sha256`、`final-ui.sha256`；六项修复均在最终冻结后定点复验，见下文。

所有独立证据与夹具位于 `/tmp/deployd-independent-acceptance/`，下文省略此前缀。后端使用 split 产物、独立公开测试配置副本，监听 `8182`；前端静态产物代理监听 `5374`。数据、cache、旧任务夹具均在本证据目录内。未读取开发 `data/` 或私有配置。登录使用公开测试凭据、公开 auth 测试挑战准备入口；自建 helper 在独立 cwd 读取公开配置副本。

干净消费者通过真实 CLI `create app --preset minimal`、本地 `sources`、`install` 与 `add red-berry-kit/ui --path …` 创建；源码位于 `ui-acceptance/`，Vite 独立监听 `5375`。测试页通过正式公共入口传入 CodeField props，不复制 ui 或 tasks 实现，也不补写模块专属装配。

## 适配核对

| 判据 | 结果与依据 |
| --- | --- |
| 正式 ui 公开能力，业务不直接引用 CodeMirror | 已核对，tasks 从 `@red-berry-kit/ui` 导入 CodeField/FormDisclosure；运行时及底层依赖归框架 ui |
| Mantine 原生能力与统一主题 | 已核对 Accordion、ScrollArea、UIProvider；独立主题与语言行为见 `theme-language.log` |
| 代码字段受控、加载失败备用、名称来源不含值 | 已实测受控原文、纯文本备用、变量名与来源展示；`clean-browser.log`、`compat-errors.log` |
| 干净应用 CLI 安装与公开入口消费 | 已执行，`clean-install.log`、`clean-add.log`、`clean-vite.log`、`clean-browser.log` |
| 首屏脚本优先及布局 | 首轮失败 A4；最终1280×720首屏代码首行可输入，390px代码与操作可达，见最终截图 |

使用图工具查询了 TaskEditor 调用关系；图仍包含旧 NoteField 位置，故只作导航，关系结论以当前源码与实际请求为准。CodeMirror 键盘事实由 Context7 先 library 再 docs 查询，原始输出 `codemirror-docs.log`，并以实际浏览器 Tab/Escape 行为复核。

## 行为实测

| 验收条件／实际入口 | 首轮事实与结果 | 原始证据 |
| --- | --- | --- |
| Bash 数组、`[[ ]]`、函数、独立 commands 进程 | 真正运行命令通过，独立进程不会继承前一命令 export | `backend.log` 的 BashSyntaxAndIndependentCommands |
| 清除启动项与导出函数；输入保留变量结构化错误 | 真实进程与 boot HTTP 中英文响应通过，错误不泄露秘密 | `backend.log` 的 BashIgnoresImplicitStartupEnvironment、ReservedShellVariableThroughBootHTTP |
| Bash 缺失／非 Bash 拒绝 | 缺失与 `/bin/false` 通过；`/bin/true` 误判为 Bash，失败 A6 | `backend.log`、`non-bash.log` |
| 旧任务升级可启动且不重写 | 含旧 ENV 的合法任务阻断启动，失败 A2；仅移除 ENV 的对照可启动 | `legacy-startup.log`、`legacy-control.log`、`tasks-legacy/tasks/legacy-with-env.fixture` |
| 管理员与 Webhook 授权、变量覆盖入口 | 真实 HTTP 与任务服务路径通过 | `backend.log` 的 HTTPAdminBoundaryAndWebhookCompatibility、StepWhitelistOverridesAndValidation、WebhookDeniedWithoutDisclosure |
| 取消／超时／FIFO／terminate／快照／并行汇总 | 使用独立数据与真实 Shell、子进程及调度链通过 | `backend.log` 对应 CancelKillsShellAndItsChild、SnapshotsWhitelistAndFIFO、TerminateAndTimeout、ParallelFailureDoesNotHideSiblingFailure 等 |
| 存储失败恢复不重跑、异常退出恢复 | 故障注入与真实命令通过，保留内存结果后恢复保存 | `backend.log` 的 ResultRetryRetainsMemoryWithoutReexecution、StartupRecoversInterruptedWithoutExecuting 等 |
| SSE、UTF-8 字节续传、认证复核 | 真实 boot HTTP SSE 通过 | `backend.log` 的 SSEByteOffsetsAndLastEventID、SSERechecksAuthenticationAtFifteenSeconds 等 |
| 最小创建与默认值 | 浏览器只填名称与脚本，POST201；默认 `/tmp`、30m、wait、串行、具名步骤 | `lifecycle.log` scoped-payload |
| 任务变量、步骤空值覆盖与步骤隔离 | 浏览器保存空值覆盖后真实执行，日志 first=<>、second=<task-value>；删除覆盖提交 env={} | `lifecycle.log`、`variables-expanded.png` |
| 未改旧 commands 原样保存 | API 建立双 commands 任务，浏览器只改说明，PUT 保留原数组 | `compat-errors.log` old-commands-preserved |
| 隐藏错误展开定位 | 折叠无效 timeout 后提交，区域展开且焦点定位 timeout | `compat-errors.log` |
| 网络失败与草稿结束 | 真实浏览器中断 POST，保留脚本，解除失败后重试201；成功后新草稿空，localStorage 无草稿 | `lifecycle.log` |
| 取消／继续编辑与 Escape | 草稿确认保留；编辑器 Escape 不关闭表单；继续编辑焦点回取消按钮，失败 A3 | `browser.log` |
| 唯一步骤始终展开 | 点击唯一标题后隐藏代码字段，失败 A1 | `browser.log`、`single-collapsed.png` |
| 500 行、原文、撤销、查找 | 干净消费者真实编辑原文500行；扩展撤销保留文档、查找可见 | `clean-browser.log`、`clean-expanded.png`、`clean-search.png` |
| Tab／Shift+Tab／Escape→Tab | 真实按键分别得到缩进、反缩进及焦点移出 | `keyboard.log` |
| 主题、语言变化保持历史 | 统一控件切到 dark/en，文本保持，撤销恢复语料原文，产生高亮节点 | `theme-language.log`、`clean-dark-english.png` |
| 变量补全不泄露值 | 显示 ONLY_NAME 与来源，无变量值；已有右括号时补全重复右括号，失败 A5 | `clean-browser.log`、`completion.log` |
| 加载故障恢复输入 | 阻断懒加载 chunk，显示加载失败和重试，备用 TEXTAREA 可写且保留原文 | `compat-errors.log` |
| 1280×720／390px 视觉 | 首轮保存取消均可达、窄屏可读；桌面初始代码完全在滚动区下方，失败 A4 | `initial-create.png`、`create-narrow.png` |

`go test ./tasks/backend/... -count=1 -v` 首轮退出0，耗时124.979s。此结论只证明日志内实际场景，不以测试数量代替表中判据。独立新增伪 Bash 用例使用 `go test -overlay overlay.json … -run TestIndependentRejectsNonBashExecutable`，不向产品目录写入测试文件。

## 问题闭环

| 编号 | 触发与影响 | 状态 |
| --- | --- | --- |
| A1 | 唯一步骤可折叠，隐藏唯一代码输入 | 已修复并独立复验通过 |
| A2 | 旧任务含 ENV/BASH_ENV 等新保留键，启动加载整库失败 | 已修复并独立复验通过 |
| A3 | 继续编辑焦点回取消按钮，不能按约定回编辑区 | 已修复并独立复验通过 |
| A4 | 初次1280×720界面代码完全不可见，不符合脚本优先目标 | 已修复并独立复验通过 |
| A5 | `${ON}` 内接受变量补全得到 `${ONLY_NAME}}` | 已修复并独立复验通过 |
| A6 | `/bin/true` 忽略参数退出0，被检查器认作 Bash | 已修复并独立复验通过 |

## 最终冻结后的定点复验

- A1：`final-browser.log` 唯一步骤标题禁用且代码可见；保留多步骤创建与变量功能，`final-lifecycle.log`。
- A2：新 split 二进制从原 ENV 旧JSON启动8183，经真实 Webhook受理，落盘结果 success、日志 old；`final-legacy-startup.log`、`final-legacy-trigger.json`、`tasks-legacy/runs/`。原任务文件 SHA-256 前后均为 `4444f61f21600b563b04fa51953b9869cc3d6df73334b144cbf68c1d9bee4dea`，`legacy-before.sha256`。定点测试同时复核旧保留项的执行过滤、新输入仍拒绝和原文不改写。
- A3：取消后继续编辑，等待400ms后焦点确为 `role=textbox`、`aria-label=Bash 脚本`，`final-browser.log`。
- A4：真正初始未滚动1280×720截图 `final-initial-create.png`，代码输入自 y=503 起出现；步骤代码提前、默认设置分组保留，保存取消固定可达。`final-create-narrow.png` 为390px代码编辑，正文和操作无横向裁切。`final-expanded.png` 为扩展模式。英文入口见 `final-english.log` 与 `final-english-initial.png`、`final-english-narrow.png`；原始英文截图保留了当时鼠标悬停的语言浮层，不据此假称视觉无任何覆盖。
- A5：同一独立干净消费者、原复现 `${ON}`，补全结果为 `${ONLY_NAME}`，`final-completion.log`。代码只消费紧邻当前表达式的原闭合括号，调用方数据契约未变；原文、500行与键盘证据适用。
- A6：原独立 `/bin/true` Go overlay负例现通过；真实 Bash、启动变量过滤、结构化中英文拒绝响应与旧任务加载定点执行全部通过，`final-backend-targeted.log`。

必要受影响回归：`final-lifecycle.log` 再次验证最小创建201、默认字段、两级变量空值覆盖真实运行、删除覆盖提交env={}、失败重试、成功新会话清空；`final-submit-lock.log` 真实延迟保存响应确认字段与CodeMirror均锁定、重复保存禁用、Escape不关闭。保存成功后故意让列表GET503，编辑器正常关闭，列表独立显示“请求失败，请重试”和刷新按钮，未将保存成功误报失败。`final-navigation.log` 验证浏览器Back触发丢弃确认、继续编辑保留、刷新触发原生beforeunload、取消离开保留草稿、确认丢弃后再打开为空。初次Back脚本未等待状态过渡的失败记录保留，增加100ms状态稳定及500ms观察后原场景通过。

正式ui只读与禁用实际验证见 `readonly.log`：两态contenteditable=false，不能改写；禁用时扩展按钮禁用，重新启用后可以继续编辑。程序化输入中文不等于真实IME。

复用说明：六项修复不改变已验证的进程组终止、调度链、快照、SSE与存储恢复实现，故复用首轮完整 `backend.log` 中对应真实命令/故障场景；新增Bash检查与旧数据校验另跑最终定点检查。ui仅改补全替换范围，原500行、主题/语言历史、只读/禁用与加载失败行为证据仍适用，不重复无关全套测试。

## 覆盖边界

- 没有真实移动设备软键盘、操作系统中文 IME 与屏幕阅读器环境；中文字符串输入、桌面390px视口和 ARIA/键盘检查不冒充这些实测。
- 干净消费者开发环境首次字段可编辑观测为346ms（另一次558ms），含本机缓存与浏览器启动条件；不作性能保证。未取得旧版同条件产物，不能宣称总构建增量已验证。
- 首轮A1—A6均保留触发与失败原始记录，通过最终定点复验关闭；没有删除失败判据或以测试数量覆盖失败。
- 非修改域既有状态不无限扩大验收；实现者已有 check/build 的原始日志由主 agent 另行保管，本文不把其摘要当独立行为证据。

干净Vite消费者在500行扩展时出现过多次 CodeMirror “Measure loop restarted more than 5 times” 警告，`clean-vite.log`；实际编辑、撤销、扩展仍通过，当前未复现功能失败，保留诊断事实而不推导全面性能结论。

## single 产物与最终快照

最后通过 `/tmp/deployd-final-single` 在独立8184、独立配置和数据目录运行单二进制。真实浏览器完成验证码登录、新建 Bash 数组／`[[ ]]`／函数任务（201）、触发运行并收到 success 与 `single:<single Bash>` 日志。证据：`single-browser.mjs`、`single-browser.log`、`single-server.log`、`single-success.png`。此项验证单产物实际可用，不以 split 或构建日志替代。

最终基准仍为 HEAD `3bc4ea2593f5d80b2154f831b3c906bead2ec4d4` 加工作区，快照如下：

| 对象 | SHA-256／证据 |
| --- | --- |
| deployd 已跟踪工作区差异 | `final-deployd.diff`，SHA-256 `f9840a3a9eeaec0e063d4000aa5868abca315419e92bc60eca76fa27af2160a6` |
| tasks 源码与本地化逐文件清单 | `final-tasks.sha256`，清单SHA-256 `acc4a40a5001c17b6961906e315ae7285ce68cccc5e57c897e0dc6e586302fc4` |
| 正式 ui 逐文件清单 | `final-ui.sha256`，清单SHA-256 `add85e4c9d99a48f0c912ed22e4101ed1ab34378edd515c24243f167c01f1b43` |
| single 两份产物 | dist/deployd 与 /tmp/deployd-final-single 均为 `40e92b7ce575805f2343bb70cf79cc7129bbd2733bfba6ae3decbdcec509a71b` |
| split 后端 | `2f013dda40b493b7dd0c49df809e64ab796b486dedf2bf1e8d8bbb0d05009725` |
| 完整静态与二进制清单 | `final-artifacts.sha256` |

验收者仅新增本文，未修产品实现。已终止本轮独立8182/8183/8184后端、5374静态代理、5375干净消费者及遗留浏览器进程；保留/tmp中的数据、脚本、日志与截图便于复核。主agent最终检查与构建日志另见 progress；本文独立结论限定于以上环境、实际用例和明确覆盖边界。
