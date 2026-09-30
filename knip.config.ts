import type {KnipConfig} from 'knip'

const config: KnipConfig = {
  entry: ['scripts/**/*.ts', 'test/**/*.ts'],
  project: ['src/**/*.{ts,tsx,sass,scss}', 'scripts/**/*.ts', 'test/**/*.ts', '*.config.ts'],
}
export default config
