<!--
 * [INPUT]: 依赖 calculateVirtualRange、滚动容器、定高条目与 scoped slot
 * [OUTPUT]: 对外提供 VirtualList 窗口化列表组件
 * [POS]: Reader components 的性能原语，被目录和详情长列表复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
<template>
  <div ref="viewport" class="virtual-list-viewport" :style="viewportStyle" @scroll.passive="handleScroll">
    <div class="virtual-list-spacer" :style="{ height: range.totalHeight + 'px' }">
      <div class="virtual-list-window" :style="{ transform: `translateY(${range.offset}px)` }">
        <div
          v-for="entry in windowItems"
          :key="itemKey(entry.item, entry.index)"
          class="virtual-list-item"
          :style="{ height: itemHeight + 'px' }"
        >
          <slot :item="entry.item" :index="entry.index"></slot>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { calculateVirtualRange } from '@/utils/virtual-list'

export default {
  name: 'VirtualList',
  props: {
    items: { type: Array, default: () => [] },
    itemHeight: { type: Number, default: 56 },
    height: { type: [Number, String], default: 480 },
    overscan: { type: Number, default: 8 },
    keyField: { type: String, default: '' }
  },
  data() {
    return {
      scrollTop: 0,
      viewportHeight: 0,
      resizeObserver: null
    }
  },
  computed: {
    viewportStyle() {
      return { height: typeof this.height === 'number' ? `${this.height}px` : this.height }
    },
    range() {
      return calculateVirtualRange({
        itemCount: this.items.length,
        itemHeight: this.itemHeight,
        scrollTop: this.scrollTop,
        viewportHeight: this.viewportHeight || this.itemHeight,
        overscan: this.overscan
      })
    },
    windowItems() {
      return this.items.slice(this.range.start, this.range.end).map((item, offset) => ({
        item,
        index: this.range.start + offset
      }))
    }
  },
  watch: {
    items() {
      this.$nextTick(this.measure)
    }
  },
  mounted() {
    this.measure()
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.measure)
      this.resizeObserver.observe(this.$refs.viewport)
    }
  },
  beforeUnmount() {
    this.resizeObserver?.disconnect()
  },
  methods: {
    itemKey(item, index) {
      if (this.keyField && item && item[this.keyField] !== undefined) return item[this.keyField]
      return item?.chapter_id || item?.id || index
    },
    handleScroll(event) {
      this.scrollTop = event.currentTarget.scrollTop
    },
    measure() {
      const viewport = this.$refs.viewport
      if (!viewport) return
      this.viewportHeight = viewport.clientHeight || this.itemHeight
      this.scrollTop = viewport.scrollTop || 0
    },
    scrollToIndex(index, align = 'center') {
      const viewport = this.$refs.viewport
      if (!viewport || !this.items.length) return
      const safeIndex = Math.max(0, Math.min(this.items.length - 1, Number(index || 0)))
      const itemTop = safeIndex * this.itemHeight
      const viewportHeight = viewport.clientHeight || this.viewportHeight || this.itemHeight
      const target = align === 'start' ? itemTop : Math.max(0, itemTop - (viewportHeight - this.itemHeight) / 2)
      viewport.scrollTop = target
      this.scrollTop = target
    }
  }
}
</script>

<style scoped>
.virtual-list-viewport {
  box-sizing: border-box;
  position: relative;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.virtual-list-spacer {
  position: relative;
  width: 100%;
}

.virtual-list-window {
  position: absolute;
  inset: 0 0 auto;
  width: 100%;
  will-change: transform;
}

.virtual-list-item {
  width: 100%;
  overflow: hidden;
}
</style>
