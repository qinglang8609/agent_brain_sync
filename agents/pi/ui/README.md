# 这一层放什么

pi 的前端样式：输入框、状态栏、主题色这类**只管长相**的代码。

功能性的 pi 扩展（会话 hook、todo 面板）放 `agents/pi/plugins/`。
目前唯一的样式代码在 `agents/pi/plugins/rounded-editor/format.ts` —— 它和扩展挂载是一个整体，
没拆到这里；等出现独立的样式文件再落进来。
