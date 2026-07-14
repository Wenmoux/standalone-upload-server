<template>
  <div v-if="open" class="modal confirm-modal" @keydown.esc.prevent="cancel">
    <section
      ref="dialogRef"
      class="modal-card confirm-card"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="messageId"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <header class="modal-head">
        <div>
          <span class="confirm-eyebrow">高风险操作</span>
          <h3 :id="titleId">{{ title }}</h3>
        </div>
        <button class="secondary" type="button" :disabled="busy" aria-label="关闭确认弹窗" @click="cancel">关闭</button>
      </header>
      <div class="modal-body confirm-body">
        <p :id="messageId" class="confirm-message">{{ message }}</p>
        <label v-if="requireReason" class="field field-wide">
          <span>操作原因</span>
          <textarea v-model.trim="reason" rows="3" maxlength="500" placeholder="说明本次操作原因，便于后续审计"></textarea>
          <small>{{ reason.length }}/500，至少 {{ minimumReasonLength }} 个字</small>
        </label>
        <label v-if="phrase" class="field field-wide">
          <span>输入确认短语</span>
          <code class="confirm-phrase">{{ phrase }}</code>
          <input v-model="phraseInput" autocomplete="off" :placeholder="phrase" />
        </label>
      </div>
      <footer class="modal-actions">
        <button class="secondary" type="button" :disabled="busy" @click="cancel">取消</button>
        <button class="danger" type="button" :disabled="!canConfirm || busy" @click="confirm">
          {{ busy ? "处理中..." : confirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup>
/**
 * [INPUT]: 依赖 Vue、useDialogFocus 以及标题、正文、确认短语和原因要求等 props
 * [OUTPUT]: 提供 alertdialog 语义、焦点闭环/恢复、提交锁定并向调用方回传确认原因
 * [POS]: admin-ui/src/components 的高风险操作门禁，由 App 全局确认服务统一驱动并阻止误操作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, ref, watch } from "vue";
import { useDialogFocus } from "../utils/dialogFocus";

const props = defineProps({
  open: Boolean,
  title: { type: String, default: "确认操作" },
  message: { type: String, default: "该操作可能影响现有数据。" },
  confirmLabel: { type: String, default: "确认执行" },
  requireReason: { type: Boolean, default: true },
  minimumReasonLength: { type: Number, default: 2 },
  phrase: { type: String, default: "" },
  busy: Boolean
});

const emit = defineEmits(["cancel", "confirm"]);
const reason = ref("");
const phraseInput = ref("");
const dialogId = `confirm-dialog-${Math.random().toString(36).slice(2, 10)}`;
const titleId = `${dialogId}-title`;
const messageId = `${dialogId}-message`;
const { dialogRef, handleDialogKeydown } = useDialogFocus(
  () => props.open,
  { initialSelector: "textarea:not([disabled]), input:not([disabled]), .danger:not([disabled])" }
);
const canConfirm = computed(() => {
  if (props.requireReason && reason.value.trim().length < props.minimumReasonLength) return false;
  if (props.phrase && phraseInput.value !== props.phrase) return false;
  return true;
});

function cancel() {
  if (!props.busy) emit("cancel");
}

function confirm() {
  if (canConfirm.value && !props.busy) emit("confirm", { reason: reason.value.trim() });
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reason.value = "";
    phraseInput.value = "";
  }
);
</script>
