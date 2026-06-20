<template>
  <article class="stat">
    <span>{{ label }}</span>
    <strong>{{ value }}</strong>
    <small v-if="$slots.default"><slot /></small>
    <small v-else-if="hint">{{ hint }}</small>
  </article>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: 0 },
  hint: { type: String, default: "" }
});
</script>
