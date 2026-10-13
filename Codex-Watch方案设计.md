# Codex 手表伴侣应用 — 方案设计

> 目标设备:Samsung Galaxy Watch5 (SM-R910,Wear OS 5 / One UI Watch)
> 目标:在手表上实时显示电脑端 Codex 正在运行的任务状态,并远程审批待审批内容

---

## 1. 总体架构

```
+---------------------------+        +------------------------------+        +---------------------+
|   Codex 桌面应用 (PC)     |        |  Watch Bridge 服务 (PC)      |  WSS   |  Wear OS 手表应用   |
|                           |        |                              |<------>|                     |
|  ~/.codex/sessions/*.jsonl|--tail->| - 事件监听器(数据采集层)    |        | - 任务状态列表      |
|  state_5.sqlite (threads) |--poll->| - 状态聚合 + 快照            |        | - 任务详情/事件流   |
|  MCP (codex-app 工具)     |<------>| - MCP 工具(主动上报/审批)   |        | - 审批卡片(批/拒)  |
|                           |        | - WebSocket 服务 + 配对      |        | - Tile/表盘复杂功能 |
+---------------------------+        +------------------------------+        +---------------------+
```
---

## 2. 数据源(已在本机验证)

| 数据源 | 内容 | 用途 |
|---|---|---|
| `~/.codex/sessions/**/*.jsonl` | 每个会话的完整事件流(item_started / item_completed / 审批事件等) | 实时 tail,检测"正在运行""等待审批" |
| `state_5.sqlite` -> `threads` 表 | 标题、预览、updated_at、tokens_used、approval_mode、git 分支 | 任务列表快照 |
| `queue_1.sqlite` | 排队任务 | 显示排队状态 |
| MCP 工具(注册到 Codex) | send_message_to_thread、read_thread 等 | 主动上报 + 审批结果回传 |

> 注意:这些是内部数据格式,桥接层必须容错解析,格式变化时降级为"仅显示基本信息"而不是崩溃。

---

## 3. PC 端:Watch Bridge 服务

技术栈:Node.js 22 + TypeScript

```
codex-watch-bridge/
├── src/
│   ├── collectors/
│   │   ├── rollout-tail.ts      # tail sessions/*.jsonl(新会话目录用 chokidar 监听)
│   │   ├── sqlite-poller.ts     # 只读轮询 state_5.sqlite(2s 间隔)
│   │   └── mcp-server.ts        # 注册为 Codex MCP 服务,提供主动上报工具
│   ├── core/
│   │   ├── state-store.ts       # 聚合后的任务状态(内存 + 落盘恢复)
│   │   └── approval-bus.ts      # 审批请求/结果事件总线
│   ├── transport/
│   │   ├── ws-server.ts         # WSS 服务(自签 TLS + token 认证)
│   │   └── discovery.ts         # mDNS 广播 codex-watch._tcp.local
│   └── cli.ts                   # 配对 / 调试命令
└── package.json
```

### MCP 注册(主动上报通道)

在 `~/.codex/config.toml` 中注册:

```toml
[mcp_servers.watch-bridge]
command = "node"
args = ["C:/path/codex-watch-bridge/dist/mcp.js"]
```

这样 Codex 会话中的 agent 可以调用桥接工具:

- report_progress({ task, percent, note }):主动播报进度
- request_watch_approval({ title, detail, risk }):发起手表审批,阻塞等待结果

### WebSocket 协议(JSON 消息)

```
watch -> bridge : { type:"hello", token, device:"watch5" }
bridge -> watch : { type:"snapshot", threads:[...] }          # 连接后全量
bridge -> watch : { type:"thread_update", thread:{...} }      # 增量
bridge -> watch : { type:"approval_request", id, title, detail, risk }   # 高优先级,带震动
watch -> bridge : { type:"approval_result", id, decision:"approve"|"reject", note? }
双向            : { type:"heartbeat", ts }
```

### 配对与安全

- 首次配对:手表扫描 mDNS 发现 PC -> 显示 6 位 PIN(桥接 CLI 生成)-> 手表输入 -> 换取长期 token
- 传输:WSS(自签证书,手表端锁定信任)
- token 存手表端 EncryptedSharedPreferences
- 桥接仅监听局域网网卡 + Windows 防火墙放行规则
- 审批消息带一次性 challenge id,防重放
---

## 4. 手表端:Wear OS 应用

技术栈:Kotlin + Jetpack Compose for Wear OS (Material 3) + OkHttp(WebSocket)+ Wear Tiles

```
CodexWatch/
├── app/
│   ├── ui/
│   │   ├── TaskListScreen.kt     # 圆形列表:状态色点 + 标题 + 时间
│   │   ├── TaskDetailScreen.kt   # 预览 / 事件流 / token / 耗时
│   │   ├── ApprovalScreen.kt     # 审批卡:命令内容 + 滑动确认批准 / 拒绝
│   │   └── PairingScreen.kt      # PIN 配对
│   ├── data/
│   │   ├── BridgeClient.kt       # WSS 客户端,自动重连(指数退避)
│   │   └── PairingStore.kt       # token 安全存储
│   ├── tiles/StatusTile.kt       # 表盘 Tile:运行中数量 + 最近任务
│   └── complication/             # 表盘复杂功能(常驻可见)
└── wear/src/main/AndroidManifest.xml
```

### UI 设计要点(圆形屏幕)

- 状态色:绿=运行中 / 橙=等待审批 / 蓝=排队 / 灰=空闲 / 红=失败
- 审批卡:橙色高亮 + 持续震动 + 命令全文(可滚动)-> 滑动确认手势批准(防误触),也可点击"拒绝"
- 审批请求同时发 Android 通知(wear 通知),点击直达审批页
- 离线状态:顶部显示连接断开,最后快照置灰

### 连接策略

- 手表与 PC 在同一 Wi-Fi:mDNS 发现 -> 直连 WSS(延迟 <1s)
- 离开局域网:Phase 2 再解决(见 §7)

---

## 5. 审批链路(核心难点与分级方案)

桌面应用的系统级审批弹窗(如命令升级执行)没有官方公开 API,因此分三级实现:

### 方案 A — 聊天内审批(推荐,Phase 1 主力)

工作流约定:凡是可能需要批准的操作,agent 先调用 MCP 工具 request_watch_approval,手表上批准/拒绝后,结果经桥接回传,agent 继续执行。

- 优点:完全可控、无需逆向、可靠
- 限制:覆盖"约定内"的审批,不拦截系统级 sandbox 升级弹窗
- 实现:request_watch_approval 在 MCP 服务内部挂起(Promise),桥接转发手表,手表结果回来后 resolve

### 方案 B — 系统弹窗检测 + UI 自动化(Phase 2 增强)

桥接 tail rollout JSONL 检测到系统审批请求事件 -> 桌面端用 OS 级自动化(UI Automation / Accessibility)找到对应弹窗按钮 -> 手表批准后自动点击。

- 优点:能覆盖系统级审批
- 风险:与桌面应用 UI 结构耦合,应用更新可能导致失效;作为尽力而为的增强

### 方案 C — 官方远程控制通道(持续观察)

本机 state_5.sqlite 存在 remote_control_enrollments 表(含 websocket_url),说明 Codex 桌面端已有远程控制机制(推测为 ChatGPT 手机 App 的远程控制)。持续关注官方是否开放 API,若开放则方案 A/B 可整体替换。

---

## 6. 里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| M0 环境准备 | Android Studio + Wear OS 模拟器;手表开启开发者模式、ADB over Wi-Fi | 开发环境可用 |
| M1 桥接服务(已完成 2026-09-28)| rollout tail + sqlite 轮询 + WSS 服务 + CLI 测试客户端;已验证:快照/实时更新/审批推送/审批回传全链路 | codex-watch-bridge 可运行 |
| M2 手表 MVP(已完成,真机验证 2026-09-28)| 手表经局域网 WebSocket 连接桥接:已连接 + 30 任务实时显示,token 计数实时增长;自动重连 + 凭据预置 + 启动自动连接 | 手表能实时看状态 |
| M3 审批流(已完成,真机验证 2026-09-28)| 桥接注册为 Codex MCP 服务,agent 调 request_watch_approval 阻塞等结果;已在真实手表上完成批准闭环 | 手表可批准/拒绝 |
| M4 体验加固(已完成 2026-09-28)| 审批通知+震动+通知栏直接批准/拒绝、mDNS 广播、PIN 配对、表盘 Tile;TLS 移至 M5 | 可日常使用 |
| M5 安全 + Complication(TLS/复杂功能已完成 2026-09-29;远程访问暂缓)| TLS wss + 自签证书 + 手表指纹锁定(已验证);SHORT_TEXT 表盘复杂功能;远程访问(手机中继/云中继)留待后续 | 局域网内安全可日常使用 |
---

## 7. 离开局域网的访问(Phase 2)

SM-R910 为蓝牙版(有 Wi-Fi,无蜂窝),离开家庭 Wi-Fi 后:

1. 手机中继(推荐):手机上跑轻量客户端连桥接云中继(自建 VPS WebSocket relay 或 Tailscale),手表经蓝牙与手机同步。实现成本中等。
2. 云直连:桥接通过反向 WebSocket 连到云端中继服务器,手表直连中继。需注意安全(端到端加密 token)。
3. 等待官方:Codex 手机 App 远程控制成熟后直接复用。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| sessions/*.jsonl、sqlite 属内部格式,版本升级可能变化 | 桥接容错解析 + 版本探测;降级为基本状态显示 |
| 系统级审批无官方 API | 方案 A 为主,B 为增强,关注方案 C 官方通道 |
| 手表端耗电 | 无审批时低频轮询;WebSocket 空闲心跳 30s;Doze 模式容忍延迟 |
| 安全(token 泄露) | WSS + 证书锁定、PIN 配对、一次性 challenge、可随时在桥接端吊销 |
| 圆形 UI 信息密度 | 卡片式设计,关键信息前 2 行,详情手势展开 |

---

## 9. 下一步

1. 确认开发环境(Android Studio + Wear OS SDK)
2. 先实现 M1 桥接服务(可在本机直接开发调试)
3. 再做 M2 手表端 MVP(模拟器开发,真机 ADB 部署)

---

## 10. 本机构建环境(2026-09-28 已配置)

| 工具 | 版本 | 位置 |
|---|---|---|
| JDK | Microsoft OpenJDK 17.0.20.1 | C:\Android\jdk-17.0.20.1+1 |
| Android SDK | android-35 / build-tools 35.0.0 / platform-tools | C:\Android\Sdk |
| Gradle | 8.9(项目含 wrapper) | C:\Android\gradle-8.9 |
| Android Studio | 2025.1.2.11 | C:\Program Files\Android\Android Studio |
| 依赖镜像 | 阿里云 maven 优先,google/mavenCentral 兜底 | CodexWatch/settings.gradle.kts |

已验证:`gradlew assembleDebug` 编译成功,产物 app-debug.apk (24.7MB)。
中文路径问题已用 `android.overridePathCheck=true` 解决。
