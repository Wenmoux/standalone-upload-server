/**
 * [INPUT]: 依赖 Vue、App、Router、Vuex、UI/HTTP 插件、Reader RUM/PWA 工具与全局样式
 * [OUTPUT]: 创建并挂载完整 Reader 应用，安装性能采集和离线进度同步生命周期
 * [POS]: cirno-src/src 的浏览器启动入口，只装配基础设施，不实现页面领域逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store'
import installAntDesign from './plugins/ant-design-vue.js'
import cirnoHttp from './plugins/http'
import { installReaderPerformance } from './utils/reader-performance'
import { registerReaderPwa } from './utils/reader-pwa'

import './styles/search-modal-fix.css'
import './assets/icons/po18-icons.css'

const app = createApp(App)
installReaderPerformance(router)

app.use(router)
app.use(store)
app.use(installAntDesign)
app.use(cirnoHttp)
app.mount('#app')
registerReaderPwa()
