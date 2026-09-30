import type {CSSProperties, FunctionComponent, ReactNode} from 'react'
import type {IconType} from 'react-icons'

import clsx from 'clsx'

import css from './style.module.sass'

type Props = {
  /** CSS custom property name of the accent color, like `--cpu` */
  accent?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
  icon?: IconType
  subtitle?: ReactNode
  title: ReactNode
}

const Panel: FunctionComponent<Props> = ({accent, aside, children, className, icon: Icon, subtitle, title}) => {
  const style = accent ? {'--panel-accent': `var(${accent})`} as CSSProperties : undefined
  return <section className={clsx(css.panel, className)} style={style}>
    <header className={css.header}>
      <h2 className={css.title}>
        {Icon && <Icon className={css.icon} aria-hidden />}
        <span>{title}</span>
        {subtitle && <span className={css.subtitle}>{subtitle}</span>}
      </h2>
      {aside && <div className={css.aside}>{aside}</div>}
    </header>
    <div className={css.body}>{children}</div>
  </section>
}

export default Panel
