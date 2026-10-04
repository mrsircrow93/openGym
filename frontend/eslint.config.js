// Lint for the one class of bug that compiles fine and blanks the screen at runtime: a name used
// without being imported or declared. Kept deliberately small — no style rules.
import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import hooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'ios/**', 'android/**', 'src/lib/exercises-data.js', 'src/names/**'] },
  {
    files: ['src/**/*.{js,jsx}', 'scripts/**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node, ...globals.es2021 } },
    plugins: { react, 'react-hooks': hooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'error',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-cond-assign': 'off',
      'no-prototype-builtins': 'off',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'no-irregular-whitespace': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off'
    }
  },
  // Translation tables: a repeated key is harmless (the later one wins) and the English source
  // string is the key, so warn rather than fail the build.
  { files: ['src/locales/*.js'], rules: { 'no-dupe-keys': 'warn' } }
]
