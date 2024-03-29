
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';

/** @type {import('rollup').RollupOptions} */
export default {
    input: 'src/server/index.ts',
    output: {
        exports: 'named',
        file: 'dist/server.js',
        format: 'es'
    },
    external: [
        /node_modules/
    ],
    plugins: [
        commonjs(),
        resolve({
            preferBuiltins: true
        }),
        typescript({
            tsconfig: 'tsconfig.node.json'
        }),
        json()
    ]
};
