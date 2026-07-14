<template>
  <div v-if="open" class="modal" @click.self="handleBackdropClick" @keydown.esc.prevent="requestClose">
    <section
      ref="dialogRef"
      class="modal-card"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="error ? errorId : undefined"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <header class="modal-head">
        <h3 :id="titleId">{{ title }}</h3>
        <button class="secondary" type="button" :disabled="busy" aria-label="关闭弹窗" @click="requestClose">关闭</button>
      </header>
      <div class="modal-body">
        <div class="form-grid">
          <label v-for="field in fields" :key="field.key" class="field">
            <span>{{ field.label }}</span>
            <input
              v-model="draft[field.key]"
              :type="field.type || 'text'"
              :placeholder="field.placeholder || ''"
              :disabled="field.disabled || busy"
            />
          </label>
        </div>
        <label v-for="field in textareaFields" :key="field.key" class="field field-wide">
          <span>{{ field.label }}</span>
          <textarea v-model="draft[field.key]" :rows="field.rows || 8" :placeholder="field.placeholder || ''" :disabled="busy"></textarea>
        </label>
        <label v-for="field in checks" :key="field.key" class="check-row">
          <input v-model="draft[field.key]" type="checkbox" :disabled="busy" />
          <span>{{ field.label }}</span>
        </label>
      </div>
      <p v-if="error" :id="errorId" class="modal-error" role="alert">{{ error }}</p>
      <slot name="feedback"></slot>
      <footer class="modal-actions">
        <button class="secondary" type="button" :disabled="busy" @click="requestClose">取消</button>
        <button type="button" :disabled="busy" @click="$emit('save', { ...draft })">{{ busy ? busyLabel : saveLabel }}</button>
      </footer>
    </section>
  </div>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、useDialogFocus、弹窗开关、字段模型、提交状态与全局确认上下文
 * [OUTPUT]: 提供脏数据关闭门禁、焦点闭环/恢复、提交锁定和内联错误呈现的表单弹窗
 * [POS]: admin-ui/src/components 的表单容器，为书籍、用户和反馈编辑流程统一可访问交互协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, inject, reactive, ref, watch } from "vue";
import { useDialogFocus } from "../utils/dialogFocus";

const props = defineProps({
  open: Boolean,
  title: { type: String, default: "" },
  model: { type: Object, default: () => ({}) },
  fields: { type: Array, default: () => [] },
  textareaFields: { type: Array, default: () => [] },
  checks: { type: Array, default: () => [] },
  saveLabel: { type: String, default: "保存" },
  busyLabel: { type: String, default: "保存中..." },
  busy: Boolean,
  error: { type: String, default: "" },
  closeOnBackdrop: { type: Boolean, default: false }
});

const emit = defineEmits(["close", "save"]);

const draft = reactive({});
const initialSnapshot = ref("{}");
const confirmAction = inject("confirmAction", async () => ({ confirmed: false }));
const dirty = computed(() => JSON.stringify(draft) !== initialSnapshot.value);
const dialogId = `form-dialog-${Math.random().toString(36).slice(2, 10)}`;
const titleId = `${dialogId}-title`;
const errorId = `${dialogId}-error`;
const { dialogRef, handleDialogKeydown } = useDialogFocus(() => props.open, { initialSelector: "input:not([disabled]), select:not([disabled]), textarea:not([disabled])" });

function handleBackdropClick() {
  if (props.closeOnBackdrop) requestClose();
}

async function requestClose() {
  if (props.busy) return;
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
