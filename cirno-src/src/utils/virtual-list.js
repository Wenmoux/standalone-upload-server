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
