/**
 * [INPUT]: 依赖浏览器 Performance/路由事件、fetch 和 `/reader-api/performance` 采集端点
 * [OUTPUT]: 对外提供可配置 RUM reporter 与 installReaderPerformance 路由集成函数
 * [POS]: cirno-src/src/utils 的客户端可观测性边界，批量上报而不阻塞 Reader 交互
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const ENDPOINT = '/reader-api/performance'
const MAX_QUEUE = 30

function sessionId() {
  try {
    const key = 'po18ReaderRumSession'
    let value = sessionStorage.getItem(key)
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      sessionStorage.setItem(key, value)
    }
    return value
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

function rating(metric, value) {
  const thresholds = {
    lcp: [2500, 4000],
    inp: [200, 500],
    cls: [0.1, 0.25],
    fcp: [1800, 3000],
    ttfb: [800, 1800],
    page_load: [2500, 5000],
    route: [1000, 2500],
    long_task: [100, 300]
  }[metric]
  if (!thresholds) return ''
  if (value <= thresholds[0]) return 'good'
  if (value <= thresholds[1]) return 'needs-improvement'
  return 'poor'
}

function routeLabel(route) {
  return String(route?.name || route?.path || 'unknown').slice(0, 80)
}

export function createReaderPerformanceReporter(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const queue = []
  const rumSessionId = options.sessionId || sessionId()
  let currentRoute = 'unknown'
  let flushTimer = 0
  let flushing = false

  function scheduleFlush(delay = 4000) {
    window.clearTimeout(flushTimer)
    flushTimer = window.setTimeout(() => flush(), delay)
  }

  function record(metric, value, metadata = {}) {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) return
    queue.push({
      session_id: rumSessionId,
      route: currentRoute,
      metric,
      value: Math.round(number * 100) / 100,
      rating: rating(metric, number),
      navigation_type: metadata.navigationType || '',
      metadata
    })
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
    scheduleFlush(queue.length >= 10 ? 200 : 4000)
  }

  async function flush() {
    if (flushing || !queue.length || typeof fetchImpl !== 'function') return
    flushing = true
    const events = queue.splice(0, MAX_QUEUE)
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events })
      })
      if (!response.ok && response.status !== 401) throw new Error(`RUM HTTP ${response.status}`)
    } catch {
      queue.unshift(...events.slice(-MAX_QUEUE))
    } finally {
      flushing = false
    }
  }

  function setRoute(route) {
    currentRoute = routeLabel(route)
  }

  return { record, flush, setRoute, queue }
}

export function installReaderPerformance(router, options = {}) {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return null
  const reporter = createReaderPerformanceReporter(options)
  let routeStartedAt = performance.now()
  let clsValue = 0
  let inpValue = 0
  let lcpValue = 0

  router.beforeResolve(to => {
    routeStartedAt = performance.now()
    reporter.setRoute(to)
  })
  router.afterEach(to => {
    reporter.setRoute(to)
    if (to.name !== 'Login') reporter.record('route', performance.now() - routeStartedAt)
  })

  window.addEventListener('load', () => {
    window.setTimeout(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      if (navigation) {
        reporter.record('page_load', navigation.duration, { navigationType: navigation.type || '' })
        reporter.record('ttfb', navigation.responseStart, { navigationType: navigation.type || '' })
      }
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      if (fcp) reporter.record('fcp', fcp.startTime)
    }, 0)
  }, { once: true })

  const observe = (type, callback) => {
    try {
      const observer = new PerformanceObserver(list => callback(list.getEntries()))
      observer.observe({ type, buffered: true })
      return observer
    } catch {
      return null
    }
  }

  observe('largest-contentful-paint', entries => {
    const latest = entries.at(-1)
    if (latest) lcpValue = latest.startTime
  })
  observe('layout-shift', entries => {
    entries.forEach(entry => {
      if (!entry.hadRecentInput) clsValue += entry.value
    })
  })
  observe('event', entries => {
    entries.forEach(entry => {
      if (entry.duration > inpValue) inpValue = entry.duration
    })
  })
  observe('longtask', entries => {
    entries.filter(entry => entry.duration >= 100).slice(-5).forEach(entry => reporter.record('long_task', entry.duration))
  })

  const flushVitals = () => {
    if (lcpValue > 0) reporter.record('lcp', lcpValue)
    if (clsValue > 0) reporter.record('cls', clsValue)
    if (inpValue > 0) reporter.record('inp', inpValue)
    lcpValue = 0
    clsValue = 0
    inpValue = 0
    reporter.flush()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushVitals()
  })
  window.addEventListener('pagehide', flushVitals)

  return reporter
}
