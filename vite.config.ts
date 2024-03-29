import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// https://vitejs.dev/config/
export default defineConfig({
    root: 'src/client',
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.argv.includes('--env=prod') ? 'production' : 'dev'),
    },
    plugins: [
        vue(),
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src/client', import.meta.url))
        }
    },
    build: {
        outDir: 'dist/public',
        lib: {
            entry: resolve(__dirname, 'src', 'client', 'index.ts'),
            name: 'OCTranslator',
            formats: ['es']
        },
        rollupOptions: {
            external: [],
            output: {
                assetFileNames: '[ext]/[name][extname]',
                chunkFileNames: 'js/vendors/[name]-[hash].js',
                entryFileNames: 'js/[name].js',
                dir: 'dist/public',
                format: 'es',
                globals: {},
                plugins: [
                    {
                        name: 'public',
                        writeBundle() {
                            cpSync(
                                resolve(process.cwd(), 'src/client/index-prod.html'),
                                join(process.cwd(), 'dist', 'public', 'index.html')
                            )
                        }
                    }
                ]
            }
        },
        copyPublicDir: false
    },
    server: {
        port: 3006
    }
});
