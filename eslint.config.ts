import type {Linter} from 'eslint'

import {makeEslintConfig} from 'eslint-config-jaid'

const config: Array<Linter.Config> = [
  ...makeEslintConfig(),
  {ignores: ['src/lib/procfs/collectorSource.ts']},
]
export default config
