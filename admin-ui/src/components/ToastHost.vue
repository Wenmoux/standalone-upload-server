<template>
  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    <transition-group name="toast">
      <div v-for="item in items" :key="item.id" class="toast" :class="`toast-${item.tone || 'info'}`" role="status">
        <span>{{ item.message }}</span>
        <button type="button" aria-label="关闭提示" @click="$emit('dismiss', item.id)">×</button>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
/**
 * [INPUT]: 依赖 App 提供的消息队列、语义 tone 与 Vue transition
 * [OUTPUT]: 提供可关闭、可朗读且不会互相覆盖的应用级 Toast 消息出口
 * [POS]: admin-ui/src/components 的全局反馈叶节点，按队列稳定呈现并把关闭意图交回 App
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
defineProps({
  items: { type: Array, default: () => [] }
});

defineEmits(["dismiss"]);
</script>
