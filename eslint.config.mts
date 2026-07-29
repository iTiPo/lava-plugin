import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_ACRONYMS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
    globalIgnores([
        'node_modules',
        'dist',
        'esbuild.config.mjs',
        'version-bump.mjs',
        'copy-plugin.mjs',
        'versions.json',
        'main.js',
        'package.json',
        'package-lock.json',
        'tsconfig.json',
    ]),

    js.configs.recommended,

    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    {
        languageOptions: {
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
                },
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.json'],
            },
        },
    },

    ...obsidianmd.configs.recommended,

    {
        rules: {
            'obsidianmd/ui/sentence-case': [
                'warn',
                {
                    acronyms: [...DEFAULT_ACRONYMS, 'MCP', 'SSE'],
                    brands: [
                        ...DEFAULT_BRANDS,
                        'OAuth',
                        'Streamable',
                        'Agent',
                        'Ask',
                    ],
                    ignoreRegex: ['^https?://'],
                },
            ],
        },
    },
);
