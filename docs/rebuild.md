# 全项目重建当前摘要

## 目标与边界

用户要求框架重构后重新建项目，整个 deployd 代码按当前 using-redberry 重写。已采用真实 CLI minimal 骨架和独立 tasks 模块，旧代码只作行为参考，不直接搬回旧框架装配。不提交、不发布。

保留任务管理、Shell 调度、Webhook、历史与字节 SSE、管理员认证和运行数据；不增加 SQL、用户管理、自动重跑、日志轮转或旧 YAML 导入。

## 命名审查修复（2026-11-16）

已按本轮命名审查处理9类问题：运行日志拆分 `onCompleted` 与 `onCancelAccepted`，订阅开关使用 `enabled`；模块上下文使用 `useTasksContext`；未落盘终态使用 `unsavedResults`，保存与重试分别使用 `saveUnsavedResults`、`retryResultPersistence`；Go 契约改用 `Run.TaskName`、`TaskInput.SchedulingPolicy`；文件操作改用 `writeJSONAtomically`、`ensurePrivateDir`；报告判据改用 `isNonNegativeFinite`、`satisfiesFirstPassPolicy`。测试文件按任务交互、时长编辑、存储与校验职责重命名，文档链接已同步。

兼容边界：HTTP、持久化 JSON 和生成客户端继续使用 `name`、`queue`；四个领域结构的 JSON 名称与校验标签已逐项核对保持一致。Go 源码调用方使用新的字段名，前端协议类型注明字段的领域含义。保留 `ModulePage` 兼容别名及生成客户端既有操作名称。

本轮在 Node 26.12.1 下实际执行 `pnpm gen`、`pnpm check`、`pnpm test`、`pnpm build`，均退出0；任务后端完整竞态测试126.089秒通过，184项前端测试与12项真实Chromium E2E通过，无跳过或重试。E2E覆盖真实任务创建、运行日志、取消、删除、时长编辑及交互生命周期。测试使用独立数据与端口，未修改私有配置、开发数据或框架依赖，未提交发布。分离构建未重跑。

证据：[生成](</tmp/deployd-naming-gen.log>)、[检查](</tmp/deployd-naming-check.log>)、[完整测试](</home/mapleafgo/.cache/redberry/logs/redberry-3416015891.log>)、[构建](</home/mapleafgo/.cache/redberry/logs/redberry-1318446245.log>)。源码审查以 `/tmp/deployd-naming-before` 快照对比，无 Git 历史基线；代码关系图工具因缺少仓库元数据无法初始化，引用通过源码搜索核对。

## 当前全量问题修复（2026-11-16，已完成本轮闭环）

用户授权按 using-redberry 完整修复本轮命名盲审与复用审查发现的全部已确认问题。任务为修复、回归与独立复验，不提交发布、不覆盖开发数据或私有配置、不主动中断用户服务。开始核对时5173/8088和测试8081/5273均无监听。

| 范围 | 本轮完整判据 | 当前状态 |
| --- | --- | --- |
| 后端存储与取消 | 持久记录损坏、非普通文件、非ENOENT错误按真实故障分类，安全反馈及单次关联诊断；真正缺项/冲突保留 | 独立真实HTTP/文件故障矩阵及race通过 |
| 服务端字段校验 | 聚合Schema与语义错误，字段位置/稳定身份/双语纠正原因贯通，同字段同规则去重、不同规则保留；自动422整个body回显已移除 | 独立R2重验通过，包含触发、现代/旧Webhook GET/POST与鉴权优先 |
| 终态重试 | 每次失败保留当次原因与耗时，不重执行任务，不吞后续变化 | 原独立发现者实测通过 |
| 前端状态 | trigger/delete/editor生命周期分开；旧成功结果不抢走后发编辑，保留已受理运行入口；成功替代旧失败 | 组件独立复验及真实后端并发/取消后删除重试通过 |
| 退出过程 | 编辑/删除/日志保留展示快照至真实退出完成；快速重开、URL权威、普通/减少动效、认证失效立即清敏感分别处理 | 真实Chromium独立组件回归通过；产品使用链通过，未宣称像素级验收 |
| 全局命名 | TasksPage保留ModulePage兼容别名；内部任务/运行规则与failure对象命名分清；双语文案按位置精简，历史关联列/危险/独立访问保留限定；说明与调度术语明确 | 公开包消费类型检查、浏览器交互及使用说明同步完成，不破坏协议字段 |
| 消息与品牌 | 步骤序号完整插值，静态HTML与应用品牌一致；框架Chi默认带斜线请求编号安全保留并在错误反馈中显示 | 禁JS品牌及真实409响应编号UI可见通过，控制符/HTML/超长编号拒绝独立复验通过 |
| 复用核对 | SSE framing采用eventsource-parser 4.1.3，保留认证传输/字节续传/reader清理；Variables共用schema；Go精确时长及正常退出进程组清理有实际业务缺口；单文档入口不机械挂unload | parser选择、官方契约、边界及实际日志/Access轮换通过；其它有依据保留 |

分工：repair-all-backend 仅tasks/backend；repair-all-frontend 负责任务前端及对应测试；主代理负责应用品牌、公开说明、工具链、统一生成/检查/隔离真实使用验收。复杂共享状态及服务端错误安全边界完成后分别交未参与实现者独立复验，冻结被测源码，不预填通过。

已重建隔离Node26.12.1并按上一轮官方SHA256核验，路径/tmp/deployd-node26-runtime。实际Go1.27.3、pnpm12.15.0。宿主默认Node22，最终统一与定向验证均显式引用隔离PATH，不改系统版本或框架依赖。

只读复用研究/tmp/deployd-reuse-gaps.md已核对官方接口与实际安装能力；主代理进一步通过pnpm registry核实4.1.3发布、许可、engine及integrity，通过正式redberry install添加唯一新业务依赖。根package/catalog/Go依赖未改、框架版本未升级；redberry.lock本地UI摘要同步到已存在的干净框架HEAD fea6e99，主代理未修改框架源。安装前公开清单在/tmp/deployd-deps-before.86HVzi，安装日志/tmp/deployd-all-install.log；安装与编译/写源暂停协调，不并发覆盖。

### 最终证据与覆盖

- 两位原独立发现者均未参与实现。[后端独立R2](</tmp/deployd-all-backend-independent.md>)保留R1的空名称重复错误、触发变量缺字段信息两项失败；修复后原用例及Webhook完整消费链通过。[前端独立复验](</tmp/deployd-all-frontend-independent.md>)核对共享状态、退出快照、认证清理与parser，并补验Chi请求编号；没有预填整体通过。交接与原始红绿分别在[后端交接](</tmp/deployd-all-backend-handoff.md>)、[前端交接](</tmp/deployd-all-frontend-handoff.md>)。
- 原路径Node26统一gen/check/test及single/split构建全部通过。[最终统一原始日志](</home/mapleafgo/.cache/redberry/logs/redberry-3313819570.log>)：181项前端测试、9项真实E2E、各Go模块race通过；最终Go命中缓存，实际本轮全组后端race126.037秒在[首轮统一日志](</home/mapleafgo/.cache/redberry/logs/redberry-686096661.log>)，当时两个新E2E夹具失败没有改写为通过。
- 真实E2E只延迟已经由后端实际执行的响应，不伪造触发/创建结果；验证旧运行成功迟到不能抢新提交、Escape保护持续、真实活动409→真实取消→原确认重试删除→旧错误消失，并逐字核对真实X-Request-ID在界面可见。[最终新E2E](../tests/e2e/task-interactions.test.ts)已纳入永久统一入口。
- 干净应用使用真实CLI minimal创建并add最终tasks独立快照，只配置必要auth/数据/端口与标准本地框架来源，无产品接线。CLI check通过，[消费应用6项真实E2E](</tmp/deployd-clean-consumer-e2e-2.log>)通过；最终请求编号增量同步后[两项受影响用例](</tmp/deployd-clean-consumer-e2e-final.log>)再次通过。独立框架与任务夹具避免重写主工程共享node_modules。
- 最终单文件真实运行，独立缓存/任务目录及20秒Access，真实凭据轮换后按原字节续传，首尾中文各一次、任务成功；[35.9秒单文件验收](</tmp/deployd-final-single-expiry-2.log>)通过。首次工具配置未对齐后端端口的失败保留，不计产品通过。
- 整合过程的失败均有原始证据：CLI创建参数两次预检错误、消费应用补齐必填issuer/origin、测试工具cwd/配置端口对齐、新E2E期望文案遗漏任务名及误写取消200（实际契约204）、测试闭包类型告警。仅修相应夹具/类型并按真实契约重新执行，不删除用例或降低业务判据；生产修复后独立源码冻结清单核验一致。
- [最终单文件构建日志](</tmp/deployd-all-build-final.log>)及[分离构建日志](</tmp/deployd-all-build-split-final.log>)均exit0；单文件与分离产物同时保留。统一日志存在Go忽略node_modules软链接、NO_COLOR与FORCE_COLOR提示，独立browser日志有Vitest动态import的Vite提示，未隐藏或当作零warning；项目严格lint最终无warning/error。
- 本轮临时5293/8093消费服务、8094单文件及所有测试监听已回收，验证后移除仅本轮创建的test.local端口/目录覆盖；用户data及开发app.local未主动改写。开始与结束5173/8088均无服务，不声称已启动开发环境。未提交、发布、升级框架依赖或迁移协议数据。

本轮已确认问题均已闭环；生产代理、断电、持续ENOSPC及像素级/完整读屏验收不在本轮结论内。原复用审查与盲审首次报告保留为失败基准，不以历史重建成绩替代本轮证据。

## 上一轮独立修复（历史证据，不代表本轮验收）

用户追加要求：按 using-redberry 修复干净子 agent 全审确认的问题，继续独立复验，直到本轮没有遗留确定问题；不提交、发布，不覆盖数据或私有配置，用户5173/8088自测服务不主动关停。

- B1/B2已由原独立后端审查者关闭：真正缺项/非法offset仍404/422且无故障噪声，存储技术故障安全500或streamFailed，原始原因/运行请求关联/阶段耗时记录一次；鉴权正常拒绝与限流和依赖故障分开，保持fail-closed，不把依赖失败误报需登录。实际boot转换链确认不会重复ERROR；15秒分类与真实5秒TCP慢消费者复验通过，未变60秒路径合理复用原始证据。报告 /tmp/deployd-clean-audit-backend-r2.md。
- F1/F2/F3已由原独立前端审查者关闭：校验匹配当前Go实际解析与业务范围，原字符串保存；正式包名可导入ModuleContext；任务/历史菜单消费不同的公开语义图标，工作台双语、折叠、移动、键盘链路通过。
- 复验新发现V1也已修闭环：任意非零/启动失败/信号结束不能因stdout为空而假绿，stderr保留；真实exit42、静默exit3、ENOENT、SIGTERM与成功对照通过。
- F1二轮补齐当前Go uint64累计回绕与单段小数溢出语义，不排除已被API接受的原值掩盖兼容缺口。独立审查者21,815输入与当前Go差分零差异，并从真实组件重验一般/回绕原值、commands/env保真。报告 /tmp/deployd-clean-audit-frontend-r3.md；无新确认遗留，但不是所有字符串的形式证明。
- 精确Node26.12.1从nodejs.org下载、按官方SHASUMS256验证，仅隔离在/tmp/deployd-node26-runtime；未改系统Node或框架依赖版本。统一及独立复验实际使用声明版本，补齐上轮Node22环境限制。命令PATH须引用（宿主PATH含空格）。
- 永久类型入口已纳入tasks/tests全部8个测试文件，不依赖临时tsconfig掩盖类型遗漏。新增真实后端E2E在创建请求中仅更换Go合法时长，响应/PUT不mock；.5h/+30m/1000000us的真实创建、原值编辑说明、删除全通过。
- 最终原路径Node26统一gen/check/test/build/build:split全部通过；Go后端全组race125.991秒、前端166项、真实E2E6项。原始统一日志 /home/mapleafgo/.cache/redberry/logs/redberry-4288026001.log；各步骤日志 /tmp/deployd-review-fixes-{gen,check,test,build,split}.log。两种修复后产物均保留。
- 两个独立审查者均未参与实现，按新冻结代码重新沿受影响完整链核对；本轮无遗留确定问题。生产cache故障、断电、生产代理等未验边界仍在报告中明确保留，没有以数量或Mock替代真实使用结论。
- 开发5173/8088服务与PID保持，未主动重启，未操作用户data/私有配置。前端沿正常HMR加载；原Go开发进程仍映射旧可执行文件，后端修复需重启该开发服务后才生效，不能把隔离测试通过说成当前8088已升级。

原审查报告：/tmp/deployd-clean-audit-backend.md、/tmp/deployd-clean-audit-frontend.md；实施红绿与交接：/tmp/deployd-stream-fix-report.md、/tmp/deployd-f1-f2-f3-handoff.md。根源码无Git历史，审查采用文件清单与SHA256，最终自有源码/测试/公共配置清单在 /tmp/deployd-review-fixes-final-baseline.json；未提交或发布。

## 当前有效方案

- 应用 ID：github.com/mapleafgo/deployd；后端入口 cmd/deployd。应用仅持有品牌、配置和通用装配，任务领域在 tasks。
- 框架依赖 boot、auth、cache、ui、web；前端从正式 ui/web/auth 公开入口使用能力，Provider 与路由由 CLI 默认装配。
- UI 缺少的最小公共滚动/日志跟随、宽编辑面板、语义图标及纯图标复制在框架 ui 源码补齐，通过 CLI sources 指向同级框架工作区；未升级框架底层依赖或版本。
- boot 既有 startup.go 缺末尾换行阻断统一检查，仅在框架源码补换行，通过标准本地来源接入；未改生成副本。
- tasks 配置按模块身份使用 mapleafgo.tasks，数据目录保持 data/deployd；不伪造配置 Target 或保留应用专属接线。
- 管理接口核验配置来源的 admin 应用管理员身份。Webhook 通过必要 auth 策略排除登录检查，但仍由任务令牌独立授权。
- 中文/英文资源由各模块隔离管理，Go API 是契约源；错误按安全结构化语义与关联编号显示，不暴露秘密或内部异常。

## 安全与切换

- 原工程无 Git。重建前源码、锁、配置和数据归档为 /home/mapleafgo/Projects/OpenProject/deployd-before-rebuild-20261113.tar.gz，权限0600，已验证归档可读。
- 隔离重建目录为 /home/mapleafgo/Projects/OpenProject/deployd-rebuild。切换时原目录整体保留为 deployd-before-rebuild-20261113，再将新工程置于原 deployd 路径。
- 原开发 app.local.toml 已原样复制、权限0600，未打印秘密；原 data 已独立复制，原件随旧目录保留。旧测试本机覆盖不携带，新测试仅使用独立目录。
- 原项目没有运行中的8088/5173服务。所有本轮隔离服务均使用测试端口或8393/8394，结束后回收。

## 已完成验收与有效证据

1. 统一 gen/check/test、single/split 构建曾在隔离新工程通过。统一测试包含 tasks/auth/boot/cache Go race、104项前端测试、5项真实浏览器用例；日志 /home/mapleafgo/.cache/redberry/logs/redberry-2361187802.log。其后仅有已单独复验的桌面布局与Portal定位修正，最终原路径需重新统一验证。
2. 真实浏览器：验证码登录、匿名401、任务新增、真实Shell首段中文实时输出、运行取消终态、删除；窄屏草稿和操作可达；取消请求失败时真实日志继续且错误保留。单二进制直接服务的4项业务用例也通过，/tmp/deployd-single-artifact-e2e.log。
3. 后端独立R1：FIFO/terminate/快照/白名单、异名并发、独立Shell、进程组、实际256容量及第257拒绝、落盘恢复不重跑、关闭与中断恢复；真实60秒SSE、15秒撤权、字节续传、慢TCP阻塞写。/tmp/deployd-independent-verify/report.md。
4. 后端独立R2关闭异步故障缺诊断：技术原因/运行ID/阶段耗时、正常取消无误报、不泄脚本环境令牌、故障补写与Unicode字符边界；/tmp/deployd-independent-verify/report-r2.md。未改SSE源码，复用R1长测试。
5. 前端独立R2关闭4项P2：旧Access限定刷新和真实401身份边界、服务端字段回填及步骤身份映射、UTF8真实1MiB上限、安全requestId。真实AuthSession与组件、node定向复验通过，敏感视图默认门禁未绕过。
6. 旧版真实执行器通过overlay生成任务、令牌、两个独立commands、成功历史与中文日志夹具；新执行器race读取兼容且不重跑，/tmp/deployd-legacy-compat-generate.log、/tmp/deployd-new-compat-read.log。
7. 干净消费应用通过真实CLI添加最终模块快照与框架本地来源，只填必要配置并改隔离端口，没有产品专属接线，2项真实业务用例通过，/tmp/deployd-consumer-final-e2e.log。快照避免不同消费应用安装时重写同一源码内node_modules。
8. 真正单二进制、20秒Access（高于客户端10秒提前刷新窗口）专项：旧Bearer到期后自动按原字节偏移续传、凭据轮换、首尾中文各一次、任务成功，35.7秒通过，/tmp/deployd-single-expiry-20s-e2e.log。2/4秒极端TTL因每次请求提前刷新触发正常限流的原失败保留，未关闭安全限流。
9. 真正split后端+静态产物/透明代理：60秒断流后自动续传、首尾中文不重复、任务成功，/tmp/deployd-split-lifetime-e2e.log。不是生产代理结论。
10. 真实1280x720桌面发现并修正：左侧内容顶出底部操作；表格作用域Portal使宽面板横向偏移。左右各用公开ScrollArea，框架Modal固定层显式对齐视口，不更改皮肤。回归确认保存/取消完整可见、右滚不动左、草稿保留且取消可点，/tmp/deployd-desktop-layout-dev-final.log；框架新增Portal组件回归通过，/tmp/deployd-ui-portal-final.log。对应局部源码已独立复查。

## 最终状态

已完成全项目重建并切回 `/home/mapleafgo/Projects/OpenProject/deployd`。原工程完整保留在同级 `deployd-before-rebuild-20261113`；数据目录逐文件比较一致，开发私有配置逐字节比较一致。

最终原路径已通过 `redberry install --locked`、`pnpm gen`、`pnpm check`、`pnpm test`、`pnpm build`、`pnpm build:split`。统一测试实际包含 tasks/auth/boot/cache Go race、104项前端测试与5项真实浏览器用例；最终统一原始日志 `/home/mapleafgo/.cache/redberry/logs/redberry-1202881119.log`。运行配置没有进入发布目录。

- 最终单二进制在原路径直接运行，桌面1280×720的完整按钮可见性、独立滚动、草稿与关闭通过（`/tmp/deployd-delivery-layout.log`）；4项完整业务浏览器用例通过（`/tmp/deployd-delivery-e2e.log`）。不是只验证Vite。
- 框架UI完整29项回归通过（`/tmp/deployd-final-ui-test.log`），包括滚动、跟随、键盘提示、复制失败、宽面板与偏移Portal；框架最终差异已复查，无底层依赖或版本升级。
- 干净消费应用的最终独立模块快照重新通过真实CLI安装和2项浏览器业务验收（`/tmp/deployd-consumer-final-snapshot-e2e.log`），没有产品专属接线。
- 最后恢复主工程依赖并再次通过统一check（`/tmp/deployd-delivery-check.log`）。全部本轮隔离服务已关闭，5273/8081/8393/8394/5293/8093无遗留监听；临时端口覆盖已移除。
- 单文件产物为 `dist/deployd`，分离产物为 `dist/backend/deployd` 与 `dist/admin/`；保留两种已构建产物。未提交或发布。

## 明确限制

未连接生产反向代理验收。存储一直未恢复而进程异常退出时，尚未落盘的内存终态不能保证跨进程恢复。截图已记录；当前宿主 read_image 因Linux Electron/sharp冲突不可用，未声称人工像素级视觉复查，使用真实浏览器交互、几何和组件回归核对受影响布局。
