import type {BunPlugin} from 'bun'

const sassModulesPlugin: BunPlugin = {name: 'test-sass-modules', setup(build) {
  build.onLoad({filter: /\.module\.sass$/}, async args => {
    const source = await Bun.file(args.path).text()
    const classNames = [...new Set(Array.from(source.matchAll(/^\s*\.([A-Z_a-z][\w-]*)/gm), match => match[1]))]
    return {
      contents: `export default ${JSON.stringify(Object.fromEntries(classNames.map(className => [className, className])))}`,
      loader: 'js',
    }
  })
}}
export default sassModulesPlugin
