# migration validation

Validated on 2026-09-30 using Bun 1.4.2. The original Mage run folders were not modified.

| Check | Result |
| --- | --- |
| Frozen-lockfile dependency installation | Passed |
| Embedded collector freshness | Passed |
| TypeScript, including unused locals | Passed |
| Knip dependency/export analysis | Passed |
| Shared Jaid ESLint configuration | Exit 0; no errors; 180 advisory warnings remain |
| Unit tests | 52 passed |
| Isolated DOM tests | 10 passed |
| Linux collector tests in a disposable Docker container | 16 passed |
| Production-browser tests | 18 passed |
| Development and production builds | Passed |
| Caddy access-proxy configuration validation | Passed |
| Docker Compose configuration validation | Passed |

The browser checks cover six behavior flows and twelve route/viewport/theme combinations. They assert successful rendering, painted graphs, no page exceptions, no horizontal document overflow, actual setup/save/filter/pause/signal interactions, synthetic Docker requests over browser CORS and both direct SPA routes. Screenshot images remain local generated artifacts under out/test/screenshots; they are not committed as product assets.

A separate authorized live-Linux-host smoke check created two matching clients, verified one shared collector, took two snapshots with command lines omitted, and confirmed Docker auto-removal after the ten-second idle lease. The observed host had 24 logical CPUs; the sample contained 435 processes and three local filesystems. No real host process was signaled. The actual pidfd signal test targets only a disposable child inside the test container.

This is not a certification of all Linux distributions, architectures, GPU drivers or browser permission policies. The optional Caddy example was configuration-validated, not installed as a live replacement for the host's proxy. Cloudflare configuration and GitHub Actions workflows are included; local validation does not by itself establish a successful public deployment or a completed remote CI run.

The remaining ESLint advisories come from the shared opinionated configuration, including stylistic preferences and test-double typing. No React Hooks diagnostics remained in the final lint review. They were not globally suppressed to produce an artificial warning-free result.
