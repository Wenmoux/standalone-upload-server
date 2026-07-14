/**
 * [INPUT]: 依赖 Admin 数值格式化工具与系统状态、性能、RUM 响应的稳定字段契约
 * [OUTPUT]: 对外提供系统工作区/日志配置以及状态、性能、备份、版本和 RUM 展示格式化函数
 * [POS]: admin-ui/src/views 的系统页声明与纯展示规则，隔离稳定映射和 SystemView 的运行时 API 编排
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { number, time } from "../utils/format";

export const systemTabs = [
    { key: "runtime", label: "运行状态" },
    { key: "access", label: "权限与 Token" },
    { key: "backup", label: "备份恢复" },
    { key: "logs", label: "监控日志" }
];

export const logFilters = [
    { key: "all", label: "全部" },
    { key: "error", label: "错误" },
    { key: "database", label: "数据库" },
    { key: "bot", label: "Bot" },
    { key: "reader", label: "阅读器" },
    { key: "server", label: "后端" },
    { key: "setup", label: "启动/面板" }
];

export function statusClass(item) {
    if (item.skipped) return "skip";
    if (!item.ok && item.required === false) return "optional-fail";
    return item.ok ? "ok" : "fail";
}

export function statusLabel(item) {
    if (item.skipped) return "SKIP";
    if (item.ok) return "OK";
    return item.required === false ? "OPTIONAL FAIL" : "FAIL";
}

export function backupTypeLabel(type) {
    if (type === "postgres") return "数据库";
    if (type === "config") return "配置";
    if (type === "diagnostics") return "诊断";
    return type || "备份";
}

export function perfEndpointLabel(name) {
    const labels = { search: "搜索", detail: "详情", catalog: "目录", chapter: "正文" };
    return labels[name] || name || "-";
}

export function metricTime(seconds) {
    const value = Number(seconds || 0);
    return value > 0 ? time(value * 1000) : "尚未成功";
}

export function perfStateClass(item) {
    if (!item.count) return "skip";
    return item.ok ? "ok" : "fail";
}

export function perfStateLabel(item) {
    if (!item.count) return "无样本";
    return item.ok ? "OK" : "超预算";
}

export function rumMetricLabel(metric) {
    return (
        { page_load: "首屏完成", ttfb: "TTFB", fcp: "FCP", lcp: "LCP", cls: "CLS", inp: "INP", route: "路由切换", long_task: "长任务" }[
            metric
        ] ||
        metric ||
        "-"
    );
}

export function rumValue(item) {
    return item.metric === "cls" ? Number(item.p50 || 0).toFixed(3) : `${number(item.p50 || 0)}ms`;
}

export function rumP95(item) {
    return item.metric === "cls" ? Number(item.p95 || 0).toFixed(3) : `${number(item.p95 || 0)}ms`;
}

export function formatBuildDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
    return date.toISOString().slice(0, 16).replace("T", " ");
}
