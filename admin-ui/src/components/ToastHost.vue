<template>
  <transition name="toast">
    <div v-if="message" class="toast">{{ message }}</div>
  </transition>
</template>

<script setup>
defineProps({
  message: { type: String, default: "" }
});
</script>
