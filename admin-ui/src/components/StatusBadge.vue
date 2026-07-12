<template>
  <span class="tag" :class="tone">{{ label }}</span>
</template>

<script setup>
/**
 * [INPUT]: 依赖状态标签与 tone 视觉语义 props
 * [OUTPUT]: 提供轻量状态徽标组件
 * [POS]: admin-ui/src/components 的状态表达原语，由领域视图负责业务状态到 tone 的映射
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
defineProps({
  label: { type: String, required: true },
  tone: { type: String, default: "" }
});
</script>
