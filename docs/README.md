# 文档索引

`docs/` 放**长文档**：设计、规范、约定。一眼能看完的东西（命令用法、目录说明）留在根
[`README.md`](../README.md)，不在这里重复。

## 按功能分类

| 分类 | 目录 | 放什么 |
| --- | --- | --- |
| **插件说明** | `agents/pi/plugins/<插件>/README.md` | 每个 pi 插件自己的用法与实现要点 —— **不搬进 docs/**，就近放 |
| **项目主文档** | [`../README.md`](../README.md) | 安装、命令、图谱机制、目录结构 |

`docs/` 下没有第三类空目录。新增一类时建一个子目录 + 在本文件加一行，别在 `docs/` 根下平铺。

## 插件文档

| 插件 | 文档 | 是什么 |
| --- | --- | --- |
| capsule-tools | [`agents/pi/plugins/capsule-tools/README.md`](../agents/pi/plugins/capsule-tools/README.md) | 工具调用折叠成一行绿色胶囊；独立发 npm |
| rounded-editor | [`agents/pi/plugins/rounded-editor/README.md`](../agents/pi/plugins/rounded-editor/README.md) | 圆角四边框输入框 + 右下角状态 |
| todo-panel | [`agents/pi/plugins/todo-panel/README.md`](../agents/pi/plugins/todo-panel/README.md) | 编辑器上方的 `.brain/todo.md` 面板 |

## 写文档的规矩

- **文件名说清楚内容**，不用 `notes.md` `misc.md` 这类名字。
- **一份文档一件事**。要写第二件事就新建一份，然后在相关文档里互相引用 —— 引用的代价远小于
  一份什么都讲的长文档。
- **别抄**。同一个结论只在一处写，其它地方给链接。抄两份必然漂移。
- **没验证的标出来**（「未实测」「源码推断」），别把推测写成事实。
- **禁令直接写**（「不要 X」），不写「建议尽量避免 X」—— 后者等于没写。
