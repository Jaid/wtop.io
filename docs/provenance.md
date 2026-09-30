# candidate provenance

The base application was imported from Mage run **BtwyTC7L3zJ1tjk**, Claude Opus 5.5, 2026-09-29, in run-2026-09-29_08-29-58/claude-opus-5-5_wtop. The original run is unchanged. Only application source, tests and static assets were imported; this repository retained its own Git history, remote, license and package identity.

| Candidate or reference | Contribution to this integration |
| --- | --- |
| Selected Opus run | Responsive dashboard, live/demo routes, simulated host, Monitor/DataSource separation, graph rendering, process table/tree, shortcuts and details |
| Earlier Opus runs, especially 2026-09-29 02:59 | Container summary/sparkline interaction and additional host-metric ideas, adapted to the selected model |
| GPT-6 Astra, 2026-09-28 19:27 | Python collector approach, platform tick/page discovery, host-root symlink handling, strong collector identity checks and pidfd-based process signaling |
| Space Bunny, 2026-09-29 04:53 | Collector-side argument privacy and configuration-specific collector identity |
| Luna, Grok and other inspected Wtop results | Comparative review of lifecycle, safety and UI alternatives; weaker or conflicting approaches were not merged wholesale |
| tok.show and domain-cards | Bun/Vite conventions, root-level production assets, Jaid lint configuration, deployment layout and repository tooling |

The integration newly adds runtime snapshot validation, bounded strict Docker demultiplexing, configuration verification before reuse, sanitized transport errors, endpoint-path credential isolation, failure-aware token storage, saved-token share-link regressions, non-retried signals, monitor reboot handling and a dedicated Linux collector regression suite.

A separate host TCP agent service, locally built custom collector images and container-only metrics fallbacks were deliberately not imported. The result has one collector protocol and one frontend data contract. Some donor mechanisms were reimplemented to fit that architecture; this is not a byte-for-byte union of candidate outputs.

The migration preserved known limitations explicitly rather than representing untested hardware support as complete. See architecture.md and deployment.md.
