import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

export default tseslint.config(
  // `backend/` is a separate deployable project (Cloudflare Workers) with
  // its own tsconfig and runtime globals (D1, cloudflare:test) — it is
  // typechecked and tested independently (see backend/package.json), not
  // linted by this frontend config.
  { ignores: ['dist', 'node_modules', 'android', 'ios', 'backend'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, jsxA11y.flatConfigs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'jsx-a11y/no-autofocus': 'off'
    }
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs'
    }
  }
)
