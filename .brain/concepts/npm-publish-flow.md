---
tags: [concept, npm, publish, 发布]
updated: 2026-09-13
status: active
---

# 概念：npm 包发布全流程踩坑（产品模式 "npm install -g xxx"）

## 触发场景
把一个 Node CLI 工具做成产品模式：`npm publish` → 用户 `npm install -g <pkg>` → `abs` 命令全局可用。**首次发布必经这串坑**，第二次起就有模板了。

## 🛠 标准流程（照此走，一次过）
1. **准备**：`npm pack --dry-run` 确认打进包文件干净（`files` 白名单 `bin/ src/ hooks/ skill/ README.md`，14 文件 ~37KB，别把 `.brain/.git/test/` 打进去）。
2. **注册账号**：https://www.npmjs.com/signup ，邮箱必须验证（未验证不能 publish）。
3. **登录**：`npm login`（浏览器授权）→ `npm whoami` 确认。登录信息在 ~/.npmrc。
4. **2FA（新版必卡）**：npm 已强制「发布需 2FA 或 bypass-2FA token」。二选一：
   - **账号 2FA**：npmjs → Account → Two-Factor Authentication → 验证器扫码。之后直接 `npm publish`。
   - **token**：npmjs → Access Tokens → Generate → granular token → Packages 读写 + **勾 bypass 2FA**。
5. **发布**：`npm publish`（scoped 需 `--access=public`）。
6. **验证**：`npm view <pkg> name version` + 浏览器开 `https://www.npmjs.com/package/<pkg>`。

## ❌ 遇到的坑（每个都有解法）

### 坑 1：账号未 2FA → 403 "Two-factor authentication ... is required"
npm 要求发布需 2FA 或 bypass-2FA token。
🛠 解法：开账号 2FA 或用 bypass-2FA 的 granular token（流程 4）。

### 坑 2：token 页面报 "必须至少选择一个组织"（英文: select at least one organization）
这是**误勾了「授予组织权限」**。个人发布自己的包**不需要任何 org 权限，也不需要 token 建 org**。
🛠 解法：token 页只给 Packages 读写 + bypass 2FA，**别勾 organization**；页面强制选 org 就关掉，改用账号 2FA（坑 1 的方式 A）。最省事=不开 token，直接账号 2FA。

### 坑 3：包名被拒 403 "Package name too similar to existing package"
npm 有**相似名防混淆**：`agent_brain_sync`（下划线）撞已存在的 `agent-brain-sync`（连字符），未占也拒发。报错直接提示改 scoped。
🛠 解法：改 **scoped 包名** `@<你的npm用户名>/<原名>`，`npm publish --access=public`。**bin 命令不受影响**（bin 是 `abs`，装完照用 `abs`）。README 包名/安装命令同步改。

### 坑 4：发布显示成功(+ @scope/pkg@0.1.0)但 `npm view`/registry 一直 404
PUT 返回 200 + **npm search 索引已能查到**，但 registry 的 package 元数据读取端点（CouchDB/corgi）延迟没追上。快则几秒，慢可达几十秒~分钟级。
🛠 解法：别慌，**浏览器开 npmjs 包页确认**（最权威）。等复制延迟，隔会儿再 `npm view`/`npm install` 验证。搜索索引查到 = 发布确实成功。

### 坑 5：全局已有旧版 → 安装报 "Remove the existing file ... or run npm --force"
之前用 `npm link` 链的旧 `abs`（symlink 回开发目录）和发布的全局包抢同一 bin。
🛠 解法：先清旧 link 再装正式包：
```bash
cd <开发repo> && npm unlink abs
npm rm -g abs            # 清残留全局
npm install -g @fanchao8609/agent_brain_sync
```
装完 `which abs` 应指向 `~/.nvm/.../node_modules/@fanchao8609/...`（发布包），**不是**开发目录链接。

### 坑 7：代码前进了版本号没跟 → 版本号撒谎（2026-09-13）
打标 `v1.7.5`（09:18）后，又落地了 c3c9974（英文分区名 + checkBrainShape）却**没 bump**，于是 `abs --version` 报 1.7.5、registry 也是 1.7.5，但**全局装的是旧码**（`grep checkBrainShape` = 0 命中）。
🛠 解法：**代码一变就 `npm version patch`**（顺带打 tag），别手改 package.json；发布前 `npm pack --dry-run` + 装到临时 prefix 实测一次；验证时**别信 `abs --version` 的数字**，直接 `grep` 新符号确认实际跑的是哪份码。

### 坑 6：`abs install --agent <宿主>` 报 "未知 agent"
宿主 agent 键 `cl​aude-code / co​dex / op​encode / pi` 含**零宽空格**（品牌名防误触），手打或经某些 shell 会带/漏这个不可见字符导致匹配不上。pi/co​dex 是纯 ASCII 没这问题，cl​aude-code/op​encode 有。
🛠 解法：用干净字节构造 agent 名再传（`printf` 携 ZWSP），**别在命令行手打那些词**；一次只能装一个（`--agent` 会互相覆盖）。完整安装矩阵/ZWSP 构造法见 [[abs-install-layout]]。

## 关键点
- **发布名与 bin 命令独立**：包名可 scoped（@user/pkg），bin 命令照旧（`abs`）。别被包名占位劝退，scoped 是 npm 官方给的解法。
- **product 形态 = 发布包 vs 开发 repo 分离**：`which abs` 指向发布包，开发 repo 只是源码。详见 [[deploy-artifact-copies]]。
- **不要给 npm / git 配 proxy**（2026-09-10 npm 已移除；2026-09-13 git 又踩一次）：曾致 `npm publish` 恒 `EHOSTUNREACH`，但 `nc`/`curl -x`/直连均通 —— 只有 npm 走不通。git 同理：`git config http.proxy` 指向已失效的 `192.168.0.114:7890` → push 报 `Failed to connect to ... port 7890`，而**直连本就通**。临时绕过：`git -c http.proxy= -c https.proxy= push`。直连本就通，代理是多余的一跳。

## 验证命令（回归）
```bash
npm whoami                     # @fanchao8609
npm config get proxy           # 应为 null（勿配代理）
git config --get http.proxy    # 应为空（勿配代理；失效代理会拦住 push）
npm view @fanchao8609/agent_brain_sync version
```
发布前必做：① 全量测试绿 ② `npm pack` 解包产物**直跑关键路径** ③ 发布后从 registry 全新安装再验一次。

## 关联连接
- [[abs-install-layout]] — 全局安装形态
- [[deploy-artifact-copies]] — 发布包/宿主落点/进程内存三份副本
- [[AgentBrainSync]] — 本项目实体
