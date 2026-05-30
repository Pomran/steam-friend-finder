# Steam 玩伴探测

一键扫描你的 Steam 宇宙！通过硬核的数据分析，为你挖掘出藏在列表里、最能跟你玩到一块去的宝藏死党。

🌐 **在线使用**: [https://steam.i-test.top](https://steam.i-test.top)

## 功能

- **游戏库存分析** — 读取你的 Steam 游戏库，展示 Top5 最常玩的游戏和全部游戏清单
- **好友匹配排行** — 遍历所有好友的游戏数据，根据 Top5 游戏时长相似度计算匹配分数，自动排序
- **详情对比** — 点击任意好友查看详细的 Top5 时长对比、匹配概况和共同游戏列表
- **一键分享** — 生成包含匹配详情的图片，方便保存和分享
- **多格式支持** — 支持 64 位 Steam ID、完整主页链接、SteamID2 (`STEAM_0:1:...`) 和 SteamID3 (`[U:1:...]`) 格式

## 使用方式

### 在线使用（推荐）

直接打开 [https://steam.i-test.top](https://steam.i-test.top)，粘贴 Steam 主页链接即可使用，无需安装。

### 浏览器扩展

1. 下载本仓库代码（Clone 或 Download ZIP）
2. 打开浏览器扩展管理页面（Chrome 输入 `chrome://extensions`，Edge 输入 `edge://extensions`）
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择项目文件夹
5. 安装完成，点击工具栏图标即可使用

## 使用方法

1. 打开你的 [Steam 个人主页](https://steamcommunity.com/my/profile)
2. 复制地址栏链接，粘贴到输入框中
3. 点击「开始扫描」
4. 等待分析完成，即可查看结果

## 技术说明

- **前端**: 纯静态页面，部署于 Cloudflare Pages（国内可访问）
- **代理**: Cloudflare Worker 转发 Steam API 请求，解决跨域和网络问题
- **扩展**: Manifest V3 浏览器扩展，支持 Chrome / Edge
- Steam API 密钥内置混淆，用户无需自行申请
- 匹配算法基于 Top5 游戏时长的加权相似度 + 共同游戏数量

## 架构

```
用户 → https://steam.i-test.top (Cloudflare Pages)
                  ↓
        https://api.steam.i-test.top (Cloudflare Worker)
                  ↓
        api.steampowered.com (Steam 官方 API)
```

## 开源协议

[MIT](LICENSE)
