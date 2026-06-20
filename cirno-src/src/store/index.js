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
