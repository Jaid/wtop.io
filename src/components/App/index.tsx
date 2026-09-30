import type {FunctionComponent} from 'react'

import {Link, Route, Switch} from 'wouter'

import Dashboard from '#component/Dashboard'
import Setup from '#component/Setup'
import {ToastProvider} from '#component/Toasts'
import {TooltipProvider} from '#component/Tooltip'

import css from './style.module.sass'

const NotFound: FunctionComponent = () => <div className={css.notFound}>
  <h1>Not found</h1>
  <p>This page does not exist.</p>
  <p><Link href='/setup'>Go to the setup</Link> or <Link href='/demo'>try the demo</Link>.</p>
</div>
const App: FunctionComponent = () => <div className={css.container}>
  <TooltipProvider>
    <ToastProvider>
      <Switch>
        <Route path='/setup'><Setup /></Route>
        <Route path='/demo'><Dashboard demo /></Route>
        <Route path='/'><Dashboard /></Route>
        <Route><NotFound /></Route>
      </Switch>
    </ToastProvider>
  </TooltipProvider>
</div>

export default App
