# architecture and operational limits

## one source contract

DockerSource and SimulationSource implement the same DataSource interface. Monitor derives rates from cumulative counters, retains chart history, tracks recent process load, manages pause/retry and emits UI events. The React/Wouter interface does not contain an alternate monitoring backend.

The default collector uses **oven/bun:1.4.2-distroless**. Its startup command contains a self-contained Bun bundle, including msgpackr. There is no shell, Python dependency, npm installation, custom image build or published agent port. Bun serves a root-only Unix socket at /tmp/wtop.sock. A small Bun program invoked through Docker exec sends the request to that socket and returns its completed response.

## transport and sampling cost

The wire envelope is protocol 3: MessagePack encoded with msgpackr (`useRecords: false`, `variableMapSize: true`), then gzip level 1. Each response contains a freshly collected snapshot and collector-work duration. Request data is passed as a literal JSON argument, never interpolated into executable code. Docker framing, compressed and decompressed sizes, MessagePack, the protocol and the snapshot are checked before use.

Normal sampling takes two Docker calls: exec creation and exec start. A complete, valid success envelope proves that sampling completed; an extra exec-inspection round trip is unnecessary for a read. Signals retain explicit exec-completion verification and are never retried automatically. Container names and Compose labels refresh separately every ten seconds.

The persistent process avoids recompiling/restarting the collector on every sample. It starts the bounded filesystem probe concurrently with fresh procfs collection. CPU, memory, network, disk, sensor and process counters are not reused from previous samples. Process argv is not cached: a process can replace its command without changing its PID or start time. Only immutable platform constants are retained.

## timing and interaction holds

Normal reads start on absolute epoch-millisecond boundaries: `floor(now / interval) * interval + interval`. Instances using the same interval therefore share a cadence. A slow read skips missed slots rather than accumulating drift or issuing overlapping catch-up reads. Resume, retry and interval changes return to the same grid. Connection setup is an immediate operation, not a scheduled sample. Network and host latency still affect completion times; different machines' wall clocks must be synchronized for cross-device alignment.

Hovering the process table captures its row slots, not its data. Existing rows receive new values without reordering; newly discovered processes are deferred until pointer leave, and departed identities retain marked, non-actionable placeholders. Explicit sort/filter/tree changes establish a new order. Identity includes start ticks, so recycled PIDs do not replace a held row.

History publishes a cached immutable HistoryView per sample. Time, series and process-history arrays are replaced instead of mutated; this makes new samples visible to compiled React components and keeps previously published views stable. The original mutable arrays could trap newly mounted container sparklines in their first collecting state.

One GraphCursor belongs to each dashboard. Hovering any canvas or sparkline freezes every chart at the current session epoch. A common absolute timestamp, not a shared pixel coordinate, drives crosshairs and individual readouts. Canvas windows align to the held end time; sparklines use their real sample timestamps. Missing history shows an unavailable value instead of extrapolation. Pointer leave/cancel, source unmount, window blur and visibility changes clear the inspection. Collection and table values continue.

Meters, core fills and process bars retain a translucent, same-color peak trace for linger seconds (default five; zero disables traces). Process heavy tags use a separate five-minute window: a sample qualifies at 80% of one CPU core, or at least 5% of host memory and 256 MB. This history is independent of the selected graph window and resets after host reboot.

## link input and interaction policy

Only setup serializes draft parameters. Dashboard state is initialized once from the supplied link and all later UI adjustments stay in React state. Reload restores the link's values. Repeated filter_button fields are decoded with URLSearchParams.getAll and encoded with append; scalar parsing never collapses them or comma-splits their expressions.

DashboardSettings carries interactive, linger and sound to controls, tooltips, graphs and meters. With interactive=false, action controls are not rendered and mouse, pointer, touch and keyboard handlers are not attached. Informational container rows and column headings become ordinary non-action elements. Global dashboard hotkeys are not registered, signal capabilities are disabled, and notice-dismiss buttons are hidden. Data collection, retries, resize/layout observation and visibility lifecycle handling remain active.

Sound modes are off, alerts (connection/signal/error feedback), and all (alerts plus menu actions). Typing and passive hover do not beep. Browser audio permissions are respected; a wall display may need autoplay permission configured outside the application.

The weight score is (per-core CPU percentage / logical-core count) × RAM percentage / 100, bounded to 0–100. Tags are derived from process traits, never inferred from secret arguments. Process ancestry is stateful: an orphan is a process for which Wtop observed a non-init parent identity and later saw that identity disappear or change. Parent identity is PID plus start ticks. A missing parent on the first observation remains unknown, and ancestry records survive brief process-scan omissions so a transient /proc race does not erase history. Detached is narrower: the process first appeared within the current sampling interval already directly parented by init and Wtop has never observed another parent. Pre-existing PID-1 children remain ancestry-unknown rather than being guessed.

## identity and lifecycle

A SHA-256 configuration fingerprint identifies compatible collectors. Reuse checks inspect the actual container's labels, command, image, user, namespaces, read-only filesystem, tmpfs, network and mount settings. A matching name alone is insufficient. Foreign or incompatible containers are neither executed into nor deleted. Concurrent creation uses Docker's name uniqueness with bounded retry for creation/removal races.

Image digest pins are preserved when pulling. Image tags are not immutable. Different images, collector revisions or lifetimes produce different collector names. A successful request renews a monotonic idle lease; active requests cannot race idle shutdown. With no active clients, Docker automatically removes the collector after its configured lifetime. Navigation cancels the browser's outstanding requests without deleting a collector another client may still use.

## privacy and process actions

Hidden mode never opens process command-line files. Censored mode redacts before serialization, including long-option values, fused short options and arguments after `--`. Short-option clusters cannot reliably be distinguished from fused secrets without an application-specific schema, so censorship conservatively masks trailing short-option characters. Full mode intentionally transmits the complete bounded argv.

Display-side censoring is applied before command highlighting and search. Highlighting creates text nodes, not executable HTML or a shell parser. Bearer values never enter generated share links or transport-error bodies. Endpoint storage keys normalize the authority but preserve path case. Browser local storage is not encrypted and remains accessible to same-origin scripts.

Collection rechecks start ticks to avoid combining different processes after PID reuse. Signal delivery uses glibc's pidfd_open and pidfd_send_signal through Bun FFI: open the descriptor first, then check start ticks, then signal the descriptor. There is no PID-only fallback. PID 1, the collector and its cgroup are protected. A lost response is not proof that a signal failed, so destructive requests are never retried. UI confirmation resets when the selected process or signal changes.

## host information and compatibility

Connection checks enumerate containers. Hostname, operating system, kernel, architecture, memory capacity and CPU count come from the collector, so **INFO and VERSION permissions are not required**. Live Docker version is deliberately omitted rather than requiring an extra permission for one cosmetic field.

Linux x64 and arm64 with Bun 1.4.2 and glibc are the intended collector targets. The pinned distroless image was tested; a compatible slim image may be selected explicitly. Alpine/musl images are not drop-in replacements for the glibc FFI binding. Kernel pidfd support is required for safe signals. Docker Desktop exposes its Linux VM, not Windows or macOS host processes. Rootless daemons, user-namespace remapping and hardened kernels may prevent host access.

Clock ticks and page size come from Linux ELF auxiliary-vector fields AT_CLKTCK and AT_PAGESZ, not hard-coded constants or libc-specific sysconf enum values. Host absolute symlinks resolve against /proc/1/root, including NixOS chains. Filesystem probing is limited to recognized local filesystems and has an actual subprocess deadline; network, FUSE and automount filesystems are deliberately omitted.

Stacked block devices can be displayed, but host disk totals aggregate leaf devices to avoid double counting. Network totals use interface-name classification and may need adaptation for unusual bonding or virtual-network layouts. Hardware metrics depend on exposed sysfs counters. Physical device paths distinguish GPUs even when values match; suspended devices display as asleep instead of invented zero utilization. NVIDIA/Intel metric coverage is not universal.

Procfs scans are not atomic host-wide snapshots, and process argument reads are bounded. Live testing covers one Linux host, not every distribution, kernel, CPU architecture or GPU family.

## editing and verification

Edit src/lib/procfs/collector/*.ts and run `bun run generate`. The deterministic bundled embedding is checked by lint. `bun run test:collector` bundles Linux tests and streams them to an isolated distroless container without bind mounts. `bun run smoke:docker` is an explicit, authorized real-host check. See validation.md for the measured results and deployment.md for host access configuration.

Implementation contracts: [React external-store snapshots](https://react.dev/reference/react/useSyncExternalStore), [repeated URL parameters](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/getAll), and [Web Audio permissions](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
