import axios from 'axios'

axios.defaults.timeout = 30000
axios.defaults.baseURL = ''
axios.defaults.baseUrl = ''

let vm = null

const ok = data => ({ code: 100000, data, tip: 'ok' })
const fail = tip => Promise.reject({ code: -1, tip })

function textFromHtml(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|li|tr|h[1-6])>/gi, '\n')
    .replace(/<(?:p|div|section|article|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/\n[ \t\f\v]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function normalizePlatform(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function isIhuabenChapter(row = {}) {
  const platform = normalizePlatform(row.platform || row.book_platform)
  const detailUrl = String(row.detail_url || row.detailUrl || '')
  const html = String(row.html || '')
  return (
    platform === 'ihuaben' ||
    platform === 'huaben' ||
    platform === '话本' ||
    /ihuaben\.com/i.test(detailUrl) ||
    /hbu-chapter-style/i.test(html)
  )
}

function normalizeBook(row = {}) {
  return {
    id: row.id || row.book_id,
    last_read_chapter_id: row.last_chapter_id || row.last_read_chapter_id || row.chapter_id || 0,
    last_read_at: row.last_read_at || '',
    shelved_at: row.shelved_at || '',
    reading_seconds: row.reading_seconds || 0,
    book_info: {
      book_id: String(row.book_id || ''),
      book_name: row.title || row.book_name || row.book_id || '',
      author_name: row.author || row.author_name || '佚名',
      cover: row.cover || '',
      uptime: row.updated_at || row.latest_chapter_date || '',
      description: row.description || '',
      tags: row.tags || '',
      category: row.category || '',
      status: row.status || '',
      word_count: row.word_count || 0,
      free_chapters: row.free_chapters || 0,
      paid_chapters: row.paid_chapters || 0,
      total_chapters: row.total_chapters || 0,
      subscribed_chapters: row.subscribed_chapters || 0,
      latest_chapter_name: row.latest_chapter_name || '',
      latest_chapter_date: row.latest_chapter_date || '',
      total_popularity: row.total_popularity || 0,
      monthly_popularity: row.monthly_popularity || 0,
      weekly_popularity: row.weekly_popularity || 0,
      daily_popularity: row.daily_popularity || 0,
      favorites_count: row.favorites_count || 0,
      comments_count: row.comments_count || 0,
      readers_count: row.readers_count || 0,
      detail_url: row.detail_url || '',
      cache_count: row.cache_count || 0,
      created_at: row.created_at || '',
      updated_at: row.updated_at || '',
      platform: row.platform || ''
    }
  }
}

function normalizeChapter(row = {}) {
  return {
    id: row.id || row.chapter_id,
    book_id: String(row.book_id || ''),
    chapter_id: String(row.chapter_id || ''),
    chapter_title: row.title || row.chapter_title || row.chapter_id || '',
    chapter_order: row.chapter_order || 0,
    is_volume: !!(row.is_volume || row.isVolume),
    uploader: row.uploader || '',
    uploaderId: row.uploaderId || row.uploader_id || '',
    platform: row.platform || '',
    html_length: row.html_length || 0,
    created_at: row.created_at || '',
    update_time: row.updated_at || '',
    updated_at: row.updated_at || '',
    division_id: row.book_id || ''
  }
}

async function localApi(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw data
  return data
}

async function get(obj = {}) {
  const url = obj.url
  const p = obj.urlParas || {}

  try {
    switch (url) {
      case '/signup/login': {
        const data = await localApi('/reader-auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: p.login_name, password: p.passwd })
        })
        const user = data.user || {}
        return ok({
          login_token: 'local-session',
          reader_info: {
            reader_id: user.id || 0,
            reader_name: user.nickname || user.username || p.login_name,
            account: user.username || p.login_name,
            avatar_thumb_url: user.avatar_url || '',
            membership_expires_at: user.membership_expires_at || null,
            membership_permanent: !!user.membership_permanent,
            library_access: user.library_access !== false,
            copper_coins: user.copper_coins || 0,
            silver_coins: user.silver_coins || 0,
            sign_cycle_day: user.sign_cycle_day || 0,
            last_sign_date: user.last_sign_date || null
          },
          prop_info: { rest_hlb: 0, rest_recommend: 0, rest_month_ticket: 0 }
        })
      }
      case '/reader/get_my_info': {
        const me = await localApi('/reader-auth/me')
        if (!me.user) throw { error: '请先登录' }
        const user = me.user
        return ok({
          reader_info: {
            reader_id: user.id || 0,
            reader_name: user.nickname || user.username || '本地读者',
            account: user.username || '',
            avatar_thumb_url: user.avatar_url || '',
            membership_expires_at: user.membership_expires_at || null,
            membership_permanent: !!user.membership_permanent,
            library_access: user.library_access !== false,
            copper_coins: user.copper_coins || 0,
            silver_coins: user.silver_coins || 0,
            sign_cycle_day: user.sign_cycle_day || 0,
            last_sign_date: user.last_sign_date || null
          },
          prop_info: { rest_hlb: 0, rest_recommend: 0, rest_month_ticket: 0 }
        })
      }
      case '/task/get_sign_record': {
        const me = await localApi('/reader-auth/me')
        const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const signed = me.user && me.user.last_sign_date && String(me.user.last_sign_date).slice(0, 10) === today
        const list = Array.from({ length: 7 }, () => ({ is_signed: '0' }))
        const dayArr = [6, 0, 1, 2, 3, 4, 5]
        list[dayArr[new Date().getDay()]].is_signed = signed ? '1' : '0'
        return ok({ sign_record_list: list })
      }
      case '/reader/get_task_bonus_with_sign_recommend': {
        const data = await localApi('/reader-auth/sign', { method: 'POST' })
        return ok({
          bonus: { copper: data.reward.copper, silver: data.reward.silver, sign_day: data.reward.day },
          reader_info: {
            reader_id: data.user.id || 0,
            reader_name: data.user.nickname || data.user.username || '本地读者',
            account: data.user.username || '',
            avatar_thumb_url: data.user.avatar_url || '',
            membership_expires_at: data.user.membership_expires_at || null,
            membership_permanent: !!data.user.membership_permanent,
            library_access: data.user.library_access !== false,
            copper_coins: data.user.copper_coins || 0,
            silver_coins: data.user.silver_coins || 0,
            sign_cycle_day: data.user.sign_cycle_day || 0,
            last_sign_date: data.user.last_sign_date || null
          },
          prop_info: { rest_hlb: 0, rest_recommend: 0, rest_month_ticket: 0 }
        })
      }
      case '/bookshelf/get_shelf_list': {
        return ok({ shelf_list: [{ shelf_id: 'local', shelf_name: '我的书架' }] })
      }
      case '/bookshelf/get_shelf_book_list_new': {
        const query = new URLSearchParams()
        if (p.order) query.set('order', p.order)
        if (p.sort) query.set('sort', p.sort)
        if (p.idsOnly || p.ids_only || p.onlyIds || p.only_ids) query.set('idsOnly', '1')
        const limit = p.limit !== undefined && p.limit !== null ? p.limit : p.count
        if (limit !== undefined && limit !== null && limit !== '') query.set('limit', limit)
        if (p.page !== undefined && p.page !== null && p.page !== '') {
          query.set('page', Math.max(1, Number(p.page) || 1))
        }
        const suffix = query.toString() ? `?${query.toString()}` : ''
        const data = await localApi(`/reader-api/me/bookshelf${suffix}`)
        const rows = data.rows || []
        return ok({ book_list: rows.map(normalizeBook) })
      }
      case '/book/search': {
        const query = new URLSearchParams()
        if (p.keyword) query.set('keyword', p.keyword)
        if (p.q) query.set('q', p.q)
        if (p.author) query.set('author', p.author)
        if (p.tag) query.set('tag', p.tag)
        if (p.platform) query.set('platform', p.platform)
        if (p.sort) query.set('sort', p.sort)
        if (p.word_min !== undefined && p.word_min !== null) query.set('word_min', p.word_min)
        if (p.word_max !== undefined && p.word_max !== null) query.set('word_max', p.word_max)
        if (p.cache_min !== undefined && p.cache_min !== null) query.set('cache_min', p.cache_min)
        if (p.cache_max !== undefined && p.cache_max !== null) query.set('cache_max', p.cache_max)
        if (p.popularity_min !== undefined && p.popularity_min !== null) query.set('popularity_min', p.popularity_min)
        if (p.popularity_max !== undefined && p.popularity_max !== null) query.set('popularity_max', p.popularity_max)
        query.set('limit', p.limit || 50)
        query.set('page', p.page || 1)
        const data = await localApi(`/reader-api/search?${query.toString()}`)
        return ok({
          book_list: (data.rows || []).map(normalizeBook),
          total: data.total || 0,
          page: data.page || 1,
          limit: data.limit || Number(p.limit || 50)
        })
      }
      case '/book/get_info_by_id': {
        const data = await localApi(`/reader-api/books/${encodeURIComponent(p.book_id)}`)
        const b = data.book || {}
        return ok({
          book_info: {
            book_id: String(b.book_id || ''),
            book_name: b.title || b.book_id || '',
            author_name: b.author || '佚名',
            cover: b.cover || '',
            uptime: b.updated_at || '',
            description: b.description || '',
            tags: b.tags || '',
            category: b.category || '',
            status: b.status || '',
            word_count: b.word_count || 0,
            free_chapters: b.free_chapters || 0,
            paid_chapters: b.paid_chapters || 0,
            total_chapters: b.total_chapters || 0,
            subscribed_chapters: b.subscribed_chapters || 0,
            latest_chapter_name: b.latest_chapter_name || '',
            latest_chapter_date: b.latest_chapter_date || '',
            total_popularity: b.total_popularity || 0,
            monthly_popularity: b.monthly_popularity || 0,
            weekly_popularity: b.weekly_popularity || 0,
            daily_popularity: b.daily_popularity || 0,
            favorites_count: b.favorites_count || 0,
            comments_count: b.comments_count || 0,
            readers_count: b.readers_count || 0,
            detail_url: b.detail_url || '',
            cache_count: b.cache_count || 0,
            created_at: b.created_at || '',
            updated_at: b.updated_at || '',
            platform: b.platform || ''
          }
        })
      }
      case '/book/get_division_list': {
        return ok({ division_list: [{ division_id: String(p.book_id), division_name: '正文' }] })
      }
      case '/chapter/get_updated_chapter_by_division_id': {
        const data = await localApi(`/reader-api/books/${encodeURIComponent(p.division_id)}/chapters`)
        return ok({ chapter_list: (data.rows || []).map(normalizeChapter) })
      }
      case '/chapter/get_chapter_cmd': {
        return ok({ command: 'local-plain-text' })
      }
      case '/chapter/get_cpt_ifm': {
        const bookId = window.__cirnoCurrentBookId || p.book_id || ''
        const chapterId = p.chapter_id
        const data = await localApi(
          `/reader-api/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`
        )
        const c = data.chapter || {}
        const isIhuaben = isIhuabenChapter(c)
        if (c.is_volume || c.isVolume) {
          return ok({
            chapter_info: {
              chapter_id: String(c.chapter_id || ''),
              chapter_title: c.title || c.chapter_id || '',
              txt_content: '',
              html_content: '',
              author_say: '',
              auth_access: 1,
              unit_hlb: 0,
              buy_amount: 0,
              is_local_plain: true,
              is_volume: true
            }
          })
        }
        return ok({
          chapter_info: {
            chapter_id: String(c.chapter_id || ''),
            chapter_title: c.title || c.chapter_id || '',
            txt_content: isIhuaben ? '' : c.text || textFromHtml(c.html),
            html_content: c.html || '',
            author_say: '',
            auth_access: 1,
            unit_hlb: 0,
            buy_amount: 0,
            is_local_plain: true,
            is_ihuaben: isIhuaben,
            platform: c.platform || c.book_platform || '',
            is_volume: false
          }
        })
      }
      case '/chapter/get_tsukkomi_num': {
        return ok({ tsukkomi_num_info: [] })
      }
      case '/chapter/get_paragraph_tsukkomi_list_new': {
        return ok({ tsukkomi_list: [] })
      }
      case '/bookshelf/set_last_read_chapter': {
        await localApi('/reader-api/me/history', {
          method: 'POST',
          body: JSON.stringify({
            bookId: p.book_id,
            chapterId: p.last_read_chapter_id,
            progress: 0,
            readingSeconds: p.reading_seconds || 0
          })
        }).catch(() => null)
        return ok({})
      }
      case '/chapter_buy':
      case '/chapter/like_tsukkomi':
      case '/chapter/unlike_tsukkomi': {
        return ok({ prop_info: {}, reader_info: {} })
      }
      case '/meta/get_meta_data': {
        return ok({ meta_data: { local: true } })
      }
      default:
        return fail(`未适配接口：${url}`)
    }
  } catch (err) {
    const messageApi = vm && vm.config && vm.config.globalProperties && vm.config.globalProperties.$message
    if (messageApi) messageApi.error(err.error || err.tip || err.message || '请求失败')
    return Promise.reject(err.error || err.tip || err.message || '请求失败')
  }
}

async function post(obj = {}) {
  try {
    if (obj.url === '/signup/register') {
      const body = Object.assign({}, obj.paras || {})
      if (body.cdk)
        body.cdk = String(body.cdk)
          .trim()
          .toUpperCase()
      const data = await localApi('/reader-auth/register', {
        method: 'POST',
        body: JSON.stringify(body)
      })
      return ok(data)
    }
    if (obj.url === '/bookshelf/add') {
      const bookId = (obj.paras && (obj.paras.book_id || obj.paras.bookId)) || ''
      if (!bookId) return fail('缺少书号')
      const data = await localApi(`/reader-api/me/bookshelf/${encodeURIComponent(bookId)}`, { method: 'POST' })
      return ok(data)
    }
    if (obj.url === '/bookshelf/remove') {
      const bookId = (obj.paras && (obj.paras.book_id || obj.paras.bookId)) || ''
      if (!bookId) return fail('缺少书号')
      const data = await localApi(`/reader-api/me/bookshelf/${encodeURIComponent(bookId)}`, { method: 'DELETE' })
      return ok(data)
    }
    const data = await localApi(obj.url, { method: 'POST', body: JSON.stringify(obj.paras || {}) })
    return data
  } catch (err) {
    const messageApi = vm && vm.config && vm.config.globalProperties && vm.config.globalProperties.$message
    if (messageApi) messageApi.error(err.error || err.tip || err.message || '请求失败')
    return Promise.reject(err.error || err.tip || err.message || '请求失败')
  }
}

async function patch(options) {
  return localApi(options.url, { method: 'PATCH', body: JSON.stringify(options.data || {}) })
}

function put(options) {
  return axios.put(options.url, options.data).then(response => response.data)
}

function install(app) {
  vm = app
  if (install.installed) return
  install.installed = true
  app.config.globalProperties.$post = post
  app.config.globalProperties.$get = get
  app.config.globalProperties.$patch = patch
  app.config.globalProperties.$put = put
}

export default { install, version: 'local-po18-adapter' }
