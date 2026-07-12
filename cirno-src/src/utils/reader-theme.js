/**
 * [INPUT]: 依赖 Reader 主题设置及内置调色板、用户自定义颜色值
 * [OUTPUT]: 对外提供默认主题、调色板集合、readerPalette 和 CSS 变量投影函数
 * [POS]: cirno-src/src/utils 的视觉主题适配层，把设置模型稳定转换为页面样式
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const DEFAULT_THEME = {
  theme: 'default',
  customBg: '#f4ead8',
  customPaper: '#fff9ed',
  customText: '#2f251d',
  customAccent: '#1b88ee'
}

export const READER_PALETTES = {
  default: {
    page: '#f6f7f9',
    paper: '#ffffff',
    topbar: 'rgba(255, 255, 255, 0.96)',
    text: '#0d141e',
    muted: '#626b78',
    border: 'rgba(33, 40, 50, 0.1)',
    soft: '#f1f3f6',
    control: '#ffffff',
    accent: '#1b88ee',
    shadow: '0 8px 32px rgba(0, 25, 104, 0.1)'
  },
  paper: {
    page: '#e7dcc9',
    paper: '#fbf3e4',
    topbar: 'rgba(251, 243, 228, 0.96)',
    text: '#2f251d',
    muted: '#7a6754',
    border: 'rgba(97, 70, 41, 0.18)',
    soft: '#efe2ce',
    control: '#fff9ed',
    accent: '#9b5d2e',
    shadow: '0 10px 30px rgba(88, 60, 30, 0.14)'
  },
  jianghu: {
    page: '#e5d4bc',
    paper: '#f3e6d4',
    topbar: 'rgba(243, 230, 212, 0.96)',
    text: '#17120e',
    muted: '#756b60',
    border: 'rgba(124, 82, 54, 0.2)',
    soft: '#ead8bf',
    control: '#f8eddd',
    accent: '#a80000',
    shadow: '0 12px 34px rgba(83, 49, 26, 0.16)'
  },
  green: {
    page: '#dbe8d3',
    paper: '#edf7e8',
    topbar: 'rgba(237, 247, 232, 0.96)',
    text: '#223628',
    muted: '#5f7464',
    border: 'rgba(63, 96, 69, 0.18)',
    soft: '#dfeedd',
    control: '#f5fbf1',
    accent: '#3d8b58',
    shadow: '0 10px 30px rgba(45, 89, 55, 0.12)'
  },
  blue: {
    page: '#dce8ef',
    paper: '#f0f7fb',
    topbar: 'rgba(240, 247, 251, 0.96)',
    text: '#22313f',
    muted: '#64798a',
    border: 'rgba(51, 87, 113, 0.16)',
    soft: '#e3f0f7',
    control: '#f8fcff',
    accent: '#417aa0',
    shadow: '0 10px 30px rgba(46, 82, 111, 0.12)'
  },
  dark: {
    page: '#111722',
    paper: '#1f2430',
    topbar: 'rgba(31, 36, 48, 0.96)',
    text: '#d8dee9',
    muted: '#9aa7b7',
    border: 'rgba(214, 224, 238, 0.12)',
    soft: '#252d3b',
    control: '#283142',
    accent: '#79a8ff',
    shadow: '0 12px 32px rgba(0, 0, 0, 0.28)'
  },
  black: {
    page: '#000000',
    paper: '#0b0d10',
    topbar: 'rgba(11, 13, 16, 0.96)',
    text: '#d6d7d9',
    muted: '#8d949d',
    border: 'rgba(214, 215, 217, 0.13)',
    soft: '#15181d',
    control: '#15181d',
    accent: '#8ab4ff',
    shadow: '0 12px 32px rgba(0, 0, 0, 0.36)'
  }
}

export function readerPalette(settings = {}) {
  if (settings.theme === 'custom') {
    return {
      page: settings.customBg || DEFAULT_THEME.customBg,
      paper: settings.customPaper || DEFAULT_THEME.customPaper,
      topbar: settings.customPaper || DEFAULT_THEME.customPaper,
      text: settings.customText || DEFAULT_THEME.customText,
      muted: settings.customText || DEFAULT_THEME.customText,
      border: 'rgba(90, 75, 58, 0.2)',
      soft: settings.customBg || DEFAULT_THEME.customBg,
      control: settings.customPaper || DEFAULT_THEME.customPaper,
      accent: settings.customAccent || DEFAULT_THEME.customAccent,
      shadow: '0 10px 30px rgba(0, 0, 0, 0.12)'
    }
  }
  return READER_PALETTES[settings.theme] || READER_PALETTES.default
}

export function readerThemeStyle(settings = {}) {
  const palette = readerPalette(settings)
  return {
    '--reader-page-bg': palette.page,
    '--reader-paper-bg': palette.paper,
    '--reader-topbar-bg': palette.topbar,
    '--reader-text-color': palette.text,
    '--reader-muted-color': palette.muted,
    '--reader-border-color': palette.border,
    '--reader-soft-bg': palette.soft,
    '--reader-control-bg': palette.control,
    '--reader-accent-color': palette.accent,
    '--reader-shadow': palette.shadow
  }
}
