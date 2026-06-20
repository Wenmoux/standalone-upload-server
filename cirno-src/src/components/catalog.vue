<template>
  <div class="catalog-container">
    <a-modal
      v-model:open="visible"
      class="catalog-dialog-container"
      :closable="false"
      :footer="null"
      wrapClassName="catalog-modal-wrap"
      :width="520"
      :dialogStyle="{
        'margin-left': marginLeft + 'px'
      }"
    >
      <div class="catalog-panel">
        <div class="header-wrapper">
          <div class="catalog-head">
            <div class="book-cover" :style="getCover"></div>
            <div class="book-info">
              <div class="book-name">{{ info.book_name }}</div>
              <div class="book-author">{{ info.author_name }}</div>
              <div class="read-speed">{{ '上次更新 ' + info.uptime }}</div>
            </div>
          </div>
          <div class="catalog-button-container">
            <i class="ri-sort-asc catalog-button"></i>
          </div>
        </div>
        <div class="scroll-wrapper" ref="bsWrapper">
          <div class="catalog-content">
            <div
              class="catalog"
              v-for="chapter in visibleChapters"
              :key="chapter.chapter_id || chapter.__catalogIndex"
              :class="{ 'catalog-volume-row': isVolumeChapter(chapter) }"
              @click="getContent(chapter)"
            >
              <div
                class="chaper-title"
                :class="{
                  'chapter-title-selected': !isVolumeChapter(chapter) && chapter.__catalogIndex === currentChapter,
                  'volume-title': isVolumeChapter(chapter)
                }"
              >
                <i v-if="isVolumeChapter(chapter)" :class="volumeIconClass(chapter)"></i>
                <span class="chapter-name">{{ chapter.chapter_title }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script>
import PerfectScrollbar from 'perfect-scrollbar'
import 'perfect-scrollbar/css/perfect-scrollbar.css'
export default {
  name: 'Catalog',
  props: {
    chapters: {
      type: Array,
      default: () => {
        return []
      }
    },
    currentChapter: {
      type: Number,
      default: 0
    },
    info: {
      type: Object,
      default: () => {
        return {}
      }
    },
    reverse: {
      type: Boolean,
      default: false
    },
    marginLeft: {
      type: Number,
      default: 0
    }
  },
  data() {
    return {
      visible: false,
      cataScroll: null,
      collapsedVolumes: {}
    }
  },
  computed: {
    getCover: function() {
      return `background: url(${this.info.cover}) no-repeat;background-size: cover;`
    },
    visibleChapters() {
      const rows = []
      let collapsed = false
      for (let index = 0; index < this.chapters.length; index += 1) {
        const chapter = Object.assign({ __catalogIndex: index }, this.chapters[index])
        if (this.isVolumeChapter(chapter)) {
          collapsed = this.isVolumeCollapsed(chapter)
          rows.push(chapter)
          continue
        }
        if (!collapsed) rows.push(chapter)
      }
      return rows
    }
  },
  created() {},
  watch: {
    marginLeft(newValue) {
      this.$forceUpdate()
    },
    currentChapter(newValue) {
      this.$forceUpdate()
    }
  },
  methods: {
    showCatalog() {
      this.visible = true
      this.$nextTick(() => {
        this.cataScroll = new PerfectScrollbar(this.$refs.bsWrapper, {
          wheelSpeed: 2,
          wheelPropagation: true,
          minScrollbarLength: 20
        })
        this.$refs.bsWrapper.scrollTop = 52 * (this.currentChapter - 1)
      })
    },
    hideCatalog() {
      this.visible = false
    },
    initScroll() {},
    isVolumeChapter(chapter) {
      return !!(chapter && (chapter.is_volume || chapter.isVolume))
    },
    volumeKey(chapter) {
      return String((chapter && (chapter.chapter_id || chapter.chapter_title)) || '')
    },
    isVolumeCollapsed(chapter) {
      return !!this.collapsedVolumes[this.volumeKey(chapter)]
    },
    volumeIconClass(chapter) {
      return this.isVolumeCollapsed(chapter) ? 'ri-arrow-right-s-line volume-toggle-icon' : 'ri-arrow-down-s-line volume-toggle-icon'
    },
    toggleVolume(chapter) {
      const key = this.volumeKey(chapter)
      if (!key) return
      this.collapsedVolumes[key] = !this.collapsedVolumes[key]
      this.$nextTick(() => {
        if (this.cataScroll && this.cataScroll.update) this.cataScroll.update()
      })
    },
    getContent(chapter) {
      if (this.isVolumeChapter(chapter)) {
        this.toggleVolume(chapter)
        return
      }
      this.hideCatalog()
      this.$emit('getContent', chapter.chapter_id)
    }
  }
}
</script>

<style lang="less" scoped>
:global(.catalog-modal-wrap .ant-modal) {
  position: unset;
  padding-bottom: 0;
}

:global(.catalog-modal-wrap .ant-modal-content) {
  width: 520px;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.56);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 28px 76px rgba(15, 23, 42, 0.22), 0 2px 10px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(24px) saturate(1.24);
  -webkit-backdrop-filter: blur(24px) saturate(1.24);
}

:global(.catalog-modal-wrap .ant-modal-body) {
  padding: 0;
}
.catalog-panel {
  .header-wrapper {
    padding: 24px 24px 12px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.36);
    .catalog-head {
      display: flex;
      align-items: center;
      .book-cover {
        width: 62px;
        height: 88px;
        margin-right: 16px;
        border-radius: 8px;
        background-position: center !important;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
      }
      .book-info {
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        font-family: 'Noto Sans SC', serif, PingFang SC, -apple-system, SF UI Text, Lucida Grande, STheiti,
          Microsoft YaHei, sans-serif;
        .book-name {
          max-width: 330px;
          font-size: 18px;
          font-weight: 800;
          color: #1b2633;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .book-author {
          color: rgba(31, 41, 55, 0.72);
          margin-top: 7px;
          font-size: 14px;
          font-weight: 700;
        }
        .read-speed {
          color: rgba(71, 85, 105, 0.72);
          margin-top: 6px;
          font-size: 13px;
          font-weight: 600;
        }
      }
    }
  }
  .catalog-button-container {
    height: 36px;
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    .catalog-button {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: rgba(255, 255, 255, 0.56);
      color: rgba(51, 65, 85, 0.86);
      font-size: 18px;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(15, 23, 42, 0.08);
    }
  }
  .scroll-wrapper {
    height: calc(~'100vh - 176px');
    overflow: hidden;
    position: relative;
    background: rgba(248, 250, 252, 0.32);
    .catalog-content {
      height: fit-content;
      padding: 14px 18px 18px;
      .catalog {
        margin-bottom: 10px;
        .chaper-title {
          min-height: 48px;
          padding: 12px 14px;
          cursor: pointer;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          .chapter-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          border: 1px solid rgba(148, 163, 184, 0.24);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.52);
          color: #253142;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          word-break: break-all;
          font-size: 15px;
          font-weight: 650;
          box-shadow: 0 5px 18px rgba(15, 23, 42, 0.06);
          transition: all 0.18s ease;
          &:hover {
            border-color: rgba(27, 136, 238, 0.32);
            background: rgba(255, 255, 255, 0.76);
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.09);
          }
        }
        .chapter-title-selected {
          color: #0f5ca4;
          border-color: rgba(27, 136, 238, 0.48);
          background: rgba(219, 234, 254, 0.68);
          box-shadow: 0 10px 26px rgba(27, 136, 238, 0.14), inset 3px 0 0 rgba(27, 136, 238, 0.84);
        }
        &.catalog-volume-row {
          margin: 18px 0 10px;
          .volume-title {
            min-height: 34px;
            padding: 6px 4px 7px;
            cursor: default;
            display: grid;
            grid-template-columns: 18px minmax(0, 1fr);
            align-items: center;
            border-color: transparent;
            border-radius: 0;
            background: transparent;
            color: rgba(71, 85, 105, 0.76);
            box-shadow: none;
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0;
            &:hover {
              border-color: transparent;
              background: transparent;
              box-shadow: none;
            }
            .volume-toggle-icon {
              width: 18px;
              color: rgba(27, 136, 238, 0.78);
              font-size: 17px;
              line-height: 1;
            }
            .chapter-name {
              position: relative;
              padding-left: 4px;
            }
          }
        }
      }
    }
  }
}

@media (max-width: 768px) {
  :global(.catalog-modal-wrap .ant-modal) {
    width: calc(100vw - 28px) !important;
    max-width: 480px;
    margin: 0 auto;
  }

  :global(.catalog-modal-wrap .ant-modal-content) {
    width: 100%;
    border-radius: 14px;
  }
  .catalog-panel {
    .header-wrapper {
      padding: 20px 18px 10px;
      .catalog-head {
        .book-cover {
          width: 54px;
          height: 76px;
          margin-right: 12px;
        }
        .book-info .book-name {
          max-width: 260px;
          font-size: 16px;
        }
      }
    }
    .scroll-wrapper {
      height: 62vh;
      .catalog-content {
        padding: 12px;
        .catalog .chaper-title {
          min-height: 46px;
          padding: 10px 12px;
          font-size: 14px;
        }
      }
    }
  }
}
</style>
