# ui/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

跨 Admin、Setup 与 EPUB 预览共享的视觉契约；EPUB Style1/3 因独立 Bot 镜像仍保留内嵌 CSS 镜像，测试必须证明它与本目录规范文件字节一致。

## 成员清单

- `design-tokens.css`: Admin 与 Setup 共用颜色、间距、圆角、阴影和排版令牌。
- `epub-style1.css`: 江湖纸卷规范 CSS；Admin 直接导入，Bot 内嵌镜像由严格相等测试约束。
- `epub-style3.css`: 疏影横斜规范 CSS；Admin 直接导入，Bot 内嵌镜像由严格相等测试约束。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
