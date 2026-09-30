# architecture and operational limits

## one source contract

The selected Opus dashboard remains the UI foundation. The migration integrates donor mechanisms at the collector and state boundaries instead of retaining several competing backends. DockerSource and SimulationSource produce the same validated sample model; Monitor derives rates, retains aligned history, manages pause/retry and emits UI events.

Each real sample uses Docker exec with literal argv, never shell interpolation. The Python standard-library collector returns protocol-versioned gzip MessagePack. Input and decompressed output have separate byte limits. Invalid framing, exec status, protocol or snapshot data fails explicitly instead of displaying truncated metrics.

## identity and lifecycle

A SHA-256 configuration fingerprint identifies compatible collectors. Reuse checks inspect the actual container's labels, command, image, user, namespaces, read-only filesystem, tmpfs, network and mount settings. A matching name alone is insufficient. Foreign or incompatible containers are neither executed into nor deleted. Concurrent creation is coordinated through Docker's name uniqueness, with a bounded retry for creation/removal races.

Image digest pins are preserved when pulling. A tag remains mutable by definition; use a digest to require immutable image content. Each collector has a fixed idle lifetime. Different image, collector revision or lifetime settings produce different collector names. Any compatible active client renews the lease. Navigation aborts outstanding requests; the started collector expires independently of the browser.

## privacy and process actions

Hidden mode never opens process command-line files. Censored mode redacts before serialization, including long-option values, fused short options and arguments after --. Because short-option clusters cannot be distinguished reliably from fused secrets without application-specific schemas, censoring conservatively hides trailing short-option characters. Full mode is intentionally not private.

Display-side censoring remains defense in depth. Bearer values are not inserted into share links or reflected in transport errors. Endpoint storage keys normalize the authority but preserve path case. Stored values are not encrypted and remain accessible to scripts running on the same origin; protect the static application's supply chain and origin.

PID identity combines pid and startTicks. Collection rechecks start ticks to avoid mixing two processes when a PID is reused. Signal delivery opens a pidfd before comparing start ticks and has no racy PID-only fallback. A lost response is not proof that a signal failed, so signals are never retried automatically. UI confirmation resets when the selected process or signal changes.

## measurement limits

Linux is required. Docker Desktop exposes its Linux VM, not Windows or macOS host processes. Rootless daemons, user-namespace remapping and hardened kernels may prevent host access. Python 3.9+ and kernel pidfd support are required for safe destructive actions; unavailable capabilities are not replaced by unsafe fallbacks.

Clock ticks and page size come from sysconf rather than hard-coded values. Host absolute symlinks are resolved against /proc/1/root, including NixOS chains. Host filesystem probing is limited to recognized local filesystems and uses a subprocess deadline; network, FUSE and automount filesystems are deliberately omitted to avoid activating or hanging on them.

Disk views include stacked block devices, but host totals aggregate leaf devices to avoid counting the same I/O twice. Network totals use interface-name classification and may need adaptation for unusual bonding, bridge or virtual-network layouts. Per-container memory is the sum of process RSS, not cgroup memory usage, and shared pages can be counted more than once.

GPU support depends on exposed sysfs counters. Physical device paths distinguish GPUs, even when values are identical. Suspended devices are marked asleep instead of reporting invented zero utilization. There is no universal NVIDIA or Intel metrics implementation. Fans, temperatures and pressure counters are optional and only shown when supplied by the host.

Collectors read multiple procfs files sequentially, so a sample is not an atomic host-wide snapshot. Process argument collection is bounded per process. Production testing covered one live Linux Docker host, not every distribution, architecture or GPU family.

## editing and validation

collector/sample.ts is the source of truth. scripts/embedCollector.ts produces collectorSource.ts and a stable revision. scripts/testCollector.ts runs synthetic and disposable-process tests in an isolated container without bind mounts. scripts/smokeDocker.ts is the separate, opt-in privileged integration check. Browser tests use synthetic Docker responses and never send process signals to a real host.
