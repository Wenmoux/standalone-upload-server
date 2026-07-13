# 江湖纸卷参考解析

参考来源：用户提供的 EPUB。

## 原 EPUB 结构

- EPUB 2.0，spine 共 603 页。
- 1 个封面页。
- 1 个排版说明页。
- 1 个作品简介页。
- 12 个分卷页。
- 正文章和完本感言使用普通 XHTML 页面。
- 主样式：`Styles/main.css`。
- 字体声明：`Styles/fonts.css`。

## 原资源

| 资源 | 尺寸/大小 | 用途 |
| --- | --- | --- |
| `cover.jpg` | 1800×2400，约 3.0 MiB | EPUB 封面 |
| `cover~slim.jpg` | 1080×2400，约 2.1 MiB | 窄版封面备用 |
| `topimg.png` | 1200×800，约 273 KiB | 分卷和章节顶部透明人物图 |
| `Asheng.ttf` | 约 3.7 KiB | 排版说明图标子集 |
| `FZLanTYKXian.ttf` | 约 57 KiB | 小号章节序号与说明文字子集 |
| `SourceHanSerifSC-Bold.otf` | 约 562 KiB | 红色分卷和章节标题子集 |
| `STKaiti.ttf` | 约 14 KiB | 简介楷体子集 |

这些字体是针对原书裁剪的字形子集，不能保证覆盖其他书名、作者、简介和章节标题，因此江湖纸卷没有直接复制字体文件，而是使用系统宋体、楷体和黑体回退链。

## 页面模板

### 封面

- XHTML 内使用 `svg > image`。
- `viewBox` 使用封面原始宽高。
- `preserveAspectRatio="xMidYMid meet"`，避免裁切。

### 制作说明

- 外层 `.design-box`，顶部约 20% 留白。
- 2px 半透明浅色边框、7px 圆角、半透明浅底。
- 标题 `.design-title` 居中灰色。
- 正文 `.design-content` 不缩进，橙色图标开头，段落间使用虚线。

### 作品简介

- `.introduction-title` 上下各约 3em 留白，居中粗宋体。
- `.intro-text` 使用楷体，不缩进，紫色文字和轻微浅底。

### 分卷

- 顶部使用 `.top-img-box > .top-img`。
- `.volume-sequence-number` 为单字宽红框，卷号竖排。
- `.volume-title` 将卷名逐字换行，红色粗宋体。

### 章节和正文

- 顶部复用透明人物头图。
- `.chapter-sequence-number` 为小号灰色黑体。
- `.chapter-title` 为居中红色粗宋体。
- 正文使用宋体、两字符缩进、两端对齐、1.4em 行高。

## 项目适配

- 样式 ID 固定为 `style1`，展示名为“江湖纸卷”。
- `topimg.png` 作为内置资源写入 EPUB；后台可关闭头图。
- 头图容器增加 `42em` 最大宽度，避免桌面宽屏把标题推到首屏之外；窄屏仍为 100% 宽度。
- 制作说明改为项目通用文字，可在后台编辑或关闭。
- 封面继续使用书籍元信息中的 `cover`，不会套用参考书封面；按该参考书的双封面结构自动生成 `cover~slim.png`，但不继承《家弑服务》样式三专属的全屏 spine 与 Apple 显示声明。
- 网页 Reader 只复用暖纸配色、头图和章头，不生成封面、制作说明、简介或分卷独立页面。
