<template>
  <div v-if="open" class="modal input-modal" @keydown.esc.prevent="cancel">
    <section
      ref="dialogRef"
      class="modal-card input-card"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="message ? messageId : undefined"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <header class="modal-head">
        <h3 :id="titleId">{{ title }}</h3>
        <button class="secondary" type="button" :disabled="busy" aria-label="关闭输入弹窗" @click="cancel">关闭</button>
      </header>
      <div class="modal-body input-dialog-body">
        <p v-if="message" :id="messageId" class="input-dialog-message">{{ message }}</p>
        <label class="field field-wide">
          <span>{{ label }}</span>
          <select v-if="inputType === 'select'" v-model="draft" :disabled="busy">
            <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <textarea
            v-else-if="inputType === 'textarea'"
            v-model="draft"
            :rows="rows"
            :maxlength="maxlength"
            :placeholder="placeholder"
            :disabled="busy"
            @keydown.ctrl.enter.prevent="submit"
          ></textarea>
          <input
            v-else
            v-model="draft"
            :type="inputType"
            :maxlength="maxlength"
            :placeholder="placeholder"
            :disabled="busy"
            @keydown.enter.prevent="submit"
          />
          <small v-if="hint">{{ hint }}</small>
        </label>
      </div>
      <footer class="modal-actions">
        <button class="secondary" type="button" :disabled="busy" @click="cancel">取消</button>
        <button type="button" :disabled="!canSubmit || busy" @click="submit">{{ busy ? "处理中..." : confirmLabel }}</button>
      </footer>
    </section>
  </div>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、useDialogFocus 与 App 注入的单值输入任务配置
 * [OUTPUT]: 提供文本、长文本或枚举选择的可访问输入弹窗，并回传确认值或取消意图
 * [POS]: admin-ui/src/components 的轻量输入原语，替代浏览器阻塞式输入框并由 App 全局服务驱动
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, ref, watch } from "vue";
import { useDialogFocus } from "../utils/dialogFocus";

const props = defineProps({
  open: Boolean,
  title: { type: String, default: "请输入" },
  message: { type: String, default: "" },
  label: { type: String, default: "内容" },
  value: { type: [String, Number], default: "" },
  inputType: { type: String, default: "text" },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "" },
  hint: { type: String, default: "" },
  rows: { type: Number, default: 4 },
  maxlength: { type: Number, default: 500 },
  required: { type: Boolean, default: true },
  confirmLabel: { type: String, default: "确认" },
  busy: Boolean
});

const emit = defineEmits(["cancel", "confirm"]);
const draft = ref("");
const dialogId = `input-dialog-${Math.random().toString(36).slice(2, 10)}`;
const titleId = `${dialogId}-title`;
const messageId = `${dialogId}-message`;
const canSubmit = computed(() => !props.required || String(draft.value).trim().length > 0);
const { dialogRef, handleDialogKeydown } = useDialogFocus(
  () => props.open,
  { initialSelector: "select:not([disabled]), textarea:not([disabled]), input:not([disabled])" }
);

function cancel() {
  if (!props.busy) emit("cancel");
}

function submit() {
  if (canSubmit.value && !props.busy) emit("confirm", String(draft.value).trim());
}

watch(
  () => [props.open, props.value],
  ([open, value]) => {
    if (open) draft.value = value ?? "";
  },
  { immediate: true }
);
</script>
