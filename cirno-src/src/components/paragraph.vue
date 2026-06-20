<script>
import { h } from 'vue'
import { sanitizeImageUrl } from '../utils/sanitize-html'

let picParaReg = /^\s*<img\b[\s\S]*>\s*$/
let picAltReg = /(?<=alt=').+?(?=')/
let picSrcReg = /(?<=src=").+?(?=")/
export default {
  name: 'Paragraph',
  data() {
    return { picParaReg, picAltReg, picSrcReg }
  },
  props: [
    'paragraphs',
    'isDark',
    'size',
    'lineHeight',
    'fontFamily',
    'titleStyle',
    'textColor',
    'accentColor',
    'paragraphSpacing',
    'paragraphIndent',
    'letterSpacing',
    'textAlign',
    'fontWeight',
    'pagePadding',
    'activeTtsIndex'
  ],
  methods: {
    paragraphText(paragraph) {
      if (!paragraph) return ''
      return paragraph.displayText !== undefined ? paragraph.displayText : paragraph.text
    },
    isIhuabenParagraph(paragraph) {
      return paragraph && /^ihuaben-/.test(String(paragraph.type || ''))
    },
    titleClass() {
      return `chapter-title tssukomi-wrapper title-${this.titleStyle || 'classic'}`
    },
    pictureSrc(text) {
      const match = String(text || '').match(this.picSrcReg)
      return sanitizeImageUrl(match ? match[0] : '')
    },
    pictureAlt(text) {
      const match = String(text || '').match(this.picAltReg)
      return match ? match[0] : '图片'
    }
  },
  render() {
    if (!this.paragraphs.length) return h('div')

    const lineHeight = Number(this.lineHeight || 1.8)
    const fontFamily = this.fontFamily || 'PingFang SC, Microsoft YaHei, sans-serif'
    const color = this.textColor || (+this.isDark ? '#d0d3d8' : '#0d141e')
    const accentColor = this.accentColor || '#1b88ee'
    const paragraphSpacing = Number(this.paragraphSpacing || 0.9)
    const paragraphIndent = Number(this.paragraphIndent || 0)
    const letterSpacing = Number(this.letterSpacing || 0)
    const textAlign = this.textAlign === 'justify' ? 'justify' : 'left'
    const fontWeight = Number(this.fontWeight || 400)
    const pagePadding = Math.max(20, Math.min(120, Number(this.pagePadding || 72)))

    const rows = this.paragraphs.map((a, i) => {
      const pictureSrc = this.pictureSrc(a.text)
      const pictureAlt = this.pictureAlt(a.text)
      const isPic = this.picParaReg.test(a.text) && !!pictureSrc
      const isIhuaben = this.isIhuabenParagraph(a)
      const ihuabenImageSrc = sanitizeImageUrl(a.imageSrc)
      const paragraphStyle = {
        fontSize: `${Number(this.size)}px`,
        lineHeight,
        fontFamily,
        color,
        margin: `${paragraphSpacing}em auto`,
        letterSpacing: `${letterSpacing}px`,
        textAlign,
        fontWeight,
        textIndent: isPic || isIhuaben ? '0' : `${paragraphIndent}em`,
        padding: `0 ${pagePadding}px`
      }
      const dataAttrs = { 'data-paragraph-index': i }
      let contentNode

      if (a.type === 'ihuaben-image' && ihuabenImageSrc) {
        contentNode = h(
          'span',
          {
            class: 'content-text ihuaben-image-wrap',
            ...dataAttrs,
            onClick: () => this.$emit('showPic', ihuabenImageSrc)
          },
          [h('img', { src: ihuabenImageSrc, alt: a.imageAlt || '图片' })]
        )
      } else if (a.type === 'ihuaben-dialogue') {
        contentNode = h(
          'span',
          {
            class: {
              'content-text': true,
              'ihuaben-dialogue-body': true,
              'ihuaben-dialogue-right': a.side === 'right'
            },
            ...dataAttrs
          },
          [
            h('span', { class: 'ihuaben-avatar', 'aria-hidden': 'true' }, String(a.speaker || '?').slice(0, 1)),
            h('span', { class: 'ihuaben-dialogue-main' }, [
              h('span', { class: 'ihuaben-speaker' }, a.speaker),
              h('span', { class: 'ihuaben-bubble' }, this.paragraphText(a))
            ])
          ]
        )
      } else if (a.type === 'ihuaben-narration') {
        contentNode = h('span', { class: 'content-text ihuaben-text', ...dataAttrs }, this.paragraphText(a))
      } else if (isPic) {
        contentNode = h(
          'span',
          {
            class: 'content-text pic-alt',
            ...dataAttrs,
            onClick: () => this.$emit('showPic', pictureSrc)
          },
          `　　【${pictureAlt}】`
        )
      } else {
        contentNode = h('span', { class: 'content-text', ...dataAttrs }, this.paragraphText(a))
      }

      const children = [contentNode]
      if (a.tsukkomi_num > 0) {
        children.push(
          h('span', { class: 'tssukomi', onClick: () => this.$emit('showTsu', i, a.tsukkomi_num) }, [
            String(a.tsukkomi_num),
            h('i', [h('cite')])
          ])
        )
      }

      return h(
        'p',
        {
          class: {
            'tssukomi-wrapper': true,
            'ihuaben-paragraph': isIhuaben,
            [`${a.type || ''}`]: isIhuaben,
            'tts-active-paragraph': Number(this.activeTtsIndex) === i
          },
          style: paragraphStyle,
          ...dataAttrs
        },
        children
      )
    })

    rows.push(h('div', { class: 'content-footer' }))
    return h(
      'div',
      {
        class: 'content',
        style: { color, fontFamily, '--paragraph-accent-color': accentColor }
      },
      rows
    )
  }
}
</script>

<style lang="less" scoped>
.content {
  padding-bottom: 0.67vh;
  min-height: 100vh;
  transition: all ease 0.5s;
  .tssukomi-wrapper {
    .tssukomi {
      font-size: 14px;
      line-height: 14px;
      position: relative;
      z-index: 1;
      display: inline-block;
      min-width: 34px;
      height: 16px;
      margin-left: 14px;
      text-align: center;
      vertical-align: 1px;
      color: var(--paragraph-accent-color);
      border: 1px solid var(--paragraph-accent-color);
      border-radius: 2px;
      opacity: 0.72;
      user-select: none;
      cursor: pointer;
      i {
        position: absolute;
        top: 50%;
        left: -5px;
        width: 0;
        height: 0;
        margin-top: -3px;
        border-top: 3px solid transparent;
        border-right: 4px solid var(--paragraph-accent-color);
        border-bottom: 3px solid transparent;
        border-left: 0 none;
        cite {
          position: absolute;
          top: -3px;
          left: 1px;
          width: 0;
          height: 0;
          border-top: 3px solid transparent;
          border-right: 4px solid var(--reader-paper-bg, #fff);
          border-bottom: 3px solid transparent;
          border-left: 0 none;
        }
      }
    }
  }
  .chapter-title {
    font-family: 'Noto Sans SC', serif, PingFang SC, -apple-system, SF UI Text, Lucida Grande, STheiti, Microsoft YaHei,
      sans-serif;
    margin: 0 0 56px;
    box-sizing: border-box;
    width: 100%;
    font-weight: bold;
  }
  .title-center {
    text-align: center;
  }
  .title-underline {
    padding-bottom: 18px;
    border-bottom: 1px solid currentColor;
  }
  p {
    font: 19px / 34px 'PingFang SC', -apple-system, 'SF UI Text', 'Lucida Grande', STheiti, 'Microsoft YaHei',
      sans-serif;
    overflow: hidden;
    word-break: break-all;
    box-sizing: border-box;
    padding: 0 72px;
    margin: 0.8em auto;
    .pic-alt {
      color: var(--paragraph-accent-color);
      cursor: pointer;
    }
    &.tts-active-paragraph {
      background: rgba(27, 136, 238, 0.1);
      box-shadow: inset 3px 0 0 var(--paragraph-accent-color);
    }
    &.ihuaben-paragraph {
      width: 100%;
      max-width: 760px;
      overflow: visible;
      word-break: break-word;
      line-height: 1.8;
      margin: 1.05em auto;
      text-align: left;
      .content-text {
        display: block;
      }
      .ihuaben-text {
        color: currentColor;
      }
      .ihuaben-image-wrap {
        cursor: zoom-in;
        img {
          display: block;
          width: 100%;
          max-width: 640px;
          max-height: 68vh;
          object-fit: contain;
          margin: 0 auto;
          border: 0;
          box-shadow: none;
        }
      }
      .ihuaben-dialogue-body {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        width: 100%;
        justify-content: flex-start;
        &.ihuaben-dialogue-right {
          flex-direction: row-reverse;
          justify-content: flex-start;
          .ihuaben-dialogue-main {
            align-items: flex-end;
          }
          .ihuaben-speaker {
            text-align: right;
          }
        }
      }
      .ihuaben-avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        flex: 0 0 40px;
        border-radius: 50%;
        background: #eef0f3;
        color: #6f7782;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
      }
      .ihuaben-dialogue-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }
      .ihuaben-speaker {
        color: #7f8790;
        font-size: 14px;
        line-height: 1.2;
        font-weight: 500;
      }
      .ihuaben-bubble {
        display: inline-block;
        box-sizing: border-box;
        width: auto;
        max-width: 620px;
        padding: 8px 14px;
        border-radius: 8px;
        background: rgba(238, 239, 241, 0.95);
        color: currentColor;
        line-height: 1.65;
        box-shadow: none;
      }
    }
  }
  .content-footer {
    height: 42px;
    width: 100%;
  }
}
</style>
