---
tags: [concept]
id: publish-pi-package-to-npm
author: fanchao
updated: 2026-11-18
status: active
layer: 4
anchors: [installed-pi-package-check, npm-publish-staged-2fa-traps, pi-tool-renderer-override, git-proxy-troubleshooting, test-handmade-data-hides-key-mismatch, npm-i-g-local-package-becomes-symlink]
---

# 概念：把 pi 扩展发成标准 npm 包

## 触发场景
写好一个 pi 扩展（或 skill / prompt / theme），想通过 npm 分发、而不是手动 cp 到
`~/.pi/agent/extensions/`。也适用于把已有扩展改造成可发布包。

## ❌ 表现
**手动 cp 方式的三个问题**：

1. 没有包身份 —— pi 靠包名/路径去重，cp 的副本没有身份。若同时装了 npm 版，**两份会一起加载**
   （两份胶囊渲染器叠在一起）。
2. 升级靠人记得重新 cp —— 忘了就出现"改了代码但宿主跑旧副本"。
3. 无法分享、无法进官方画廊。

## 🛠 解法

### 1. `package.json` 最小配置

```json
{
  "name": "pi-capsule-tools",
  "version": "1.0.1",
  "type": "module",
  "license": "MIT",
  "keywords": ["pi-package"],
  "pi": { "extensions": ["./capsule-tools.ts"] },
  "files": ["capsule-tools.ts", "README.md"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true }
  }
}
```

要点：
- **`keywords` 含 `pi-package`** 才能进官方画廊 [pi.dev/packages](https://pi.dev/packages)。
- **`pi` 字段**指定资源路径；不用它的话得走约定目录名（`extensions/` `skills/` `prompts/` `themes/`）。
- **`.ts` 可以直接发**：pi 用 jiti 加载，实测无需编译成 `.js`。
- 去掉 `private: true`（有它发布会被拒）。

### 2. 依赖：host 包必须放 peerDependencies

pi 自带这 5 个（扩展可直接 import）：

```
@earendil-works/pi-ai
@earendil-works/pi-agent-core
@earendil-works/pi-coding-agent
@earendil-works/pi-tui
typebox
```

**必须放 `peerDependencies`（`"*"`），绝不能放 `dependencies`。**
放进 dependencies 会物理拷一份、**绕过 pi 的扩展模块映射**，产生重复的类与注册表，pi 会报扩展警告。

自有运行时依赖放 `dependencies`，pi 安装时自动装。

### 3. 安装 / 卸载

```bash
pi install npm:pi-capsule-tools   # npm
pi install ./local/path           # 本地目录（开发中）
pi install git:github.com/u/r@v1  # git
pi list                           # 查看
pi remove npm:pi-capsule-tools    # 卸载
pi -e npm:pi-capsule-tools        # 单次试用，不写 settings
```

默认写 `~/.pi/agent/settings.json`（全局）；`--local` 写项目 `.pi/settings.json`（需项目信任）。

### 4. 发布流程

```bash
npm version patch    # 自动 commit + 打 tag。别手改 package.json 的 version
npm run pack:check   # npm pack --dry-run，预览产物
npm publish
```

`pack:check` 加进 scripts：

```json
"pack:check": "npm pack --dry-run"
```

### 5. 同时发 GitHub

先用 `gh` 建仓库（或手动建，**别勾** Add README/.gitignore/license，否则首次 push 冲突）：

```bash
gh repo create <名字> --public --source=. --remote=origin
# 或手动：git remote add origin https://github.com/<用户>/<名>.git

git push -u origin main
git push origin --tags          # npm version 打的 tag 别忘推
```

`package.json` 补上链接字段（npm 页面会显示）：

```json
"repository": { "type": "git", "url": "git+https://github.com/<用户>/<名>.git" },
"homepage": "https://github.com/<用户>/<名>#readme",
"bugs": { "url": "https://github.com/<用户>/<名>/issues" }
```

**代理坑（本机 2026-10-09 实测）**：git 全局配了 `http.proxy = http://127.0.0.1:1082`，
该代理**间歇性返回 503 `CONNECT tunnel failed`**。同一命令重试几次就能过 —— 写脚本时
要**重试循环**（`for i in 1..4; do git push ... && break; sleep 12; done`），
不能一次失败就放弃。注意别用 `cmd | head` 判断成功：管道退出码取 `head` 的，永远为 0。

## 验证
```bash
npm run pack:check      # 产物只应含声明的文件，不该有 node_modules / 测试文件
pi list                 # 确认装上了
```

**发布后必做**：确认扩展真的被加载（不能只看 `pi install` 成功）。
装版与源码是否一致、node 24 怎么调试装版，见 [[installed-pi-package-check]]。

```ts
const r = loader.getExtensions();
r.errors                                   // 必须为空
r.extensions.find(e => e.path.includes("capsule-tools"))   // 必须存在
```

两个静默坑（首次发布返回 202 卡 staged 2FA、`pi install` 装到缓存旧包）另有一页：
[[npm-publish-staged-2fa-traps]]。

## 关联连接
- [[pi-tool-renderer-override]] — 发布前先保证渲染器真的接管了
- [[installed-pi-package-check]] — 发布后的装版体检与 node 24 调试限制
- [[git-proxy-troubleshooting]] — 推代码卡在代理时按那页的顺序查
- [[test-handmade-data-hides-key-mismatch]] — 发布前的门禁测试别用手造数据
- [[npm-publish-staged-2fa-traps]] — 发布返回 202 / 装到缓存旧包的两个静默坑
- [[fanchao]] — 本页沉淀者
- [[npm-i-g-local-package-becomes-symlink]] — 本机验证新包要真装副本：仓库里 npm i -g . 只会留下符号链接
