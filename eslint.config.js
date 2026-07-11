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
