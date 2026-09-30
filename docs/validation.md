# overhaul validation

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
