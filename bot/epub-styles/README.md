# EPUB 内置样式

EPUB 生成器通过本目录注册样式，不再把所有 CSS 和页面模板堆在 `epub-builder.js`。

## 当前样式

- `style1`：样式一 · 江湖纸卷。参考用户提供 EPUB 的页面结构，包含暖纸底、制作说明、作品简介、圆形人物头图、竖排分卷、红黑章头和宋体正文。
- `crane`：原有仙鹤章头，保留旧导出外观作为兼容选项。

网页 Reader 只复用 `style1` 的暖纸主题与章头，不生成封面、制作说明、简介或分卷页面。

## 添加新样式

1. 新建 `style-*.js`，提供 `id`、`name`、`description`、`css`、`renderIntro`、`renderVolume` 和 `renderChapter`。
2. 可选提供 `renderColophon` 和 `assets`。资源声明包含 EPUB 内路径、媒体类型和本地回退路径。
3. 在 `index.js` 注册样式。
4. 在 `services/epub-style-config.js` 的 `EPUB_STYLE_OPTIONS` 增加后台显示信息。
5. 为封面前置页、分卷和正文模板补充 `tests/epub-builder.test.js` 断言，并用 EPUBCheck 验证样例。

## 后台配置

后台 TG Bot 页的“EPUB 内置样式”区域可设置：

- 默认样式。
- 是否生成制作说明。
- 制作说明标题和正文。
- 简介页标题。
- 是否嵌入样式头图。

配置保存到 `admin_config.bot_epub_style_config`。Bot 每次开始导出时从已有 `/bot-api/export-pricing` 响应读取配置，因此不增加额外请求。

## 资源说明

`style1` 头图来自用户提供的参考 EPUB。原书内嵌字体为裁剪子集，不适合任意书名和章节内容，因此没有直接复制；样式使用宋体、楷体、黑体的跨平台回退链，避免缺字。
