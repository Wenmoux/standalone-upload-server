/**
 * [INPUT]: 依赖 Vue ref 与调用视图提供的工作区加载器映射
 * [OUTPUT]: 对外提供 useLazyWorkspace，统一首次按需加载、并发去重、成功缓存和当前区强制刷新
 * [POS]: admin-ui/src/utils 的页内工作区调度器，被系统和 TG Bot 等高密度分区视图复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ref } from "vue";

export function useLazyWorkspace(initialKey, loaders = {}) {
    const activeTab = ref(initialKey);
    const loadedTabs = new Set();
    const pendingTabs = new Map();

    async function loadTab(key, { force = false } = {}) {
        if (!force && loadedTabs.has(key)) return;
        const loader = loaders[key];
        if (typeof loader !== "function") return;
        if (pendingTabs.has(key)) return pendingTabs.get(key);
        const pending = Promise.resolve()
            .then(loader)
            .then(() => loadedTabs.add(key))
            .finally(() => pendingTabs.delete(key));
        pendingTabs.set(key, pending);
        return pending;
    }

    async function selectTab(key) {
        if (typeof loaders[key] !== "function") return;
        activeTab.value = key;
        await loadTab(key);
    }

    function loadActiveTab() {
        return loadTab(activeTab.value);
    }

    function refreshActive() {
        return loadTab(activeTab.value, { force: true });
    }

    return { activeTab, selectTab, loadActiveTab, refreshActive };
}
