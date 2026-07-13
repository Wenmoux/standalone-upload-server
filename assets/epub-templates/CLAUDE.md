# assets/epub-templates/

> L2 | 父级: [../../CLAUDE.md](../../CLAUDE.md)

三个 EPUB 样式的可执行模板文件。CSS 与 XHTML 骨架按 `style1/style2/style3` 前缀隔离；动态书名、作者、简介、卷章和正文只通过受控占位符注入，目录内不保存样例书名或正文。

## 成员清单

`style1.css`: 样式一完整排版规则，与制作说明、简介、竖排分卷及章页骨架配套。
`style1-colophon.xhtml`: 样式一制作说明页骨架。
`style1-intro.xhtml`: 样式一简介页骨架。
`style1-volume.xhtml`: 样式一分卷页骨架。
`style1-chapter.xhtml`: 样式一正文章页骨架。
`style2.css`: 样式二完整排版规则，保留独立背景并使用单一分卷图和单一章头图。
`style2-title.xhtml`: 样式二标题页骨架，不包含固定标志。
`style2-colophon.xhtml`: 样式二制作说明页骨架，不包含注记图。
`style2-intro.xhtml`: 样式二书籍信息与简介页骨架。
`style2-volume.xhtml`: 样式二统一分卷图骨架。
`style2-chapter.xhtml`: 样式二统一章头图与正文骨架。
`style3.css`: 样式三完整排版规则，覆盖说明框、全屏分卷、简介与正文。
`style3-colophon.xhtml`: 样式三制作说明页骨架。
`style3-intro.xhtml`: 样式三简介页骨架。
`style3-volume.xhtml`: 样式三全屏 SVG 分卷页骨架。
`style3-chapter.xhtml`: 样式三正文章页骨架。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
