import 'antimono/css/antimono-static.css'
import './style.sass'

import mountRoot from 'mount-root'

import App from '#component/App'

import css from './style.module.sass'

mountRoot(App, {
  id: css.container,
  strict: import.meta.env.DEV,
})
