# assets/epub-templates/

> L2 | 父级: [../../CLAUDE.md](../../CLAUDE.md)

三个 EPUB 样式的可执行模板文件。CSS 与 XHTML 骨架按 `style1/style2/style3` 前缀隔离；动态书名、作者、简介、卷章和正文只通过受控占位符注入，目录内不保存样例书名或正文。

## 成员清单

`style1.css`: 样式一参考 EPUB 同值排版规则，声明原始字体资源并保持简介页无背景色。
`style1-colophon.xhtml`: 样式一制作说明页骨架。
`style1-intro.xhtml`: 样式一简介页骨架。
`style1-volume.xhtml`: 样式一分卷页骨架。
`style1-chapter.xhtml`: 样式一正文章页骨架。
`style2.css`: 样式二参考 EPUB 同值排版规则，保留独立背景并使用单一分卷图和单一章头图。
`style2-title.xhtml`: 样式二标题页骨架，不包含固定标志。
`style2-colophon.xhtml`: 样式二制作说明页骨架，不包含注记图。
`style2-intro.xhtml`: 样式二书籍信息与简介页骨架。
`style2-volume.xhtml`: 样式二统一分卷图骨架。
`style2-chapter.xhtml`: 样式二统一章头图与正文骨架。
`style3.css`: 样式三参考 EPUB 同值排版规则，覆盖完整原版字体、正文/引用/脚注、轻灰说明框、下划线分卷与居中章题。
`style3-colophon.xhtml`: 样式三制作说明页骨架。
`style3-intro.xhtml`: 样式三复用参考 EPUB 版权信息框结构的简介页骨架。
`style3-volume.xhtml`: 样式三使用参考 EPUB 左对齐粗宋标题与底部横线的纯排版分卷页骨架。
`style3-chapter.xhtml`: 样式三使用参考 EPUB 居中粗宋标题的正文章页骨架。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
