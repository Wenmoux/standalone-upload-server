# bot/epub-styles/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

EPUB 视觉插件模块。每个样式只描述 CSS、页面模板、全屏页声明和资源候选，通用长屏封面、XHTML、目录、manifest/spine 与 ZIP 由上级 `epub-builder.js` 统一生成。

## 成员清单

`assets/`: 版本化内置资源，包含样式一头图及四种原始字体，以及样式三从参考 EPUB 拆出的完整楷体、粗宋字体和阅读提示图。
`crane.js`: 旧仙鹤章头兼容样式，读取多处历史资源候选；保留旧配置兼容但不进入 Bot 直选白名单。
`index.js`: 四种样式实现的注册表，把经过服务端规范化的配置解析为具体插件，并向后台列出元数据。
`README.md`: 已注册样式矩阵、真实分卷语义、插件扩展契约与资源来源说明。
`STYLE1_REFERENCE.md`: 江湖纸卷参考 EPUB 的页面结构与取舍记录，是考据文档而非运行时输入。
`style-one.js`: 江湖纸卷插件，读取 Style1 独立文件模板并声明长屏封面、原始字体、竖排分卷、章头和可选内置头图。
`style-two.js`: 老二次元适配器，复用 `services/epub-style2-template.js` 的可配置模板和图片槽位。
`style-three.js`: 空门夜雨插件，读取 Style3 独立文件模板并声明长屏/全屏封面、完整原始字体、轻灰说明框、下划线真实分卷与居中单行章题。

## 插件边界

- 必填能力是 `id/name/description/css/renderIntro/renderVolume/renderChapter`；长屏封面、Apple 显示选项、封面目录名、封面/分卷全屏 spine、标题页、制作说明、嵌套目录和资源均为各样例显式声明的可选扩展。
- `index.js` 决定生成器可解析的样式，`services/epub-style-config.js` 决定合法配置，`bot/epub-style-picker.js` 决定 Telegram 可直选样式，三者职责不同。
- 动态文本必须使用生成器提供的转义和段落函数；资源必须先由 `hasAsset` 确认可用，模板不得假设本地文件一定存在。
- 只有源章节含真实分卷记录时才生成分卷页；样式不得自行注入“正文”等占位卷。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
