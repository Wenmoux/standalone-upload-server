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
