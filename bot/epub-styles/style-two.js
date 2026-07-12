/**
 * [INPUT]: 依赖 services/epub-style2-template 提供的可配置 CSS、页面模板和图片槽位定义
 * [OUTPUT]: 对外提供 style2 老二次元插件元数据、资源声明及标题页到章页的完整渲染接口
 * [POS]: epub-styles 的插画型适配器，复用服务端预览与实际 EPUB 共享模板以保持两相一致
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const {
    STYLE2_ASSET_DEFINITIONS,
    buildStyle2Css,
    renderStyle2Chapter,
    renderStyle2Colophon,
    renderStyle2Intro,
    renderStyle2TitlePage,
    renderStyle2Volume,
    style2AssetPaths
} = require("../../services/epub-style2-template");

module.exports = {
    id: "style2",
    name: "老二次元",
    description: "1:1 复刻参考 EPUB 的插画标题页、制作说明、书籍信息、分卷图和正文章头。",
    skipVisibleCoverPage: true,
    titlePageNavTitle: "版权声明",
    nestedVolumeToc: true,
    css: buildStyle2Css,
    assets: STYLE2_ASSET_DEFINITIONS.map((asset) => ({
        id: `style2-${asset.slot}`,
        name: asset.name,
        mediaType: asset.mediaType,
        paths: style2AssetPaths(asset)
    })),
    renderTitlePage: renderStyle2TitlePage,
    renderColophon: renderStyle2Colophon,
    renderIntro: renderStyle2Intro,
    renderVolume: renderStyle2Volume,
    renderChapter: renderStyle2Chapter
};
