export function number(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString("zh-CN") : "0";
}

export function bytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function percent(value, total) {
  const base = Number(total || 0);
  if (!base) return "0%";
  return `${Math.round((Number(value || 0) / base) * 100)}%`;
}

export function time(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function dateOnly(value) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function uptime(seconds) {
  const total = Number(seconds || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}天${hours}时`;
  if (hours) return `${hours}时${minutes}分`;
  return `${minutes}分`;
}

export function currencyLabel(currency) {
  if (currency === "silver") return "银币";
  if (currency === "exp") return "经验";
  return "铜币";
}

export function durationLabel(row) {
  if (!row) return "-";
  if (row.duration_type === "permanent") return "永久";
  return `${number(row.duration_days)} 天`;
}

export function splitTags(tags) {
  return String(tags || "")
    .split(/[,\s，、|/]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function readerUrl() {
  const url = new URL(window.location.href);
  url.port = "3200";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function platformSummary(platforms = []) {
  if (!Array.isArray(platforms) || platforms.length === 0) return "暂无站别";
  return platforms.map((item) => `${item.platform || "未知"} ${number(item.count)}`).join(" / ");
}
