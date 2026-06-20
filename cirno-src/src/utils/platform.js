const DEFAULT_PLATFORM_LABELS = {
  po18: 'PO18',
  popo: 'POPO',
  qidian: '起点',
  qd: '起点',
  fanqie: '番茄',
  fq: '番茄',
  tomato: '番茄',
  miguodu: '米国度',
  migudu: '米国度',
  miguo: '米国度',
  hetu: '河图',
  haitang: '海棠',
  ht: '海棠',
  longma: '海棠',
  lianhongxintiao: '脸红心跳',
  lianhong: '脸红心跳',
  lhxt: '脸红心跳'
}

let platformLabels = Object.assign({}, DEFAULT_PLATFORM_LABELS)
let platformOptions = [
  { value: 'po18', label: 'PO18' },
  { value: 'popo', label: 'POPO' },
  { value: 'qidian', label: '起点' },
  { value: 'fanqie', label: '番茄' },
  { value: 'miguodu', label: '米国度' },
  { value: 'hetu', label: '河图' },
  { value: 'haitang', label: '海棠' },
  { value: 'lianhongxintiao', label: '脸红心跳' }
]
let loadingPromise = null

function normalizePlatformKey(platform) {
  return String(platform || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

export function platformLabel(platform) {
  const raw = String(platform || '').trim()
  if (!raw) return '本地'
  const key = normalizePlatformKey(raw)
  return platformLabels[key] || platformLabels[raw.toLowerCase()] || raw
}

export function getPlatformOptions() {
  return platformOptions.slice()
}

export async function loadPlatformConfig(force = false) {
  if (loadingPromise && !force) return loadingPromise
  loadingPromise = fetch('/reader-api/platforms', { credentials: 'include' })
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
      if (!data) return getPlatformOptions()
      const labels = Object.assign({}, DEFAULT_PLATFORM_LABELS, data.labels || {})
      platformLabels = Object.keys(labels).reduce((acc, key) => {
        const normalized = normalizePlatformKey(key)
        if (normalized && labels[key]) acc[normalized] = labels[key]
        return acc
      }, {})
      platformOptions = (data.platforms || [])
        .filter(item => item && item.value)
        .map(item => ({ value: item.value, label: platformLabel(item.value) }))
      if (!platformOptions.length) {
        platformOptions = Object.keys(DEFAULT_PLATFORM_LABELS).map(value => ({ value, label: platformLabel(value) }))
      }
      return getPlatformOptions()
    })
    .catch(() => getPlatformOptions())
  return loadingPromise
}
