/**
 * [INPUT]: 依赖浏览器 Clipboard API，并在权限受限时回退到临时 textarea 选区复制
 * [OUTPUT]: 对外提供 copyText，返回文本是否成功写入系统剪贴板
 * [POS]: admin-ui/src/utils 的浏览器能力适配层，避免领域视图用阻塞式 prompt 承担复制兜底
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export async function copyText(value) {
  const text = String(value ?? "");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      textarea.remove();
    }
    return copied;
  }
}
