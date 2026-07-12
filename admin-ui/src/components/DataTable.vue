<template>
  <div class="table-wrap">
    <table :class="tableClass">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :class="{ sortable: column.sort }"
            @click="column.sort && $emit('sort', column.sort)"
          >
            <span>{{ column.label }}</span>
            <span v-if="column.sort" class="sort-arrow">{{ sortMark(column.sort) }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td :colspan="columns.length" class="table-state">加载中...</td>
        </tr>
        <tr v-else-if="!rows.length">
          <td :colspan="columns.length" class="table-state">{{ emptyText }}</td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row[rowKey] ?? row.id ?? JSON.stringify(row)">
            <td v-for="column in columns" :key="column.key" :class="column.cellClass">
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
 * [INPUT]: 依赖列定义、行数据、键生成规则以及父视图提供的表头/单元格插槽
 * [OUTPUT]: 提供统一表格结构、空状态和按列插槽渲染能力
 * [POS]: admin-ui/src/components 的只读展示原语，被列表型管理视图复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  loading: Boolean,
  emptyText: { type: String, default: "暂无数据" },
  rowKey: { type: String, default: "id" },
  sortValue: { type: String, default: "" },
  tableClass: { type: String, default: "" }
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
</script>
