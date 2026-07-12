/**
 * [INPUT]: 依赖项目数、定高行高、滚动位置、视口高度和 overscan 参数
 * [OUTPUT]: 对外提供 calculateVirtualRange 纯函数，返回窗口起止、偏移与总高度
 * [POS]: cirno-src/src/utils 的虚拟列表算法内核，被目录和书籍详情的渲染组件复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function calculateVirtualRange({ itemCount, itemHeight, scrollTop, viewportHeight, overscan = 6 }) {
  const count = Math.max(0, Math.trunc(Number(itemCount || 0)))
  const height = Math.max(1, Number(itemHeight || 1))
  const viewport = Math.max(height, Number(viewportHeight || height))
  const extra = Math.max(0, Math.trunc(Number(overscan || 0)))
  const maxStart = Math.max(0, count - 1)
  const visibleStart = Math.floor(Math.max(0, Number(scrollTop || 0)) / height)
  const start = Math.min(maxStart, Math.max(0, visibleStart - extra))
  const visibleCount = Math.ceil(viewport / height)
  const end = Math.min(count, Math.max(start, visibleStart + visibleCount + extra))
  return {
    start: count ? start : 0,
    end,
    offset: count ? start * height : 0,
    totalHeight: count * height
  }
}
