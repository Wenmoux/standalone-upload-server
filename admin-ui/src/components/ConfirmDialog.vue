<template>
  <div v-if="open" class="modal confirm-modal" role="dialog" aria-modal="true" @keydown.esc.prevent="cancel">
    <section class="modal-card confirm-card">
      <header class="modal-head">
        <div>
          <span class="confirm-eyebrow">高风险操作</span>
          <h3>{{ title }}</h3>
        </div>
        <button class="secondary" type="button" :disabled="busy" @click="cancel">关闭</button>
      </header>
      <div class="modal-body confirm-body">
        <p class="confirm-message">{{ message }}</p>
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
 * [INPUT]: 依赖 Vue 响应式能力以及标题、正文、风险级别和原因要求等 props
 * [OUTPUT]: 提供带焦点管理的确认/取消对话框，并向调用方回传确认原因
 * [POS]: admin-ui/src/components 的高风险操作门禁，由 App 全局确认服务统一驱动
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { computed, nextTick, ref, watch } from "vue";

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
  async (open) => {
    if (!open) return;
    reason.value = "";
    phraseInput.value = "";
    await nextTick();
    document.querySelector(".confirm-card textarea, .confirm-card input")?.focus();
  }
);
</script>
