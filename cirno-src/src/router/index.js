/**
 * [INPUT]: 依赖 vue-router、Reader 会话探测工具与 views 下的懒加载页面
 * [OUTPUT]: 默认导出带登录门禁和裸路径兼容的 Hash Router 实例
 * [POS]: cirno-src/src/router 的导航事实源，集中裁决公开页、登录页与受保护页跳转
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import { hasReaderSession } from '@/utils/reader-session'

function redirectBareReaderPathToHashRoute() {
  if (typeof window === 'undefined' || window.location.hash) return

  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'
  const hashRoutes = ['/book', '/library']

  for (const routePath of hashRoutes) {
    const barePath = `${base}${routePath}`.replace(/\/{2,}/g, '/')
    if (currentPath === barePath) {
      const targetBase = base || ''
      window.location.replace(`${targetBase}/#${routePath}${window.location.search || ''}`)
      return
    }
  }
}

redirectBareReaderPathToHashRoute()

const routes = [
  {
    path: '/detail',
    name: 'BookDetail',
    component: () => import('../views/BookDetail.vue')
  },
  {
    path: '/book',
    name: 'Book',
    component: () => import('../views/Reader.vue')
  },
  {
    path: '/library',
    name: 'BookLibrary',
    component: () => import('../views/BookLibrary.vue')
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings.vue')
  },
  {
    path: '/',
    name: 'Index',
    component: () => import('../views/Index.vue')
  },
  {
    path: '/about',
    name: 'About',
    component: () => import('../views/About.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach(async to => {
  const isLoginPage = to.name === 'Login'
  const hasLogin = await hasReaderSession()

  if (!hasLogin && !isLoginPage) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }

  if (hasLogin && isLoginPage) {
    return { name: 'Index' }
  }
})

export default router
