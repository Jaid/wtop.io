export type ArgvMode = 'censored' | 'full' | 'hidden'

export const argvModes: ReadonlyArray<ArgvMode> = ['full', 'censored', 'hidden']

const censorChar = '•'
const maxCensorLength = 24
const mask = (value: string) => censorChar.repeat(Math.min(Math.max(value.length, 1), maxCensorLength))

/**
 * Replaces argument values with bullets while keeping the executable and flag names readable.
 *
 * `["node", "--host=secret", "--port", "8080", "-v"]` becomes `["node", "--host=••••••", "--port", "••••", "-v"]`.
 */
export const censorArgv = (argv: ReadonlyArray<string>): Array<string> => {
  let positional = false
  return argv.map((argument, index) => {
    if (index === 0) {
      return argument
    }
    if (positional) {
      return mask(argument)
    }
    if (argument === '--') {
      positional = true; return argument
    }
    if (argument.startsWith('--')) {
      const equals = argument.indexOf('=')
      return equals === -1 ? argument : argument.slice(0, equals + 1) + (argument.length > equals + 1 ? mask(argument.slice(equals + 1)) : '')
    }
    if (/^-[a-z]/i.test(argument)) {
      return argument.slice(0, 2) + (argument.length > 2 ? mask(argument.slice(2)) : '')
    }
    return mask(argument)
  })
}

/**
 * Quotes an argument for display if it contains whitespace or is empty, so the joined command line stays unambiguous.
 */
const quote = (argument: string) => {
  if (argument === '') {
    return '""'
  }
  if (/\s/.test(argument)) {
    return `"${argument.replaceAll('"', String.raw`\"`)}"`
  }
  return argument
}

export const joinArgv = (argv: ReadonlyArray<string>) => argv.map(quote).join(' ')

/**
 * Applies the configured argv privacy mode.
 *
 * Returns `undefined` if argv should not be shown at all.
 */
export const presentArgv = (argv: ReadonlyArray<string>, mode: ArgvMode): Array<string> | undefined => {
  if (mode === 'hidden') {
    return undefined
  }
  if (mode === 'censored') {
    return censorArgv(argv)
  }
  return [...argv]
}
