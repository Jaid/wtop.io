# Wtop

A browser-native monitor for Linux hosts, using the Docker Engine API as its only transport. The dashboard runs as a static web app. A short-lived, shared collector reads the host's process and hardware counters without publishing another port.

## use

Open **/setup**, enter the Docker API endpoint, save its Bearer token locally, and open the dashboard. **/demo** runs the same interface against a deterministic simulated server without contacting Docker. **/** redirects to setup when a host is missing.

The interface includes CPU/core charts, memory and swap, network and disk rates, filesystems, temperature and fan sensors, GPU availability, Linux pressure information, container summaries, a virtualized process table, process trees, filters, keyboard shortcuts and guarded signal controls. It adapts to desktop, tile and phone layouts and both system color schemes.

**Docker API access is root-equivalent.** Use an authenticated endpoint on a trusted network with a narrowly allowed browser origin. The read-only UI setting is not an authorization boundary. See [deployment and security](docs/deployment.md) before exposing a Docker socket.

## develop

Bun 1.4.2 is the pinned runtime. No private Mage packages or source checkout are required.

~~~sh
bun install --frozen-lockfile
bun run dev
bun run lint
bun run test
bun run test:browser
bun run test:collector
~~~

The browser suite requires Chrome, Chromium or Brave; set BROWSER_PATH when automatic discovery is insufficient. The collector suite runs in a disposable Docker container; it needs Docker but not a local Python installation. It also works with a remote Docker daemon because test sources are streamed, not bind-mounted.

Production: **bun run build** writes **dist/**. Development artifacts go to **out/build/development/**. **bun run preview** serves the production build. **bun run validate** checks lint, unit/DOM tests and production browser behavior. Collector and opt-in live-host checks remain explicit.

## parameters

| Parameter | Default | Meaning |
| --- | --- | --- |
| host | absent | Docker API hostname or IP address; separate from scheme and port |
| protocol / port | http / 2375 | Endpoint scheme and port |
| path | empty | Optional reverse-proxy API prefix |
| bearer | absent | Explicit URL token, supported but discouraged; saved endpoint token otherwise |
| interval / history | 1000 / 120 | Poll interval in milliseconds; graph history in seconds |
| argv | full | full, censored or hidden; filtering occurs in the collector before transfer |
| destructive / sound | false / false | Explicit signal controls; optional sound cues |
| tree / kernel / agent | false / false / false | Tree view; show kernel threads; show collector processes |
| sort / reverse / filter | cpu / false / empty | Sort column, inverted direction and process filter |
| image | python:3.14-alpine | Collector image with Python 3.9+; tag or SHA-256 digest supported |
| lifetime | 120 | Idle collector lease in seconds |
| addressSpace | auto | auto, local, loopback or public; explicit override for split-horizon DNS |

Filters support free text and user:, pid:, ppid:, container:, state: and name: fields. Container chips set a stable container-ID filter. Sort columns include cpu, memory, io, pid, name, user, container, threads, state, age and command.

Shared links never include a token, even when setup was reached with an explicit bearer parameter. The address bar may retain an explicitly supplied token until it is saved locally. Local storage is ordinary browser storage, not encrypted secret storage.

## implementation

The React/Wouter interface consumes framework-independent Monitor and DataSource classes. DockerSource validates the collector's ownership and exact configuration, creates or reuses it, executes the embedded Python collector, verifies bounded Docker stream framing and gzip JSON, then validates each snapshot before deriving rates. SimulationSource supplies deterministic offline data through the same interface.

The collector uses host PID/cgroup/UTS namespaces, a read-only root filesystem, private tmpfs and no network. Compatible clients share a configuration-fingerprinted collector. An atomic monotonic lease expires after inactivity and Docker automatically removes the exited container. Paused or background dashboards stop sampling; the next active sample can recreate an expired collector.

Signals require both PID and process start ticks. The collector opens a pidfd, validates identity, and sends through that descriptor. PID 1, kernel threads and the collector are protected in the UI; the collector also rejects its own process group and stale identities. Destructive requests are never automatically retried.

Edit **src/lib/procfs/collector.py**, then run **bun run generate**. The checked-in TypeScript embedding and revision are deterministic; the lint command detects a stale embedding. See [architecture and limitations](docs/architecture.md) and [candidate provenance](docs/provenance.md).

## tests

Unit tests cover query validation, endpoint-scoped credentials, Docker framing and bounds, concurrent collector reuse, foreign-container refusal, configuration isolation, idle recreation, no-retry signals, process identity, rate derivation and monitor races. DOM tests run in a separate process so Happy DOM cannot replace transport globals in other suites. Production browser tests cover real user actions, synthetic Docker requests over CORS, and both routes across three viewport sizes and two themes.

**bun run smoke:docker** is opt-in. Set WTOP_DOCKER_URL, and optionally WTOP_DOCKER_BEARER, to an authorized Linux daemon. It creates a privileged collector with a ten-second idle lease, verifies two clients sharing it and private snapshots, then checks automatic removal. Do not run it against a daemon you do not control.

## license

MIT. Repository history, package identity and license were retained during the migration from Mage. No candidate run directories, credentials or captured host snapshots are part of this repository.
