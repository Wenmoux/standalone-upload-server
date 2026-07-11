import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store'
import installAntDesign from './plugins/ant-design-vue.js'
import cirnoHttp from './plugins/http'
import { installReaderPerformance } from './utils/reader-performance'

import './styles/search-modal-fix.css'
import './assets/icons/po18-icons.css'

const app = createApp(App)
installReaderPerformance(router)

app.use(router)
app.use(store)
app.use(installAntDesign)
app.use(cirnoHttp)
app.mount('#app')
