import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: [
      'src/lib/forge-**/*.{ts,tsx}',
      'src/lib/forge_*.{ts,tsx}',
      'src/hooks/use-forge-*.{ts,tsx}',
      'src/components/forge/**/*.{ts,tsx}',
      'src/routes/forge*.tsx',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@/lib/spec-builder/contract',
            importNames: ['writeSpecContract', 'SpecContractPatch'],
            message: 'Forge modules must not import the spec-builder writer. Use loadSpecContract (reader) only.',
          },
        ],
      }],
    },
  },
])
