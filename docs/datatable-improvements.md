# DataTable 完善（2026-11-16）

## 已批准方案与边界

用户确认不引入 mantine-datatable，在红莓 UI 内完善现有 DataTable；对齐成熟表格的状态与使用体验，不复制完整数据网格。保留现有服务端分页、多列排序、列显隐/顺序/尺寸/固定和统一主题作用域，不升级依赖，不新增选择、展开、树或虚拟滚动。公开契约兼容，业务不提供布局补丁。

候选比较：普通跨列空行只解决DOM归属，不解决剩余高度或宽表可见区域；更换完整表格会引入排序与列状态迁移，本轮明确不做。采用现有原生表格与滚动容器，在 DataTable 内集中呈现状态，以可见表体而非整表总宽定位提示。初始错误、保留数据的错误、首次加载及刷新分别处理；错误由调用方受控，不在容器缓存请求结果。此前普通空行修改作为基线保留，不将它的DOM测试当作视觉证据。

## 验收与任务

| 编号 | 前置／动作 | 预期与验证 |
| --- | --- | --- |
| T1 | 空数据或无匹配结果 | 单一可访问提示位于表格边框内、表头以下的可见表体；桌面/窄屏/全屏几何与截图 |
| T2 | 宽列、横滚两端、列隐藏/重排/固定 | 提示不随表总宽漂移，表头与滚动条不被遮；浏览器实际滚动与交互 |
| T3 | 首次请求未返回；已有行后台刷新 | 不闪空态；原数据与请求状态正确，依赖旧结果的操作按既有规则禁用 |
| T4 | 初始失败或有数据时失败，随后重试 | 保留可用数据及未解决反馈；pending不误作成功；真实网络失败、真实后端恢复验证 |
| T5 | 国际化、加载/错误/空态切换、列设置 | 正确文案及唯一status/alert，不误作可操作数据行；真实Chromium组件与产品入口 |
| T6 | 公开类型与默认接入 | DataTable职责清楚，ListPage只装配；旧调用可用，干净应用真实CLI安装与核心使用 |

实施者仅修改框架 UI 源码、对应测试与公开说明；主代理负责消费工程真实E2E、统一检查/类型入口、干净消费和整合记录。实现冻结后由未参与实现者独立复验复杂共享状态、滚动及组合能力，避免以实现者结论代替验收。

## 发现与修复记录（保留失败）

- 源码基线：框架 modules HEAD fea6e99，已有两项未提交的空行改动；完整UI基线在 `/tmp/deployd-datatable-before`。主工程无Git历史，按快照、差异和实际检查核对。
- 起始真实基线空态纵向偏离可见表体中心88.15625px，见[基线红测](</tmp/deployd-datatable-geometry-red.log>)（当时旧Node26路径缺失，实际Node22探索；最终验证使用已校验重建的Node26.12.1）。
- 真实消费链另复现：Query初始失败后重新请求会清空error，造成调用方在pending阶段撤走反馈，见[真实初次验证](</tmp/deployd-datatable-real-initial.log>)。任务/历史两列表增加同一请求身份的错误展示生命周期，不在DataTable缓存请求结果；条件切换或最终新结果结束旧错误展示。对应3项Chromium分支回归与严格类型/lint通过，最终Tasks/Runs真实入口均已重验。
- 独立R2/R3严格复验发现：已有行的长错误裁切/把重试与数据挤出边框，以及固定父容器空态纵向偏差50.65625px。R3修了错误换行与原生有界滚动，但纵向仍失败；历史失败不覆盖。[独立报告](</tmp/deployd-datatable-independent.md>)及原始截图保留。
- R4确认原生Mantine core CSS的Paper `display:block`按导入顺序覆盖模块类flex，导致固定父高度没有传到表体；用Paper公开`display="flex"`修复，不靠!important或偏移量。UI测试支持入口补齐真实core/dates CSS；此前缺少原生CSS的组件成绩不作该场景证据。[原生CSS红测](</tmp/deployd-datatable-native-css-red.log>)及[原生CSS下UI整组39测](</tmp/deployd-datatable-ui-r4-final.log>)已实际执行，最终独立与消费复验已闭环，证据见下节。
- 实现者一次误将继承上下文历史job当作新绿，已主动撤回；只采用此后实际产生并核验的本轮日志，不以该误报作验收证据。R3曾因格式检查失败未进入最终通过；R4先定向格式/类型/严格lint通过后才冻结。
- 本轮开始时5173/8088/5273/8081均无监听，未停止用户服务。测试仅使用公开test配置与独立数据，不读取或展示开发凭据。

## R4 最终验收证据

- 原生core/dates CSS下UI真实Chromium9文件39测通过，包含14条DataTable；公开旧调用类型与独立app/test类型检查、严格lint及格式检查通过。[实现交接](</tmp/deployd-datatable-ui-handoff.md>)记录全部原红、配置错误、撤回证据及最终有效日志。
- 原独立验收者R4重验原F1/F2严格6项通过：固定flex/block文字中心误差0.65625px，auto自然高度误差0.6484px；长编号完整换行，长反馈原生滚动后重试实际可点击，数据区同时可见。后续5文件30项独立组合/国际化及旧公共入口类型编译通过。[独立报告](</tmp/deployd-datatable-independent.md>)保留历次不通过，不以数量替代行为。
- 根工程最终`check → test → build → build:split`依次exit0，184项测试、12项真实E2E通过；UI模块39项另有真实原生CSS回归，不混为同一统计。[根原始完整日志](</home/mapleafgo/.cache/redberry/logs/redberry-3985715015.log>)、[check](</tmp/deployd-datatable-integration-r4-check.log>)、[test](</tmp/deployd-datatable-integration-r4-test.log>)。
- [真实CLI创建](</tmp/deployd-datatable-consumer-create.log>)与[添加任务模块](</tmp/deployd-datatable-consumer-add.log>)使用独立boot/ui/tasks来源夹具，不写产品专属接线；最终R4 [consumer gen](</tmp/deployd-datatable-integration-r4-consumer-gen.log>)、[check](</tmp/deployd-datatable-integration-r4-consumer-check.log>)通过，[7项真实消费E2E](</tmp/deployd-datatable-consumer-r4-e2e.log>)通过。覆盖桌面、390横滚、全屏以及Tasks/Runs两入口通信失败→pending保留→真实200恢复；Runs保持2秒轮询。首次失败由route.abort模拟通信中断，恢复采用后端真实响应，不声称已验证后端业务500。
- 极短全屏允许面板纵滚保持分页可达：实际1000×320与390×400测试滚至分页、返回和退出通过；不声称极短视口不滚动，也不声称按屏幕裁切后的交集严格居中。根仅纠正原CSS不实注释，[精确注释替换核验](</tmp/deployd-datatable-comment-only.log>)证明CSS规则逐字不变，行为复用R4结果；[最终源码清单](</tmp/deployd-datatable-final.sha256>)含此注释修订。
- [单文件构建](</tmp/deployd-datatable-integration-r4-build.log>)、[分离构建](</tmp/deployd-datatable-integration-r4-build-split.log>)完成；因后者替换输出目录，另[保留两种最终产物](</tmp/deployd-datatable-r4-build-preserve.log>)，不将临时备份当发布。无框架/业务依赖升级，无提交发布。
- 所有本轮消费/测试服务已清理。已恢复原路径开发入口5173/8088，页面200、健康检查正常、匿名任务API401，便于用户自验；未重新读取或打印开发凭据。

限制：Firefox/WebKit、完整读屏与生产代理不在本轮证据内；保留原模块/服务端业务规则，不新增批量选择、展开、树或虚拟滚动。

## 空态视觉与通用文案补充

用户补充要求默认空态有图标、文案不局限新增操作，并否定直接放大的工具栏图标。现使用已安装Mantine9.7.4原生`EmptyState`维护图文间距，空数据采用32px收纳盒轮廓，无匹配采用搜索语义图标，灰阶装饰图形保持`aria-hidden`。默认文案为“暂无数据”/“无匹配结果”，英文“No data”/“No results”；不推断存在新增权限/入口，自定义emptyState不被改写。统一OperationIcon新增inbox及可选size，原默认16px不变，无新依赖。

原红见[图标与文案红测](</tmp/deployd-empty-icon-red.log>)。原生样式下[UI40项](</tmp/deployd-empty-native-ui.log>)、[统一check](</tmp/deployd-empty-native-check-stable.log>)与[真实3项空态/恢复E2E](</tmp/deployd-empty-native-real.log>)通过；图标+文字整体作为居中状态块，保留横滚/全屏/短区域边界。修正新双语测试结束时恢复语言，以及auto-height断言等待ResizeObserver（不降低边界判据）。首次check遇临时导出文件消失，未计通过，稳定源后重验成功；截图请求/tmp被Vite测试服务fs规则拒绝，该临时取图调用已移除，不放宽访问规则。已查看实际默认图形及[最终真实页面](<../test-results/datatable-empty-desktop.png>)。
