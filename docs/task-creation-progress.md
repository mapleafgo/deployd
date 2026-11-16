# 任务创建改造当前记录

目标：按已确认方案切换 Bash，完成渐进任务表单、任务／步骤环境变量区分、CodeMirror 脚本编辑、错误定位与草稿保护，并由独立子 agent 验收。ShellCheck 属后续增量。

方案：[整体设计](task-creation-design.md)，依据：[调研](task-creation-research.md)。

实现：后端 Bash 与保留环境变量校验已完成；正式 ui 已新增 CodeField/FormDisclosure，框架统一维护 CodeMirror 依赖；任务表单已接入公共入口。源码在 deployd 与同级 red-berry-kit/modules/ui，生成内容由 redberry install 同步，不手工编辑。

已确认的修复：稳定初始步骤身份，避免默认值重建造成脏状态循环；服务端字段错误按步骤身份保存并定向清除，避免自动定位后错误提前消失；折叠组以 Mantine display-none 保留编辑器 effect；扩展编辑、搜索与 Escape 通过原生 Mantine 标记协调模态层。

证据：

- `/tmp/deployd-task-creation-red.log`：改造前两个新增真实浏览器场景失败。
- `/tmp/deployd-task-creation-green-final.log`：最小创建、真实 Bash 运行与草稿确认通过。
- `/tmp/deployd-editor-error-retention-final.log`：旧命令数组保留、错误定向纠正及语言切换通过。
- `/tmp/deployd-editor-browser-tests-final.log`：页面五项生命周期回归通过，原字段错误失败另由上述修复重验。
- `/tmp/deployd-bash-backend-full-final.log`：后端全量通过；race、存储/HTTP 回归见同前缀 race/regression 日志。
- `/tmp/deployd-ui-codefield-test.log`：正式 ui 编辑器浏览器验证，由实现 agent 维护。

消费者独立类型／lint／格式检查通过：`/tmp/deployd-editor-check-frozen.log`。185 项单元／浏览器组件测试通过：`/tmp/deployd-editor-web-tests.log`。该轮 E2E 与构建生成并行时发生 HMR 与刷新限流，原始两项失败保留；停止生成后稳定源码完整 15 项 E2E 通过：`/tmp/deployd-editor-e2e-frozen.log`，包含两级变量空值覆盖真实执行。single/split 构建通过：`/tmp/deployd-editor-build.log`、`/tmp/deployd-editor-build-split.log`。

编辑器单独懒加载 chunk 实测原始 348.4 KiB、gzip 111.4 KiB；这是最终产物块大小，不等于对旧版本的总构建增量。

进行中：独立验收 agent 在冻结源码上检查真实流程、后端及干净应用接入，桌面统一滚动仍待其行为证据。

独立首轮验收已执行真实后端、split静态产物、干净CLI消费应用和浏览器检查，报告见[独立验收](task-creation-acceptance.md)。发现 A1 唯一步骤可折叠、A2 旧ENV声明阻断启动、A3 恢复焦点、A4 首屏脚本不可见、A5 补全重复闭合括号、A6 伪Bash识别；均已有定点实现修复，等待同一验收者在最终产物复验。

修复证据：`/tmp/deployd-editor-a1-e2e.log`、`/tmp/deployd-editor-a3-focus.log`、`/tmp/deployd-editor-a4-check.log`、`/tmp/deployd-editor-a4-duration.log`、`/tmp/deployd-bash-legacy-race.log`、`/tmp/deployd-bash-identity-race.log`、`/tmp/deployd-ui-completion-final.log`。A4同时调整已有时长用例以展开按需说明字段，原超时失败保留在a4-e2e日志，不降低原值往返断言。

最终CLI同步与single/split顺序构建通过：`/tmp/deployd-editor-final-install.log`、`/tmp/deployd-editor-final-single.log`、`/tmp/deployd-editor-final-split.log`。最终完整 `pnpm test:web` 成功：`/tmp/deployd-editor-final-web-tests.log`，185 项单元／浏览器组件与 15 项 E2E 均执行且无跳过。框架正式 UI 的原场景与补全回归共 10 项浏览器测试通过。

独立六项定点复验均通过，最终报告见[独立验收](task-creation-acceptance.md)。已补齐 single 真实浏览器创建201、Bash数组／条件表达式执行成功及实时日志：`/tmp/deployd-independent-acceptance/single-browser.log`、`single-server.log`。single及split两种产物均已保留，single构建收尾证据 `/tmp/deployd-editor-final-single-preserved.log`。

本轮必修问题均已关闭；真实移动设备软键盘、系统中文IME与屏幕阅读器没有环境，明确保留未验。ShellCheck仍为后续增量。所有测试数据使用独立目录，开发data与私有配置未改；未提交或发布。
