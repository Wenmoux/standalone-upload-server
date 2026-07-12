<!--
 * [INPUT]: 依赖 Vue Router 与 Reader 全局样式/路由状态
 * [OUTPUT]: 对外提供 Reader 根应用外壳与 router-view
 * [POS]: cirno-src/src 的页面出口，只承载路由切换所需根容器
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
<template>
  <div id="app">
    <router-view />
  </div>
</template>

<script>
export default {
  name: 'app',
  data() {
    return {}
  },
  components: {},
  created() {
    if (!localStorage.getItem('baseUrl')) {
      localStorage.setItem('baseUrl', '')
    }
  },
  methods: {}
}
</script>

<style>
#app {
  font-family: Avenir, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei,
    Helvetica Neue, Helvetica, Arial, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
  width: 100%;
  height: 100%;
}
</style>
