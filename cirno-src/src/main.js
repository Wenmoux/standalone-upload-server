import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store'
import installAntDesign from './plugins/ant-design-vue.js'
import cirnoHttp from './plugins/http'

import './styles/search-modal-fix.css'
import 'remixicon/fonts/remixicon.css'

const app = createApp(App)

app.use(router)
app.use(store)
app.use(installAntDesign)
app.use(cirnoHttp)
app.mount('#app')
