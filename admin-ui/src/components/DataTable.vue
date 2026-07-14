<template>
  <div class="table-wrap" :aria-busy="loading ? 'true' : 'false'">
    <table :class="tableClass">
      <caption v-if="caption" class="sr-only">{{ caption }}</caption>
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            :class="{ sortable: column.sort }"
            :aria-sort="column.sort ? ariaSort(column.sort) : undefined"
          >
            <button
              v-if="column.sort"
              class="table-sort-button"
              type="button"
              :aria-label="sortLabel(column)"
              @click="$emit('sort', column.sort)"
            >
              <span>{{ column.label }}</span>
              <span class="sort-arrow" aria-hidden="true">{{ sortMark(column.sort) }}</span>
            </button>
            <span v-else>{{ column.label }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading">
          <tr v-for="rowIndex in 3" :key="`loading-${rowIndex}`" class="table-skeleton-row" aria-hidden="true">
            <td v-for="column in columns" :key="column.key"><span class="table-skeleton"></span></td>
          </tr>
          <tr class="sr-only"><td :colspan="columns.length">加载中...</td></tr>
        </template>
        <tr v-else-if="!rows.length">
          <td :colspan="columns.length" class="table-state">{{ emptyText }}</td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row[rowKey] ?? row.id ?? JSON.stringify(row)">
            <td v-for="column in columns" :key="column.key" :class="column.cellClass" :data-label="column.label">
              <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">
                {{ row[column.key] ?? "-" }}
              </slot>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup>
/**
 * [INPUT]: 依赖列定义、行数据、排序状态、键生成规则以及父视图提供的单元格插槽
 * [OUTPUT]: 提供支持键盘排序、加载骨架、无障碍状态与按列插槽渲染的统一数据表格
 * [POS]: admin-ui/src/components 的列表展示原语，为管理视图收敛表头语义、空态和排序交互
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  loading: Boolean,
  emptyText: { type: String, default: "暂无数据" },
  rowKey: { type: String, default: "id" },
  sortValue: { type: String, default: "" },
  tableClass: { type: String, default: "" },
  caption: { type: String, default: "" }
});

defineEmits(["sort"]);

function sortMark(sort) {
  if (!sort) return "";
  const asc = sort.endsWith("_asc") ? sort : sort.replace("_desc", "_asc");
  const desc = sort.endsWith("_desc") ? sort : sort.replace("_asc", "_desc");
  if (props.sortValue === desc) return "↓";
  if (props.sortValue === asc) return "↑";
  return "↕";
}

function ariaSort(sort) {
  if (props.sortValue === sort) return sort.endsWith("_asc") ? "ascending" : "descending";
  const counterpart = sort.endsWith("_asc") ? sort.replace("_asc", "_desc") : sort.replace("_desc", "_asc");
  if (props.sortValue === counterpart) return counterpart.endsWith("_asc") ? "ascending" : "descending";
  return "none";
}

function sortLabel(column) {
  const state = ariaSort(column.sort);
  const next = state === "ascending" ? "降序" : "升序";
  return `${column.label}，当前${state === "none" ? "未排序" : state === "ascending" ? "升序" : "降序"}，点击按${next}排列`;
}
</script>
