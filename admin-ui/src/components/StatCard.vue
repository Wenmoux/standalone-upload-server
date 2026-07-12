<template>
  <article class="stat">
    <span>{{ label }}</span>
    <strong>{{ value }}</strong>
    <div v-if="$slots.default" class="stat-extra"><slot /></div>
    <small v-else-if="hint" class="stat-extra">{{ hint }}</small>
  </article>
</template>

<script setup>
/**
 * [INPUT]: 依赖指标标签、值、提示等 props 与可选扩展插槽
 * [OUTPUT]: 提供语义稳定的单指标卡片组件
 * [POS]: admin-ui/src/components 的仪表盘展示原语，被总览和运维页面复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: 0 },
  hint: { type: String, default: "" }
});
</script>
