import { h } from 'vue'
import 'ant-design-vue/dist/reset.css'
import {
  Affix,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Input,
  InputNumber,
  Menu,
  Modal,
  Pagination,
  Popover,
  Radio,
  Select,
  Skeleton,
  Slider,
  Spin,
  message
} from 'ant-design-vue'

const components = [
  Affix,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Input,
  InputNumber,
  Menu,
  Modal,
  Pagination,
  Popover,
  Radio,
  Select,
  Skeleton,
  Slider,
  Spin
]

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

export default {
  install(app) {
    components.forEach(component => app.use(component))
    app.component('AIcon', LegacyIcon)
    app.config.globalProperties.$message = message
    app.config.globalProperties.$modal = Modal
    app.config.globalProperties.$confirm = Modal.confirm
  }
}
