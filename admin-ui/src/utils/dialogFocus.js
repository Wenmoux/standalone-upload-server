/**
 * [INPUT]: 依赖 Vue 的 nextTick/onBeforeUnmount/ref/watch 与浏览器焦点 API
 * [OUTPUT]: 对外提供 useDialogFocus，统一弹窗首焦点、Tab 焦点闭环和关闭后焦点恢复
 * [POS]: admin-ui/src/utils 的无障碍交互基础设施，被表单与确认弹窗复用以避免各自实现焦点协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function useDialogFocus(openSource, { initialSelector = "" } = {}) {
  const dialogRef = ref(null);
  let returnFocus = null;

  function focusableElements() {
    return [...(dialogRef.value?.querySelectorAll(FOCUSABLE_SELECTOR) || [])]
      .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
  }

  function handleDialogKeydown(event) {
    if (event.key !== "Tab") return;
    const elements = focusableElements();
    if (!elements.length) {
      event.preventDefault();
      dialogRef.value?.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function restoreFocus() {
    if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
  }

  watch(
    openSource,
    async (open, wasOpen) => {
      if (open) {
        returnFocus = document.activeElement;
        await nextTick();
        const preferred = initialSelector ? dialogRef.value?.querySelector(initialSelector) : null;
        (preferred || focusableElements()[0] || dialogRef.value)?.focus();
      } else if (wasOpen) {
        await nextTick();
        restoreFocus();
      }
    },
    { flush: "post" }
  );

  onBeforeUnmount(restoreFocus);

  return { dialogRef, handleDialogKeydown };
}
