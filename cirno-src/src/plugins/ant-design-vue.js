import { defineAsyncComponent, h } from 'vue'
import 'ant-design-vue/dist/reset.css'

function asyncAntComponent(loader, pick = module => module.default) {
  return defineAsyncComponent({
    loader: async () => pick(await loader()),
    delay: 0,
    suspensible: false
  })
}

const componentLoaders = {
  AButton: () => import('ant-design-vue/es/button'),
  ACheckbox: () => import('ant-design-vue/es/checkbox'),
  ADrawer: () => import('ant-design-vue/es/drawer'),
  AInput: () => import('ant-design-vue/es/input'),
  AInputNumber: () => import('ant-design-vue/es/input-number'),
  AInputPassword: () => import('ant-design-vue/es/input'),
  AInputSearch: () => import('ant-design-vue/es/input'),
  AModal: () => import('ant-design-vue/es/modal'),
  APagination: () => import('ant-design-vue/es/pagination'),
  ARadioButton: () => import('ant-design-vue/es/radio'),
  ARadioGroup: () => import('ant-design-vue/es/radio'),
  ASelect: () => import('ant-design-vue/es/select'),
  ASelectOption: () => import('ant-design-vue/es/select'),
  ASkeleton: () => import('ant-design-vue/es/skeleton'),
  ASlider: () => import('ant-design-vue/es/slider'),
  ASpin: () => import('ant-design-vue/es/spin'),
  ATextarea: () => import('ant-design-vue/es/input')
}

const componentPicks = {
  AInputPassword: module => module.InputPassword,
  AInputSearch: module => module.InputSearch,
  ARadioButton: module => module.RadioButton,
  ARadioGroup: module => module.RadioGroup,
  ASelectOption: module => module.SelectOption,
  ATextarea: module => module.Textarea
}

const iconMap = {
  down: 'ri-arrow-down-s-line',
  key: 'ri-key-2-line',
  search: 'ri-search-line',
  smile: 'ri-emotion-happy-line',
  user: 'ri-user-line'
}

const LegacyIcon = {
  name: 'LegacyAIcon',
  inheritAttrs: false,
  props: {
    type: {
      type: String,
      default: ''
    }
  },
  render() {
    const attrs = this.$attrs || {}
    const className = [iconMap[this.type] || `ri-${this.type || 'question'}-line`, attrs.class]
    return h('i', { ...attrs, class: className, 'aria-hidden': attrs['aria-hidden'] || 'true' })
  }
}

let messagePromise
function loadMessage() {
  if (!messagePromise) messagePromise = import('ant-design-vue/es/message').then(module => module.default)
  return messagePromise
}

const lazyMessage = new Proxy({}, {
  get(_target, method) {
    return (...args) => loadMessage().then(api => {
      const handler = api && api[method]
      return typeof handler === 'function' ? handler(...args) : undefined
    })
  }
})

let modalPromise
function lazyConfirm(options) {
  if (!modalPromise) modalPromise = import('ant-design-vue/es/modal').then(module => module.default)
  return modalPromise.then(modal => modal.confirm(options))
}

export default {
  install(app) {
    for (const [name, loader] of Object.entries(componentLoaders)) {
      app.component(name, asyncAntComponent(loader, componentPicks[name]))
    }
    app.component('AIcon', LegacyIcon)
    app.config.globalProperties.$message = lazyMessage
    app.config.globalProperties.$modal = { confirm: lazyConfirm }
    app.config.globalProperties.$confirm = lazyConfirm
  }
}
