<template>
  <article class="stat">
    <span>{{ label }}</span>
    <strong>{{ value }}</strong>
    <div v-if="$slots.default" class="stat-extra"><slot /></div>
    <small v-else-if="hint" class="stat-extra">{{ hint }}</small>
  </article>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: 0 },
  hint: { type: String, default: "" }
});
</script>
