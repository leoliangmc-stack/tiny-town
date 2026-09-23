import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', '.vercel'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/simulation/**/*.ts'],
    rules: {
      // Hard architectural rule from SPEC.md 3.2: the simulation must run in
      // Node with no renderer attached.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*', '**/render/*'],
              message: 'src/simulation must stay free of Three.js and of the render layer.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
