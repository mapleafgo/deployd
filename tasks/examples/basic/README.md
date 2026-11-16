# tasks 独立后端示例

本示例通过模块公开 `backend.Module` 装配 tasks、auth 和 cache，由 boot 统一读取并校验配置。CLI 生成的消费应用已包含装配，不应复制本例接线。

## 依赖与启动

需要 Go 1.27.3 及相同版本的 boot/auth/cache 源码；版本以本目录 `go.mod` 为准。框架模块当前使用本地开发工作区，不从公共 Go 模块代理下载。创建临时开发工作区（路径替换为实际检出目录）：

```sh
mkdir -p /tmp/deployd-example-work
cd /tmp/deployd-example-work
go work init /path/to/deployd/tasks/examples/basic /path/to/deployd/tasks /path/to/modules/boot /path/to/modules/auth /path/to/modules/cache
export GOWORK=/tmp/deployd-example-work/go.work
cd /path/to/deployd/tasks/examples/basic
```

在本例 `config/app.local.toml` 填入独立的秘密值，文件权限应为 0600，切勿提交：

```toml
[red-berry-kit.auth]
admin_password = "替换为独立且符合口令策略的密码"
signing_seed = "替换为独立32字节随机值的标准Base64"
state_key = "替换为另一个独立32字节随机值的标准Base64"
```

用 `openssl rand -base64 32` 分别生成两个不同的密钥。口令至少15字符，不能包含账户名或使用常见口令。不要将秘密放入命令行、日志或版本库。

```sh
go test ./...
go run ./cmd/example check
go run ./cmd/example serve
```

监听 `127.0.0.1:8088`，按 Ctrl+C 关闭。此例不含前端页面；登录和管理客户端使用正式 auth 协议。普通 HTTP 仅供本机隔离开发，生产应设置真实 HTTPS 外部源和安全配置。

## 授权与数据契约

- 管理 API 限定 `App=admin`、`Source=config`、`ID=admin` 的已核验身份，不只检查登录。
- 必要的 `exclude_apis = ["/api/hooks/**", "/hook/**"]` 只免除全局登录检查，Webhook 仍由任务模块原子核验任务令牌。优先用 `X-Hook-Token`，避免 URL 令牌进入代理日志。
- 业务配置组为 `[mapleafgo.tasks]`，默认目录 `data/deployd`；旧项目迁移时由宿主调整配置组，复用既有 `tasks/`、`runs/` 文件目录，不复制秘密到示例。
- 同一数据目录只允许一个进程持有。运行命令使用服务进程身份，不提供 Shell 沙箱。日志和任务令牌均属敏感数据。
- SSE 使用 Base64 字节块和累计字节偏移，15秒复查身份，60秒限制连接寿命；客户端重新连接时传递最后成功处理的偏移。
