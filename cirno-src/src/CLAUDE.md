# cirno-src/src/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Reader 浏览器应用的可执行语义层。`main.js` 装配路由、状态、HTTP 适配器、性能上报与 PWA；视图负责页面级编排，组件处理阅读局部交互，mixins 拆分正文阅读的纠错/导航/TTS 状态机，utils 承载可独立验证的纯能力与浏览器持久化边界。

## 成员清单

`App.vue`: Reader 路由出口和根容器，只承载页面切换所需的应用外壳。
`main.js`: Vue 启动入口，安装 Router、Vuex、Ant Design、HTTP 适配器、性能采集与 PWA 同步。
`assets/cirno.png`: About 页保留的历史项目标识图片。
`assets/d_avatar.jpg`: 未设置用户头像时的本地默认头像。
`assets/logo.png`: Reader 品牌视觉资源，由页面按需消费。
`assets/reader-crane-header.png`: 正文鹤影章头的内置回退图片。
`assets/reader-jianghu-top.png`: 正文江湖章头的内置回退图片。
`assets/side.png`: 登录页侧栏插图。
`assets/icons/po18-icons.css`: Reader 图标字体类名与字形映射。
`assets/icons/po18-icons.woff2`: `po18-icons.css` 引用的本地图标字体二进制。
`components/catalog.vue`: 阅读目录抽屉，过滤分卷节点并借助虚拟列表定位、选择可读章节。
`components/paragraph.vue`: 正文段落渲染器，按段落类型输出净化后的文本、链接或图片节点。
`components/picture.vue`: 独立图片段落组件，对外部图片 URL 进行净化后渲染。
`components/tickets.vue`: 阅读页票券/打赏交互弹窗，使用 Vuex 读者与作品上下文提交动作。
`components/tsukkomi.vue`: 章节间贴展示与发布弹窗，封装滚动区域和服务端交互状态。
`components/user-card.vue`: 保留的用户卡片扩展位；当前只提供稳定组件边界，不承载业务数据。
`components/virtual-list.vue`: 通用定高虚拟列表视口，把滚动位置转换为窗口项并暴露行插槽。
`mixins/reader-correction.js`: Reader 纠错状态机，管理选区、等长约束、提交表单和错误反馈。
`mixins/reader-navigation.js`: Reader 章节导航状态机，识别分卷、计算可读章节并统一前后章跳转。
`mixins/reader-tts.js`: Reader TTS 状态机，编排浏览器、Edge、云端与自定义引擎的队列、请求和播放生命周期。
`plugins/ant-design-vue.js`: Ant Design Vue 按需异步组件安装器，降低 Reader 初始包体。
`plugins/http.js`: Reader HTTP 兼容适配器，统一会话刷新、API 请求、离线章节回退和旧调用接口。
`router/index.js`: Hash 路由与 Reader 会话门禁，兼容裸路径进入并延迟加载页面。
`store/index.js`: 最小 Vuex 共享状态，保存 API 基址、作品信息和 Reader 用户信息供旧组件消费。
`styles/search-modal-fix.css`: 搜索弹窗在移动端与 Ant Design 组合下的全局布局修正。
`utils/chinese-convert.js`: OpenCC 加项目补充字表的繁简转换内核，输出双向映射和统一转换函数。
`utils/platform.js`: 平台标签缓存与 `/reader-api/platforms` 加载边界，为检索和详情提供一致显示名。
`utils/reader-content.js`: 正文规范化工具，净化/解析话本 HTML、图片段落和转换前后文本。
`utils/reader-offline.js`: 账号隔离的 IndexedDB 章节缓存与进度队列，提供内存后端以支持降级和测试。
`utils/reader-performance.js`: Reader RUM 采集器，将路由耗时、错误和批量性能样本发送到受控端点。
`utils/reader-pwa.js`: Service Worker 注册与联网后离线进度同步协调器。
`utils/reader-session.js`: Reader Cookie 会话缓存与失效协调器，联动离线进度刷新和账号切换清理。
`utils/reader-settings.js`: 阅读设置默认值、主题/字体/TTS 选项以及输入归一化规则。
`utils/reader-theme.js`: 阅读主题调色板和 CSS 变量投影，把持久化设置转换为页面样式。
`utils/reader-tts.js`: TTS 纯工具层，拆分文本、渲染模板、解析响应头/JSON 并生成音频源。
`utils/sanitize-html.js`: DOMPurify 正文白名单与图片 URL 协议校验，是不可信内容进入 DOM 前的安全边界。
`utils/search-intent.js`: 搜索语法解析器，把作者/标签/书名意图转换为服务端查询参数。
`utils/virtual-list.js`: 定高虚拟列表窗口范围纯算法，被目录与详情页复用。
`views/About.vue`: Reader 项目说明页，提供应用内导航和名称来源信息。
`views/BookDetail.vue`: 书籍详情编排页，加载元数据、目录、书架状态、书评与举报操作并进入阅读。
`views/BookLibrary.vue`: 全库浏览页，组合检索意图、平台配置、主题与分页结果。
`views/Index.vue`: 登录后的首页/个人书架，承载搜索建议、平台筛选、最近内容和详情导航。
`views/Login.vue`: Reader 本地/CDK 注册登录与 Telegram 登录入口，成功后建立会话缓存并跳转首页。
`views/Reader.vue`: 正文阅读组合根，装配段落/目录/图片/间贴/票券组件以及纠错、导航、TTS mixins 和离线能力。
`views/Settings.vue`: 当前 Reader 账号与本地设置页，维护资料、退出会话并清理对应离线数据。

## 依赖方向

```text
views -> components + mixins -> utils
  |             |              |
  +---------- plugins/http ----+-> /reader-auth + /reader-api
main -> router + store + plugins + PWA/RUM
```

- `plugins/http.js` 是网络兼容层，业务页面不得新增裸露的第二套鉴权策略；少量原生 fetch 也必须保持同源凭证和会话语义。
- 不可信正文必须先经过 `sanitize-html.js`；离线数据必须以 Reader 用户 ID 隔离。
- `Reader.vue` 已超过重构阈值，新阅读能力优先进入既有 mixin、component 或 util，而非继续扩大组合根。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
