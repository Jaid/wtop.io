import {useEffect} from 'react'
import {FiPlay, FiSettings} from 'react-icons/fi'
import {Link} from 'wouter'

import {useParameters} from '#src/lib/useParameters.ts'
import {buildSearch} from '#src/queryParameters.ts'

import css from './style.module.sass'

const Home = () => {
  const {values, search, errors} = useParameters()
  useEffect(() => {
    document.title = 'Wtop – Linux host monitor'
  }, [])
  const demoSearch = buildSearch({
    ...values,
    host: undefined,
    port: undefined,
    protocol: undefined,
    path: undefined,
    bearer: undefined,
  })
  return <main className={css.home}>
    <img className={css.logo} alt='' src='/icon.svg' />
    <h1>wtop</h1>
    <p className={css.intro}>Your Linux host, at a glance.</p>
    <p>Live resources, containers and processes in your browser. Configure a Docker endpoint or explore the built-in simulation.</p>
    {Object.keys(errors).length > 0 && <p role='status'>The supplied connection parameters need attention. Open setup to review them.</p>}
    <nav className={css.actions} aria-label='Get started'>
      <Link href={`/setup${search ? `?${search}` : ''}`}><FiSettings aria-hidden />Setup</Link>
      <Link href={`/demo${demoSearch}`}><FiPlay aria-hidden />Demo</Link>
    </nav>
  </main>
}
export default Home
