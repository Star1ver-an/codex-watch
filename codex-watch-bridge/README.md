# codex-watch-bridge (M1)

PC-side bridge between Codex desktop local data and a Wear OS watch app.

## What it does (M1)

- Tails `~/.codex/sessions/**/*.jsonl` (live rollout events) and polls `state_5.sqlite` (thread metadata)
- Serves task status over a local WebSocket with token auth
- Detects approval requests (generic event matching) and relays watch decisions
- `--demo` mode injects a fake approval to test the full loop

## Run

```powershell
npm install
npm run build
npm run bridge        # starts on ws://0.0.0.0:8787, prints token
```

In a second terminal:

```powershell
npm run client        # test client: list / approve <id> / reject <id> / quit
```

Demo end-to-end test:

```powershell
npm run bridge:demo   # injects a fake approval after ~8s; approve it from the client
```

## Protocol (v1)

- watch -> bridge: `{type:"hello", token, device}` (within 5s)
- bridge -> watch: `welcome`, `snapshot`, `thread_update`, `approval_request`
- watch -> bridge: `{type:"approval_result", approvalId, decision:"approve"|"reject", note?}`
- heartbeat via ws ping/pong every 30s

Config: `bridge.config.json` (auto-generated, gitignored; contains port + token).
## Windows PowerShell 注意事项

若运行 `npm` 报错"禁止运行脚本"(Execution Policy),直接用项目自带脚本,无需 npm:

```
.\start-bridge.cmd   # 启动桥接(等价 npm run bridge)
.\start-demo.cmd     # 演示模式(等价 npm run bridge:demo)
.\start-client.cmd   # 测试客户端(等价 npm run client)
.\build.cmd          # 重新编译(等价 npm run build)
```

或一劳永逸放开当前用户脚本策略(影响全局,自行斟酌):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## M4 新增(2026-09-28)

- mDNS:桥接自动广播 `_codex-watch._tcp`(bonjour-service);手表配对页可发现服务
- PIN 配对:桥接启动时生成 6 位 PIN(每次重启刷新),手表配对页输入 PIN 换取 token
- 手表通知:审批到达时高优先级通知 + 震动,通知上可直接"批准/拒绝"
- 表盘 Tile:显示连接状态/运行数/待审批数,点击打开应用

安全说明:当前仍为局域网明文 ws + token;TLS(自签证书+锁定)计划 M5。

## M5 新增(2026-09-29)

- **TLS 加密**:桥接首次运行自动生成自签证书(certs/ 目录,持久化),局域网通道升级为 wss://;手表端按 SHA-256 指纹锁定证书,配对时自动捕获指纹
- **本地回环通道**:ws://127.0.0.1:8789 仅供 mcp.js 与本地脚本使用,不暴露局域网
- **表盘复杂功能**:SHORT_TEXT 复杂功能显示"运行 N / 待审批 N",点按打开应用;快照更新时自动 requestUpdateAll
- PIN 配对现在通过 TLS 进行,并回传证书指纹

安全说明:配对瞬间(输入 PIN 时)信任任意证书并记录指纹;之后所有连接严格锁定。如需重置,删除 certs/ 目录并重新配对。
