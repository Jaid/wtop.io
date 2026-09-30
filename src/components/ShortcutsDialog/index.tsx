import type {FunctionComponent} from 'react'

import {useEffect, useRef} from 'react'
import {FiX} from 'react-icons/fi'

import css from './style.module.sass'

type Props = {
  destructive: boolean
  onClose: () => void
  open: boolean
}

const shortcuts: Array<[keys: Array<string>, description: string]> = [
  [['Space'], 'pause or resume updates'],
  [['F'], 'focus the process filter'],
  [['↑', '↓'], 'select the previous or next process'],
  [['PgUp', 'PgDn', 'Home', 'End'], 'jump through the process list'],
  [['←', '→'], 'collapse or expand the selected branch in tree mode'],
  [['Esc'], 'close details, clear the filter'],
  [['T'], 'toggle tree mode'],
  [['K'], 'toggle kernel threads'],
  [['C', 'M', 'P', 'N'], 'sort by CPU, memory, PID or name'],
  [['?'], 'show this help'],
]
const ShortcutsDialog: FunctionComponent<Props> = ({destructive, onClose, open}) => {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) {
      return
    }
    if (open && !dialog.open) {
      dialog.showModal?.()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])
  return <dialog className={css.dialog} ref={ref} onClick={event => event.target === ref.current && onClose()} onClose={onClose}>
    <div className={css.content}>
      <header className={css.header}>
        <h2>Keyboard shortcuts</h2>
        <button className={css.close} aria-label='Close' type='button' onClick={onClose}><FiX /></button>
      </header>
      <dl className={css.list}>
        {shortcuts.map(([keys, description]) => <div key={description} className={css.item}>
          <dt>{keys.map(key => <kbd key={key}>{key}</kbd>)}</dt>
          <dd>{description}</dd>
        </div>)}
      </dl>
      <p className={css.note}>{destructive ? 'Signals are sent from the process details. Every signal button asks for a second click to confirm.' : 'This dashboard is read-only. Enable destructive actions in the setup to send signals to processes.'}</p>
    </div>
  </dialog>
}

export default ShortcutsDialog
