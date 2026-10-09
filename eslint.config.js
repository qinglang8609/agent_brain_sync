// eslint.config.js — 扁平配置（ESLint 9）。
// 目标：抓真问题（未使用变量、可疑写法、未定义标识符），不做风格格式化 ——
// 格式交给 Prettier。现有代码里有刻意写长的错误文案行，所以不设 max-len。
import js from '@eslint/js';

export default [
  { ignores: ['node_modules/**', '.brain/**', '.pi-glla/**', '.codegraph/**', '.omo/**', '.claude/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // 未使用变量是本次清理的主目标之一，设成错误。
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // 允许 `obj?.x ?? y` 之类的现代写法；禁止多余的空 catch（除非显式注释）。
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 现有代码大量 `if (x) { ... }` 单行块与必要的降级 catch，不动这些。
      'no-useless-escape': 'warn',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      // 下面三条是项目刻意的做法，不是疏忽：
      //  - 零宽/不可见字符：匹配逻辑要能识别它们（store.js 剥 \u200b、text.js 说明零宽事故）
      //  - `[, t]` 稀疏数组：解构默认值的惯用写法（structure.js）
      //  - 字符类里带变体选择符：真实世界文本会出现，得认
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipComments: true }],
      'no-sparse-arrays': 'off',
      'no-misleading-character-class': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    // store.js 的「先 import 再 export」重导出模式：import 的符号确实在文件内没用到，
    // 但必须 import 才能在作用域里转发出去（文件里有注释说明踩过的坑）。
    files: ['src/store.js'],
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^(cmdLog|cmdNote|cmdConcept|cmdResolve|cmdSupersede|cmdReview|registerInIndex|ensurePersonPage|PAGE_DIRS|idOfPage|backfillPageId|statusOfPage|supersededByOf|resolvePage|collapseIndex|slugOf|PAGE_STATUS|hasTail|foldSameKind|listPages)$' }] },
  },
  {
    // 测试里大量刻意构造的坏输入（零宽字符、控制符、未用变量）是 fixture，不是缺陷。
    files: ['test/**/*.js'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^(ctx|logDir|lines|l|out|dir)$' }],
      'no-irregular-whitespace': 'off',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      'no-sparse-arrays': 'off',
    },
    languageOptions: {
      globals: { describe: 'readonly', it: 'readonly', test: 'readonly', before: 'readonly', after: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' },
    },
  },
];
