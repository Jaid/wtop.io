import type {ConfigEnv, UserConfig} from 'vite'

import babelPlugin from '@rolldown/plugin-babel'
import reactPlugin, {reactCompilerPreset} from '@vitejs/plugin-react'
import postcssAutoprefixer from 'autoprefixer'
import cssnano from 'cssnano-preset-advanced'
import postcssNormalize from 'postcss-normalize'
import {defineConfig, mergeConfig} from 'vite'
import mediaMixinsPlugin from 'vite-plugin-media-mixins'
import titlePlugin from 'vite-plugin-title'

const common: UserConfig = {
  build: {target: 'esnext'},
  resolve: {dedupe: ['react', 'react-dom']},
  plugins: [titlePlugin(), reactPlugin(), babelPlugin({presets: [reactCompilerPreset()]}), mediaMixinsPlugin()],
  css: {postcss: {plugins: [postcssNormalize() as any, postcssAutoprefixer]}},
}
const development = (context: ConfigEnv): UserConfig => ({build: {outDir: `out/build/${context.mode}`}})
const production = (): UserConfig => ({
  build: {
    assetsDir: '',
    emptyOutDir: true,
    rolldownOptions: {output: {
      entryFileNames: 'main.js',
      codeSplitting: {groups: [
        {
          name: 'react',
          test: /[/\\]node_modules[/\\](react(-dom)?|scheduler)[/\\]/,
          priority: 2,
        },
        {
          name: 'vendor',
          test: /[/\\]node_modules[/\\]/,
          priority: 1,
        },
      ]},
      chunkFileNames: chunk => (chunk.name === 'rolldown-runtime' ? 'runtime.js' : '[name]-[hash].js'),
      assetFileNames: asset => (asset.names[0] === 'index.css' ? 'style.css' : '[name]-[hash].[ext]'),
    }},
  },
  css: {postcss: {plugins: cssnano({discardUnused: false}).plugins.filter(([, options]) => !(options && 'exclude' in options && options.exclude)).map(([plugin, options]) => plugin(options))}},
})
export default defineConfig(context => mergeConfig(common, context.mode === 'production' ? production() : development(context)))
