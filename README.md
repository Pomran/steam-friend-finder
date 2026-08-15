# Steam 玩伴探测

一键扫描你的 Steam 宇宙！通过硬核的数据分析，为你挖掘出藏在列表里、最能跟你玩到一块去的宝藏死党。

🌐 **在线使用**: [https://steam.i-test.top](https://steam.i-test.top)

## 功能

- **游戏库存分析** — 读取 Steam 游戏库，展示 Top5 和全库游戏清单
- **好友匹配排行** — 遍历好友游戏数据，按统一匹配算法排序
- **陌生人匹配（游戏搭子）** — 开放 Top5 数据，与其他用户互相发现
- **游戏车队招募** — 发布和加入组队招募，按游戏、时长、目标筛选
- **游戏周报** — 每周记录游戏时长快照，展示趋势与好友赛马
- **分享码 / 详情对比 / 一键分享** — 生成 Top5 分享码与匹配详情图片
- **多格式支持** — 支持 64 位 Steam ID、主页链接、SteamID2/3
- **权重与排除系统** — 自定义游戏匹配权重（1-5），排除不想参与的游戏

## 发车雷达 `/play`

Steam OpenID 一键登录的极速开黑大厅：

- **Steam OpenID 登录** — 手写 OpenID 2.0 校验 + HMAC 签名 Cookie，杜绝假冒 ID
- **发车大厅** — 创建 / 加入 / 退出 / 解散 / 踢人，一键复制房间码，`steam://` 加好友
- **入队审批** — 发车可选「需要房主同意」；申请人进入等待列表，房主可同意/拒绝
- **智能匹配** — 根据本机正在运行的游戏，一键匹配可加入车队与同游戏在线玩家
- **本机 Steam 联动** — 读取本机登录账号与当前游戏，自动按游戏筛选车队
- **共享在线状态** — 开启后站点记录你正在玩的游戏，其他人可按游戏匹配到你
- **桌面通知** — Web Push 桌面弹窗，上车/入队申请实时提醒
- **PWA** — 可安装到桌面，Service Worker 处理后台推送

### 本机 Steam 联动安装

1. 浏览器扩展页「加载已解压的扩展程序」选择 **`extension` 子文件夹**
2. 运行 `native-host\install.bat`
3. 重载扩展，打开 `/play`，右上角状态胶囊显示本机账号与当前游戏

> 卸载：`native-host\uninstall.ps1`。本地读取仅用于展示与匹配，身份校验以 Steam OpenID 为准；macOS 暂未实现。

### 环境变量

| 变量 | 说明 |
|------|------|
| `STEAM_API_KEY` | Steam Web API Key（登录后拉取昵称/头像） |
| `VAPID_PUBLIC_KEY` | Web Push VAPID 公钥 |
| `VAPID_PRIVATE_KEY` | Web Push VAPID 私钥 |
| `SESSION_SECRET` | 会话签名密钥 |

- 本地：写入 `.dev.vars`（已 gitignore）
- 生产：Cloudflare Pages 后台「Settings → Environment variables」配置

### 本地开发与部署

```bash
npm run dev      # http://127.0.0.1:8787/play（端口占用会自动 +1）
npm run deploy   # 部署到 Cloudflare Pages
node clean-test-data.js   # 清空本地 D1 测试数据
```

## 使用方式

### 在线使用（推荐）

打开 [https://steam.i-test.top](https://steam.i-test.top)，粘贴 Steam 主页链接即可使用。

### 浏览器扩展

1. 下载仓库代码
2. `chrome://extensions` 或 `edge://extensions` 开启「开发者模式」
3. 「加载已解压的扩展程序」选择 **`extension` 子文件夹**
4. 点击工具栏图标打开 `/play`

## 匹配算法

统一匹配分数 = 加权时长相似度 × Top5 命中率 + 库 Jaccard 相似度。权重 1-5 级可调，默认 3。

## 周报系统

基于 D1 的每周时长快照，扫描时自动记录：本周飙升/熄火、好友赛马、本周 TOP3、和你最像的人、连续活跃周数、一周一图。

## 技术说明

- **前端**: 纯静态页面，Cloudflare Pages 部署
- **后端**: Cloudflare Functions + D1（用户、招募、分享码、周报、发车、在线状态、推送配置）
- **首屏优化**: `/api/bootstrap` 合并 me/lobby/presence；分级轮询（lobby 90s、presence 180s），后台停止、回前台刷新
- **代理**: `/proxy` 转发 Steam API 请求
- **扩展**: Manifest V3（`extension/`），支持 Chrome / Edge
- **本机助手**: Native Messaging Host（`native-host/`），读取本机 Steam 状态

## 架构

```
用户 → https://steam.i-test.top (Cloudflare Pages)
          ├─ /           玩伴探测主页
          ├─ /play       发车雷达大厅
          ├─ /proxy      Steam API 代理
          └─ /api/*      D1 Database (Cloudflare Functions)

本机 Steam → native-host\host.exe → 扩展 background → 内容脚本 → /play 页面
```

## 开源协议

[MIT](LICENSE)
