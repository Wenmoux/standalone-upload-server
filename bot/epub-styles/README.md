# EPUB 内置样式

EPUB 生成器把通用的封装、目录、资源和 EPUB 2 文件结构留在 `epub-builder.js`，本目录只负责可替换的视觉样式与页面模板。样式注册以 `index.js` 和 `services/epub-style-config.js` 为准，Bot 交互入口以 `epub-style-picker.js` 为准。

## 已注册样式

| ID | 名称 | 版式定位 | Bot 直选按钮 |
| --- | --- | --- | --- |
| `style1` | 江湖纸卷 | 纯白阅读底、原版字体、红黑章头、人物头图、竖排分卷与独立制作说明 | 是 |
| `style2` | 老二次元 | 插画标题页、制作说明、书籍信息、统一分卷图与统一正文章头 | 是 |
| `style3` | 疏影横斜 | 原版字体、浅灰说明框、全屏留白分部底图与居中数字章题 | 是 |
| `crane` | 仙鹤章头 | 仙鹤头图、深色圆角标题条与旧版页面结构 | 否，仅兼容旧配置 |

“疏影横斜”取自林逋《山园小梅》“疏影横斜水清浅”，保留古典气息而不把固定诗句写进正文模板。

分卷页不是默认正文：生成器只在源章节中识别到非空真实分卷记录时调用 `renderVolume`。书籍没有分卷数据就不会插入“正文”或其他占位分卷。“疏影横斜”的真实分卷页写入 `duokan-page-fullscreen` spine 属性、独立全屏 XHTML/SVG 和二级 NCX 目录，所以支持该扩展的阅读器不会把它当普通正文流排版。

样式一和样式三各自的模板都包含原图/长屏双封面语义，因此这两种样式保留原图作为书库缩略图，同时生成 `1080×2400` 的 `cover~slim.png`：模糊延展背景承接长屏空白，前景完整保留原封面。只有样式三额外声明封面 `duokan-page-fullscreen` 与 Apple 显示选项；样式二遵循自己的标题页结构，不生成可见封面页或无用长屏资源。渲染失败时安全回退到原图。

三个样式的完整 CSS 与制作说明、简介、分卷、正文 XHTML 骨架都存放在 `assets/epub-templates/`。运行代码只按 `style1/style2/style3` 读取文件并注入当前书籍数据，模板与文档不保存对应样例的书名或正文。

网页 Reader 只复用 `style1` 的主题与章头能力，不生成 EPUB 的封面、制作说明、简介或分卷页面。

## 样式模块契约

每个 `style-*.js` 导出一个样式对象：

- 必填元数据：唯一 `id`、后台显示的 `name`、简短 `description`。
- 必填渲染能力：`css`（字符串或接收配置的函数）、`renderIntro`、`renderVolume`、`renderChapter`。
- 可选页面：`renderTitlePage`、`renderColophon`；只有实现并启用相应配置时才写入 EPUB。
- 可选结构开关：`skipVisibleCoverPage`、`useSlimCover`、`includeAppleDisplayOptions`、`coverPageNavTitle`、`coverPageSpineProperties`、`titlePageNavTitle`、`nestedVolumeToc`、`volumePageSpineProperties`、`volumeDocumentOptions`。
- 可选 `assets`：每项声明 EPUB 内部 `name`、`mediaType`、本地候选 `paths`，并可用 `when(config)` 控制是否嵌入。模板必须通过 `hasAsset(name)` 判断资源是否真正可用。
- 所有动态书名、作者、简介、卷名和章名必须使用生成器提供的转义/段落工具，不得直接拼接未转义用户文本。

生成器负责封面下载、XHTML 包装、manifest/spine/nav、资源去重与 ZIP；样式模块不得各自实现第二套 EPUB 打包流程。

## 添加或调整样式

1. 新建样式模块并满足上述契约。
2. 在 `index.js` 注册实现，在 `services/epub-style-config.js` 的 `EPUB_STYLE_OPTIONS` 注册管理端元数据。
3. 如果需要 Telegram 用户直接选择，再把 ID 加入 `bot/epub-style-picker.js`；仅注册到生成器不会自动出现 Bot 按钮。
4. 若 Admin 需要实时预览，同步对应预览页面、CSS 和图片配置；预览必须与导出模板同源或有一致性测试。
5. 在 `tests/epub-builder.test.js` 覆盖封面前置页、简介、制作说明、真实分卷、正文、目录层级和资源回退，并用 EPUBCheck 验证生成样例。
6. 依赖或导出变化后同步本目录 `CLAUDE.md` 和文件 L3 契约。

## 后台配置与资源

后台 TG Bot 页可设置默认样式、制作说明开关与文本、简介页标题、头图嵌入，以及老二次元的副标题、版本、来源、版权、阅读提示、字体族和追加 CSS。配置保存在 `admin_config.bot_epub_style_config`；Bot 开始导出时随既有 `/bot-api/export-pricing` 响应读取，不增加单独请求。

老二次元自定义图片存放在 `/config/epub-style2/`。标题页标志和太极注记已移除，正文章头固定使用一个资源槽，所有分卷固定使用另一个资源槽；旧 `chapter-1.asset` / `volume-1.asset` 会作为只读兼容候选继续生效。预览中的分卷标签只展示版式，实际导出仍严格依赖源书的真实分卷记录。

- `style1` 的头图与四个裁剪字体均直接来自参考 EPUB，并保留系统字体回退；简介严格不设置页面或段落背景色。子集未包含的动态字符由回退字体补齐。页面结构考据见 [`STYLE1_REFERENCE.md`](./STYLE1_REFERENCE.md)。
- `style2` 参考 EPUB 未内嵌完整字体，只声明 `DK-SONGTI`、`DK-HEITI`、`DK-KAITI` 等本地字体名；实现保留别名并提供系统字体回退。
- `style3` 打包参考 EPUB 的三种字体和三张已去除样例文字的分部装饰图；全屏 SVG 直接铺干净白底装饰，再叠加当前书籍的动态卷序、卷名与 Part 编号，不依赖阅读器支持 SVG 裁剪。制作说明的节点、20% 顶距、4px 浅灰边框、14px 圆角、60% 灰字和 10px 提示图均与参考文件一致。
- `crane` 读取旧仙鹤头图候选路径，保留是为了不破坏既有配置，不代表新增交互入口。
