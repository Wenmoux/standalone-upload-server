/**
 * [INPUT]: 依赖 Vuex 并接收页面写入的 API 基址、作品信息与 Reader 用户信息
 * [OUTPUT]: 默认导出 Reader 最小共享 Store，提供对应 state、mutation 和 getter
 * [POS]: cirno-src/src/store 的旧组件兼容状态层，新领域状态优先留在拥有它的页面或工具中
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createStore } from 'vuex'

export default createStore({
  state: {
    baseUrl: '',
    prop_info: {},
    reader_info: {}
  },
  mutations: {
    setBaseUrl(state, url) {
      state.baseUrl = url
    },
    baseUrl(state, url) {
      state.baseUrl = url
    },
    setPropInfo(state, info) {
      state.prop_info = info
    },
    setReaderInfo(state, info) {
      state.reader_info = info
    }
  },
  actions: {},
  modules: {}
})
