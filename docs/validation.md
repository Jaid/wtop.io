# dashboard session and chart validation

Validated on 2026-09-30 using Bun 1.4.2. This update did not change the collector image, wire protocol or host proxy configuration.

## current checks

| Check | Result |
| --- | --- |
| Frozen-lockfile dependency installation | Passed; lockfile unchanged |
| Embedded collector freshness | Passed |
| TypeScript, including unused locals | Passed |
| Knip dependency/export analysis | Passed |
| Shared Jaid ESLint configuration | Exit 0; zero errors; advisory warnings remain |
| Unit tests | 100 passed |
| Isolated DOM tests | 18 passed |
| Production-browser tests | 40 passed |
| Bun Linux collector tests in the actual distroless image | 16 passed |
| Total automated tests | 174 passed |
| Production build | Passed |

The browser suite now includes /home, /setup and /demo at desktop, tile and mobile sizes in both color schemes. It covers immutable live container histories, dashboard-wide graph inspection, independent graph readouts, repeated filter-button parameters, tag filters, zero peak linger, custom columns and the new setup fields.

Dashboard URL tests intercept pushState and replaceState after initialization, then change sorting, filters, tree mode, pause and sound. They assert no history writes and an unchanged URL; reloading restores the initially supplied values. View-only tests assert that action buttons, links and inputs are absent, no mouse/pointer/keyboard handlers are attached, simulated key presses and row clicks cannot change state, and live sampling continues. These checks run against the production React build, not just a DOM test renderer.

Graph tests inspect every canvas's frozen time and pixels, verify a shared absolute cursor timestamp and one readout per graph, and confirm release resumes live data. Unit tests check cursor ownership, missing-history behavior and immutability of published histories. A DOM test verifies that a fractional linger duration expires independently of receiving another sample. Sound-policy tests distinguish off, alerts and all without depending on browser autoplay permission.

Ancestry tests cover parent loss, adoption by a different parent, PID reuse, direct-to-init births, ambiguous pre-existing PID-1 children, ambiguous missing parents, kernel/PID-1 exclusions and reboot resets. The orphan tag now requires evidence of a lost/replaced non-init parent; detached is reserved for processes first observed essentially from birth already directly parented by init.

The first CI attempt timed out waiting for network idle during navigation, which then terminated the shared browser and caused cascading failures. Browser navigation now waits for DOM content and explicit application readiness instead, with an operation deadline shorter than the test deadline. Individual assertions still wait for the behavior they verify, including completed peak-opacity updates. All 40 browser cases passed locally after this change.

The shared lint advisories were not globally suppressed. No React Hooks diagnostics appeared in the final changed-file review.

## live container-chart recovery

The reported issue was reproduced against the authorized Docker endpoint 10.0.0.22 using the built app served from a temporary local static origin. All 36 container sparklines initially showed collecting and still did so after five seconds. After the immutable-history change, the same endpoint rendered all 36 charts with zero collecting placeholders after subsequent samples. No page exceptions were observed.

A separate isolated Chrome test of the exact HTTPS development origin loaded the app but could not reach its HTTP Docker endpoint: Chrome reported an HTTPS-to-HTTP mixed-content block. Granting local-network permission in that disposable browser context did not override that block. No user browser settings, TLS checks or host proxy permissions were loosened. The live chart-recovery result above therefore verifies the production app against the reported daemon, not that every fresh browser profile can use that HTTPS-to-HTTP arrangement.

No real host process was signaled. Collector signal tests target only a disposable child inside the test container.

---

# previous collector-overhaul validation

The following measurements and checks describe the preceding collector overhaul, not new timing measurements for this update. Its historical sound=true option was replaced in this update by sound=off, sound=alerts or sound=all.

Validated on 2026-09-30 using Bun 1.4.2. The original Mage candidate directories were not modified.

## checks

| Check | Result |
| --- | --- |
| Frozen-lockfile dependency installation | Passed |
| Embedded collector freshness | Passed |
| Windows/Linux collector bundle comparison | Identical SHA-256 revision and 40,311-byte bundle |
| TypeScript, including unused locals | Passed |
| Knip dependency/export analysis | Passed |
| Shared Jaid ESLint configuration | Exit 0; zero errors; 252 advisory warnings |
| Unit tests | 74 passed |
| Isolated DOM tests | 16 passed |
| Bun Linux collector tests in the actual distroless image | 16 passed |
| Production-browser tests | 25 passed |
| Total automated tests | 131 passed |
| Development and production builds | Passed |
| Caddy access-proxy configuration | Validated |
| Docker Compose configuration, with INFO and VERSION disabled | Validated |

The browser suite covers thirteen behavior flows and twelve route/viewport/theme combinations. It checks actual setup/save/filter/pause/signal interactions, MessagePack Docker responses over browser CORS, route reloads, configurable panels and columns, F-key navigation, inner-panel/table scrolling, graph painting and document overflow. Hover tests assert unchanged canvas pixels and timestamps, unchanged sparkline paths, and unchanged row slots while live process values continue updating. DOM tests verify peak traces retain the earlier color and width, tag visibility, safe command text, four date choices and explicit empty selections.

The unit suite covers epoch-aligned scheduling without catch-up drift, retry races, five-minute heavy history, five-second peaks, recycled PIDs, suspended devices, protocol limits, permissions, credential handling and presentation formats. Collector tests use the same Bun 1.4.2 distroless image as the application and signal only a disposable child inside the test container. Linux-only tests have an explicit bundle entry rather than being accidentally discovered by a plain Windows bun test invocation.

## performance measurements

Measurements used the authorized Docker endpoint on the same Linux host as the previous implementation. Counter reads, full process collection and the three local filesystem measurements remained enabled; no cached old snapshot was substituted for a new read.

| Path | Samples | Observed timing |
| --- | --- | --- |
| Previous Python implementation from the Windows host | 8 | 430–445 ms; mean 438.9 ms |
| Bun distroless/MessagePack implementation from the Windows host | 8 | 53–75 ms; mean 61.8 ms |
| Built application in a real Chromium browser | 12 | Median 68 ms; mean 77.8 ms; range 63–169 ms |

The twelve browser readings were 169, 70, 70, 67, 66, 66, 65, 64, 92, 69, 63 and 73 ms. Eleven were 63–92 ms; one was 169 ms. The application was served from a temporary local static origin and used host=10.0.0.28, destructive=true, sound=true, agent=true and kernel=true. Only the idle lease was shortened to ten seconds for cleanup. This is not an A/B test of the user's HTTPS development origin, and individual timings will vary with host and browser load.

After startup, observed sample-request starts were 2–8 ms after absolute one-second boundaries. This confirms the intended scheduling grid on the tested Windows/browser combination, not a guarantee of real-time execution or identical response completion times across machines.

At 1920×960, the live application fit exactly within the document viewport. All seven panels were present; there were no page exceptions. The live container metadata also supplied two containers with Compose labels. Generated screenshots and the raw benchmark summary remain under out/test/ and are not committed as product assets.

## real-host lifecycle check

A separate authorized smoke check created two compatible clients, verified a shared collector, read two snapshots with command lines omitted and confirmed natural Docker auto-removal after the ten-second idle lease. The final check observed 24 logical CPUs, 453 processes and three local filesystems. It did not signal any real host process.

The proxy example was configuration-validated, not installed as a replacement for the user's running proxy. No DNS or hosting resources were provisioned. Hardware and permission testing covered one live x64 Linux host, not every distribution, architecture or GPU family.

The shared lint configuration still emits advisory style and test-double diagnostics. These were not globally suppressed; there were no React Hooks diagnostics in the final review. The development build still reports its large combined chunk, while production uses separate application, React and vendor chunks.
