# CodexWatch 手表端 (M2 MVP)

Samsung Galaxy Watch5 (SM-R910, Wear OS 5) 客户端。Kotlin + Jetpack Compose for Wear OS。
连接 PC 上的 codex-watch-bridge(../codex-watch-bridge),实时显示任务状态,支持审批批准/拒绝。

## 功能(M2)

- 配对:输入 PC 的 `host:port` + token(存在本地 SharedPreferences)
- 任务列表:状态圆点(绿=运行 / 橙=待审批 / 灰=空闲 / 红=中断)、标题、活跃时间、token 用量
- 待审批置顶(橙色卡片),点击进入详情
- 详情页:任务元数据 + 审批卡(批准 / 拒绝,结果回传桥接)
- 断线自动重连(指数退避 1s→30s);认证失败(4001/4003)停止并提示

## 前置条件

1. 安装 Android Studio(latest stable,自带 JDK/SDK 管理)
2. PC 与手表在同一 Wi-Fi;查 PC 局域网 IPv4:`ipconfig`(找 WLAN 的 IPv4)
3. 桥接服务已在 PC 运行:双击 `codex-watch-bridge\start-bridge.cmd`,记下端口(默认 8787)和 token

## 手表开启开发者模式(一次性)

1. 设置 → 关于软件 → 连续点"软件版本"5 次 → 提示已进入开发者模式
2. 设置 → 开发者选项:
   - 打开 **ADB 调试**
   - 打开 **通过 Wi-Fi 调试**(或"无线调试")
3. 手机端 Wear 助手不需要额外设置;手表与手机蓝牙保持连接即可

## 构建部署

1. Android Studio 打开本项目(首次会自动 Gradle Sync,需联网下载依赖)
2. 手表与 PC 连接同一 Wi-Fi 后,在 AS 的 Device Manager 找到手表(无线配对:开发者选项里"无线调试 → 配对",把配对码填入 AS)
3. 运行 ▶ 到手表设备
4. 首次启动进入配对页:
   - PC地址: `192.168.x.x:8787`
   - Token: 桥接启动时打印的 token(也在 `bridge.config.json`)
   - 点"连接"

> 输入不便可用 ADB 代填:焦点放到输入框后
> `adb shell input text "192.168.1.100:8787"`

## 已知限制(M4 解决)

- 明文 ws://(未加密),仅限可信局域网
- token 明文存储
- 无审批震动/通知提醒
- 无 mDNS 自动发现(手动输 IP)
## 本机构建环境(2026-09-28 配置)

| 工具 | 位置 |
|---|---|
| JDK 17 (Microsoft OpenJDK 17.0.20.1) | C:\Android\jdk-17.0.20.1+1 |
| Android SDK | C:\Android\Sdk (platform-tools / android-35 / build-tools 35.0.0) |
| Gradle 8.9 | C:\Android\gradle-8.9 |
| Gradle 仓库镜像 | 阿里云 maven.aliyun.com(settings.gradle.kts 中优先,google/mavenCentral 兜底) |

用户环境变量已写入:JAVA_HOME / ANDROID_HOME / ANDROID_SDK_ROOT / PATH。

## 常用命令(本项目根目录)

```
.\build.cmd           # 编译 debug APK(= gradlew assembleDebug)
.\install-watch.cmd   # 编译 + adb 安装到已连接的手表
adb pair <ip:port>    # 手表无线调试配对(开发者选项里查看)
adb devices           # 确认手表已连接
```

产物: app\build\outputs\apk\debug\app-debug.apk

## Android Studio

打开本项目即可用;SDK 会被自动识别(local.properties 指向 C:\Android\Sdk)。
若提示缺 SDK 组件,Studio 会自动用 sdkmanager 补齐。
