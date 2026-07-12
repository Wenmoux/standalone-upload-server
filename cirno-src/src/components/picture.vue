<!--
 * [INPUT]: 依赖 sanitizeImageUrl 与图片段落数据
 * [OUTPUT]: 对外提供 Picture 安全图片组件
 * [POS]: Reader components 的图片协议过滤边界，为正文图片提供失败回退
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 -->
<template>
  <div class="pic-dialog">
    <a-modal v-model:open="visible" title="" :footer="null" :closable="false">
      <div class="img-body">
        <img class="pic-img" :src="picImg" alt="" />
      </div>
    </a-modal>
  </div>
</template>

<script>
import { sanitizeImageUrl } from '../utils/sanitize-html'

export default {
  name: 'Picture',
  data() {
    return {
      visible: false,
      picImg: ''
    }
  },
  methods: {
    showPic(url, desc) {
      const safeUrl = sanitizeImageUrl(url)
      if (!safeUrl) return
      this.picImg = safeUrl
      this.$nextTick(() => {
        this.visible = true
      })
    }
  }
}
</script>

<style lang="less" scoped>
:deep(.ant-modal ){
  top: 0;
  padding-bottom: 0;
  .ant-modal-content {
    height: 100vh;
    background: transparent;
    box-shadow: none;
    width: fit-content;
    .ant-modal-body {
      height: 100%;
      padding: 0;
      .header {
        height: 36px;
      }
      .img-body {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-content: center;
        height: calc(~'100vh');
        display: flex;
        justify-content: center;
        align-items: center;
        .pic-img {
          width: auto;
          max-height: calc(~'100vh - 144px');
        }
        .footer {
          height: 72px;
          .img-desc {
            user-select: none;
            font-size: 15px;
            color: #ffffff;
            font-weight: 500;
            letter-spacing: 1px;
          }
        }
      }
    }
  }
}
</style>
