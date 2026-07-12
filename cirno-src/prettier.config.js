/**
 * [INPUT]: 依赖 Prettier 与 Reader Vue/JS/CSS 文件类型
 * [OUTPUT]: 对外提供 Reader 子项目统一格式化配置
 * [POS]: cirno-src 的源码格式约定，避免与根构建行为耦合
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
module.exports = {
  // tab缩进大小,默认为2
  tabWidth: 2,
  // 使用tab缩进，默认false
  useTabs: false,
  // 使用分号, 默认true
  semi: false,
  // 使用单引号, 默认false(在jsx中配置无效, 默认都是双引号)
  singleQuote: true,
  // 行尾逗号,默认none,可选 none|es5|all
  // es5 包括es5中的数组、对象
  // all 包括函数对象等所有可选
  trailingComma: 'none',
  // 对象中的空格 默认true
  // true: { foo: bar }
  // false: {foo: bar}
  bracketSpacing: true,
  // JSX标签闭合位置 默认false
  // false: <div
  //          className=""
  //          style={{}}
  //       >
  // true: <div
  //          className=""
  //          style={{}} >
  bracketSameLine: false,
  // 箭头函数参数括号 默认avoid 可选 avoid| always
  // avoid 能省略括号的时候就省略 例如x => x
  // always 总是有括号
  arrowParens: 'avoid',
  //html 模板设置
  htmlWhitespaceSensitivity: 'ignore',
  proseWrap: 'preserve',
  printWidth: 120 //默认为80
}
