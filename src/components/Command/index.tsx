import type {ArgvMode} from '#src/lib/argv.ts'
import type {ProcessRow} from '#src/lib/monitor/types.ts'

import {presentArgv} from '#src/lib/argv.ts'
import {commandTokens} from '#src/lib/commandTokens.ts'

import css from './style.module.sass'

const Command = ({process, mode}: {
  mode: ArgvMode
  process: ProcessRow
}) => {
  const argv = presentArgv(process.argv, mode)
  if (!argv) {
    return null
  }
  const tokens = commandTokens(argv, process.isKernelThread ? process.name : undefined)
  return <span className={css.command}>{tokens.map((token, index) => <span key={index} className={css[token.kind]} data-token={token.kind}>{token.text}</span>)}</span>
}
export default Command
