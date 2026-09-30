export type CommandToken = {
  kind: 'directory' | 'executable' | 'flag' | 'kernel' | 'operator' | 'value'
  text: string
}

/** Presentation only: argv boundaries are already known; never parse or execute shell code. */
export const commandTokens = (argv: ReadonlyArray<string>, kernelName?: string): Array<CommandToken> => {
  if (!argv.length) {
    if (!kernelName) {
      return []
    }
    const [name, ...rest] = kernelName.split(/(?=[/:])/)
    return [{
      kind: 'operator',
      text: '[',
    }, {
      kind: 'kernel',
      text: name,
    }, {
      kind: 'directory',
      text: rest.join(''),
    }, {
      kind: 'operator',
      text: ']',
    }]
  }
  const result: Array<CommandToken> = []
  let positional = false
  for (const [index, argument] of argv.entries()) {
    if (index) {
      result.push({
        kind: 'operator',
        text: ' ',
      })
    }
    const quoted = argument === '' || /\s/.test(argument)
    if (quoted) {
      result.push({
        kind: 'operator',
        text: '"',
      })
    }
    const add = (kind: CommandToken['kind'], text: string) => {
      result.push({
        kind,
        text: quoted ? text.replaceAll('"', String.raw`\"`) : text,
      })
    }
    if (index === 0) {
      const slash = argument.lastIndexOf('/')
      if (slash !== -1) {
        add('directory', argument.slice(0, slash + 1))
      }
      add('executable', argument.slice(slash + 1))
    } else if (!positional && argument === '--') {
      add('operator', argument); positional = true
    } else if (!positional && /^--?[A-Za-z]/.test(argument)) {
      const equals = argument.indexOf('=')
      if (equals !== -1) {
        add('flag', argument.slice(0, equals)); add('operator', '='); add('value', argument.slice(equals + 1))
      } else if (!argument.startsWith('--') && argument.length > 2) {
        add('flag', argument.slice(0, 2)); add('value', argument.slice(2))
      } else {
        add('flag', argument)
      }
    } else {
      add('value', argument)
    }
    if (quoted) {
      result.push({
        kind: 'operator',
        text: '"',
      })
    }
  }
  return result
}
