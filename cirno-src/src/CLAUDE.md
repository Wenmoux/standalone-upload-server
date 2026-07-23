# cirno-src/src/

> L2 | 父级: [../CLAUDE.md](../CLAUDE.md)

Reader 浏览器应用的可执行语义层。`main.js` 装配路由、状态、HTTP 适配器、性能上报与 PWA；视图负责页面级编排，组件处理阅读局部交互，mixins 拆分正文阅读的章节/纠错/导航/设置/TTS 状态机，utils 承载可独立验证的纯能力与浏览器持久化边界。旧上游间贴、票券与站点购买没有服务端事实源，因此不进入当前 UI。

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
`components/reader-settings-panel.js`: 阅读设置面板控制器，声明只读输入并把表单、章头与 TTS 操作收敛为语义事件。
`components/reader-settings-panel.vue`: 阅读设置抽屉模板，只编排设置控件和预览，不持久化设置或控制朗读引擎。
`components/user-card.vue`: 保留的用户卡片扩展位；当前只提供稳定组件边界，不承载业务数据。
`components/virtual-list.vue`: 通用定高虚拟列表视口，把滚动位置转换为窗口项并暴露行插槽。
`mixins/reader-chapter.js`: Reader 章节数据状态机，集中书籍初始化、正文加载/解密与失败反馈、最近阅读和离线固定，并以请求世代阻止迟到章节或下一帧回调覆盖当前正文。
`mixins/reader-correction.js`: Reader 纠错状态机，管理选区、等长约束、提交表单和错误反馈。
`mixins/reader-navigation.js`: Reader 章节导航状态机，识别分卷、计算可读章节并统一前后章跳转。
`mixins/reader-settings.js`: Reader 阅读外观状态机，集中设置持久化、主题投影、章节头图与繁简显示重建；台湾词汇和用户词表变化经防抖后传入唯一转换内核。
`mixins/reader-tts.js`: Reader TTS 状态机，编排浏览器、Edge、云端与自定义引擎的队列、请求和播放生命周期。
`plugins/ant-design-vue.js`: Ant Design Vue 按需异步组件安装器，降低 Reader 初始包体。
`plugins/http.js`: Reader HTTP 兼容适配器，统一会话刷新、API 请求、离线章节回退和旧调用接口。
`router/index.js`: Hash 路由与 Reader 会话门禁，兼容裸路径进入并延迟加载页面。
`store/index.js`: 最小 Vuex 共享状态，保存 API 基址、作品信息和 Reader 用户信息供旧组件消费。
`styles/search-modal-fix.css`: 搜索弹窗在移动端与 Ant Design 组合下的全局布局修正。
`styles/book-detail.less`: 单书详情页的局部视觉边界，覆盖元信息、目录、书架、书评与窄屏状态。
`styles/book-library.less`: 全库发现页的局部视觉边界，覆盖筛选、书卡、分页与加载/空状态。
`styles/reader-home.less`: 登录后首页的局部视觉边界，覆盖导航、个人书架和搜索入口。
`styles/reader-settings-panel.less`: 阅读设置抽屉的局部视觉边界，覆盖桌面、平板和移动端表单布局。
`styles/reader.less`: 正文组合页的局部视觉边界，承载章头、控制栏、纠错和响应式阅读布局。
`utils/chinese-convert.js`: OpenCC 主导的繁简转换内核，以小型残留字表、上下文保护和碰撞安全的用户词表补足小说语义，同时保留双向转换。
`utils/platform.js`: 平台标签缓存与 `/reader-api/platforms` 加载边界，为检索和详情提供一致显示名。
`utils/reader-content.js`: 正文规范化工具，净化/解析话本 HTML 和图片段落，并把繁简模式、台湾词汇与用户词表透传给转换内核。
`utils/reader-offline.js`: 账号隔离的 IndexedDB 章节缓存与进度队列，提供内存后端以支持降级和测试。
`utils/reader-performance.js`: Reader RUM 采集器，将路由耗时、错误和批量性能样本发送到受控端点。
`utils/reader-pwa.js`: Service Worker 注册与联网后离线进度同步协调器。
`utils/reader-session.js`: Reader Cookie 会话缓存与失效协调器，联动离线进度刷新和账号切换清理。
`utils/reader-settings.js`: 阅读设置默认值、主题/字体/TTS 选项、繁简偏好及本地词表的输入归一化规则。
`utils/reader-theme.js`: 阅读主题调色板和 CSS 变量投影，把持久化设置转换为页面样式。
`utils/reader-tts.js`: TTS 纯工具层，拆分文本、渲染模板、解析响应头/JSON 并生成音频源。
`utils/sanitize-html.js`: DOMPurify 正文白名单与图片 URL 协议校验，是不可信内容进入 DOM 前的安全边界。
`utils/search-intent.js`: 搜索语法解析器，把作者/标签/书名意图转换为服务端查询参数。
`utils/virtual-list.js`: 定高虚拟列表窗口范围纯算法，被目录与详情页复用。
`views/About.vue`: Reader 项目说明页，提供应用内导航和名称来源信息。
`views/BookDetail.vue`: 书籍详情编排页，加载元数据、目录、书架状态和书评，以非阻塞受限表单提交举报并进入阅读；视觉规则由独立样式边界承载。
`views/BookLibrary.vue`: 全库浏览页，组合检索意图、平台配置、主题与分页结果；视觉规则由独立样式边界承载。
`views/Index.vue`: 登录后的首页/个人书架，承载搜索建议、平台筛选、最近内容和详情导航；视觉规则由独立样式边界承载。
`views/Login.vue`: Reader 本地/CDK 注册登录与 Telegram 登录入口，成功后建立会话缓存并跳转首页。
`views/Reader.vue`: 正文阅读组合根，只装配布局、段落/设置/目录/图片组件及章节、纠错、导航、设置、TTS 五个领域 mixin，不再直接持有章节加载、离线协议或大段局部样式。
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
- Reader 正文、详情、书库和首页组合视图均已回落到 800 行以内；新阅读能力仍须优先进入既有 mixin、component、style 或 util，保持页面根只做装配。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
