import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        // A node script that drives a browser: it names globals from both sides.
        files: ['**/e2e/*.mjs'],
        languageOptions: {
            globals: {
                AbortSignal: 'readonly',
                Image: 'readonly',
                console: 'readonly',
                document: 'readonly',
                fetch: 'readonly',
                process: 'readonly',
            },
        },
    },
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            // `typeof import('x')` is how an optional dependency is typed
            // without importing it at load time.
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { disallowTypeAnnotations: false },
            ],
        },
    },
);
