/**
 * [INPUT]: 依赖 ESLint flat config 与 globals，读取根、Bot、Docker、routes、services、scripts、tests 和前端源码
 * [OUTPUT]: 对外提供 CommonJS/ESM/浏览器分层的静态语义检查配置及生成目录忽略边界
 * [POS]: 根级代码质量配置，让多运行时子项目共享最低正确性规则而不扫描构建产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const globals = require("globals");

const nodeGlobals = {
    ...globals.node,
    AbortController: "readonly",
    Blob: "readonly",
    fetch: "readonly",
    FormData: "readonly",
    Headers: "readonly",
    Request: "readonly",
    Response: "readonly"
};

module.exports = [
    {
        ignores: ["**/node_modules/**", "admin-ui/dist/**", "cirno-src/dist*/**", "public/**", "backups/**", "test-results/**", "tmp/**"]
    },
    {
        files: [
            "*.js",
            "bot/**/*.js",
            "db/**/*.js",
            "docker/**/*.js",
            "routes/**/*.js",
            "scripts/**/*.js",
            "services/**/*.js",
            "tests/**/*.js"
        ],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "commonjs",
            globals: nodeGlobals
        },
        rules: {
            "no-dupe-keys": "error",
            "no-undef": "error",
            "no-unreachable": "error",
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
        }
    },
    {
        files: ["scripts/**/*.mjs", "admin-ui/src/**/*.js", "cirno-src/src/**/*.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: { ...globals.browser, ...nodeGlobals }
        }
    },
    {
        files: ["tests/smoke/**/*.js"],
        languageOptions: {
            globals: globals.browser
        }
    }
];
