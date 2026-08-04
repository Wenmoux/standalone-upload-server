/**
 * [INPUT]: 依赖 Node path、services/epub-component-library 的知识库组件 CSS/卷章渲染器、云纹图、项目楷体与规范化后的 studio 配置
 * [OUTPUT]: 对外提供 studio 模板工坊插件，支持带条件云纹资源的章题、分卷、简介和装饰组件自由组合
 * [POS]: epub-styles 的组件化视觉插件，把知识库可复用片段接入统一 EPUB 2 容器而不复制打包逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require("path");
const {
    buildStudioCss,
    renderStudioChapter,
    renderStudioIntro,
    renderStudioVolume
} = require("../../services/epub-component-library");

module.exports = {
    id: "studio",
    name: "模板工坊",
    description: "自由组合知识库提炼的章题、分卷、简介和装饰组件。",
    nestedVolumeToc: true,
    useSlimCover: true,
    assets: [
        {
            id: "studio-cloud",
            name: "Images/studio-cloud.png",
            mediaType: "image/png",
            paths: [path.resolve(__dirname, "assets/studio-cloud.png")],
            when: (config) => config.studio.chapter === "yunwen"
        },
        {
            id: "studio-stkaiti",
            name: "Fonts/studio-stkaiti.ttf",
            mediaType: "application/x-font-ttf",
            paths: [path.resolve(__dirname, "assets/style3-stkaiti.ttf")]
        }
    ],
    css(config) {
        return buildStudioCss(config.studio);
    },
    renderColophon(context) {
        return renderStudioIntro(context, context.config.colophonTitle, context.config.colophonText);
    },
    renderIntro(context) {
        return renderStudioIntro(context, context.config.introTitle, context.descriptionText);
    },
    renderVolume: renderStudioVolume,
    renderChapter: renderStudioChapter
};
