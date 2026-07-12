<!--
 * [INPUT]: 依赖 父视图提供的用户展示上下文
 * [OUTPUT]: 对外提供 UserCard 稳定展示扩展位
 * [POS]: Reader components 的保留用户卡片边界，当前不承载领域写入
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
<template>
  <div class="user-card"></div>
</template>

<script>
export default {
  name: 'UserCard'
}
</script>

<style lang="less" scoped>
.user-card {
  width: 278px;
  height: 210px;
  background: #66ccff;
}
</style>
