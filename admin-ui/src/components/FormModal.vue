<template>
  <div v-if="open" class="modal" @click.self="handleBackdropClick" @keydown.esc.prevent="requestClose">
    <section class="modal-card">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="secondary" type="button" @click="requestClose">关闭</button>
      </header>
      <div class="modal-body">
        <div class="form-grid">
          <label v-for="field in fields" :key="field.key" class="field">
            <span>{{ field.label }}</span>
            <input
              v-model="draft[field.key]"
              :type="field.type || 'text'"
              :placeholder="field.placeholder || ''"
              :disabled="field.disabled"
            />
          </label>
        </div>
        <label v-for="field in textareaFields" :key="field.key" class="field field-wide">
          <span>{{ field.label }}</span>
          <textarea v-model="draft[field.key]" :rows="field.rows || 8" :placeholder="field.placeholder || ''"></textarea>
        </label>
        <label v-for="field in checks" :key="field.key" class="check-row">
          <input v-model="draft[field.key]" type="checkbox" />
          <span>{{ field.label }}</span>
        </label>
      </div>
      <footer class="modal-actions">
        <button class="secondary" type="button" @click="requestClose">取消</button>
        <button type="button" @click="$emit('save', { ...draft })">{{ saveLabel }}</button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { computed, inject, reactive, ref, watch } from "vue";

const props = defineProps({
  open: Boolean,
  title: { type: String, default: "" },
  model: { type: Object, default: () => ({}) },
  fields: { type: Array, default: () => [] },
  textareaFields: { type: Array, default: () => [] },
  checks: { type: Array, default: () => [] },
  saveLabel: { type: String, default: "保存" },
  closeOnBackdrop: { type: Boolean, default: false }
});

const emit = defineEmits(["close", "save"]);

const draft = reactive({});
const initialSnapshot = ref("{}");
const confirmAction = inject("confirmAction", async () => ({ confirmed: false }));
const dirty = computed(() => JSON.stringify(draft) !== initialSnapshot.value);

function handleBackdropClick() {
  if (props.closeOnBackdrop) requestClose();
}

async function requestClose() {
  if (dirty.value) {
    const confirmation = await confirmAction({
      title: "放弃未保存修改",
      message: "当前表单还有未保存内容，关闭后这些修改会丢失。",
      confirmLabel: "放弃修改",
      requireReason: false
    });
    if (!confirmation.confirmed) return;
  }
  emit("close");
}

watch(
  () => [props.open, props.model],
  () => {
    Object.keys(draft).forEach((key) => delete draft[key]);
    Object.assign(draft, props.model || {});
    initialSnapshot.value = JSON.stringify(draft);
  },
  { immediate: true, deep: true }
);
</script>
