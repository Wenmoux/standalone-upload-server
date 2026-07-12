<template>
  <transition name="toast">
    <div v-if="message" class="toast">{{ message }}</div>
  </transition>
</template>

<script setup>
/**
 * [INPUT]: 依赖 App 提供的瞬时消息文本 prop 与 Vue transition
 * [OUTPUT]: 提供应用级 Toast 消息呈现出口
 * [POS]: admin-ui/src/components 的全局反馈叶节点，不持有消息队列和业务状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
defineProps({
  message: { type: String, default: "" }
});
</script>
