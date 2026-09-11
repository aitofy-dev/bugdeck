import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['**/dist/**', '**/node_modules/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
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
