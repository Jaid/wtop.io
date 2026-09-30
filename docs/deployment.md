# deployment and security

## static application

Build with **bun install --frozen-lockfile && bun run build** and serve **dist/** from an HTTPS origin. No application backend or hosted metrics service is required. The browser contacts the configured Docker endpoint directly.

For Cloudflare Pages, use that build command, the dist output directory and Bun 1.4.2. wrangler.jsonc follows this repository's Pages layout. public/_redirects supplies the SPA fallback for /setup and /demo; public/_headers sets no-referrer, nosniff, frame denial and conservative no-cache behavior. Other hosts must provide equivalent history fallback and headers. The files are deployment configuration, not proof that a domain or Pages project has been provisioned.

## Docker access is privileged

Allowing a client to create privileged host-PID containers gives it root-equivalent access to the Linux host. A Socket Proxy reduces the exposed API surface but does not make CONTAINERS, EXEC, IMAGES and POST safe for untrusted users. The destructive=false parameter hides and disables Wtop's signal actions; it does not constrain other programs that possess the Docker credential.

Use a trusted network or VPN, TLS, a strong Bearer token and a specific allowed Origin. Do not publish a raw unauthenticated Docker port or use a wildcard CORS policy. Never commit a token or send it in a URL unless that exposure is intentional. Local storage is not an encrypted credential vault. Keep the static app's origin, dependencies and deployment access controlled.

## optional access proxy

The deploy/ directory contains a Caddy + LinuxServer Socket Proxy example. It publishes only Caddy, binds it to loopback by default, requires a nonempty Bearer token, rejects foreign browser origins and leaves the socket proxy on an internal Docker network.

On the Linux host:

~~~sh
cd deploy
cp .env.example .env
openssl rand -hex 32
# Put the generated hexadecimal token in .env as WTOP_TOKEN.
# Set WTOP_HOST to the hostname the client will use.
# Set WTOP_ORIGIN to the exact app origin, without a trailing slash.
docker compose config --quiet
docker compose up -d
~~~

The example uses **https://localhost:8443** and Caddy's internal CA. Export and trust that CA in the client browser/OS before connecting. Do not bypass certificate checks. For another client on the LAN, deliberately set WTOP_BIND to the appropriate private interface and WTOP_HOST to a name resolving to it; restrict access with your host firewall. The default 127.0.0.1 binding is reachable only on the Docker host, not from neighboring computers.

With Docker Desktop, published loopback ports belong to its host/VM networking arrangement and the monitor sees the Linux VM. For public deployment, replace the internal-CA arrangement with your existing authenticated TLS ingress and keep the Docker-facing network private.

The Caddyfile orders origin rejection, CORS preflight handling, Bearer authorization and proxying explicitly in a route block. Unauthenticated preflights do not reach Docker. Authorization is removed before forwarding to the internal socket proxy. Do not enable unrestricted request-body logging: Docker exec requests contain the collector and can return sensitive process data. Generate tokens as hexadecimal strings as shown, rather than arbitrary Caddyfile metacharacters.

The socket-proxy configuration enables INFO and VERSION for connection checks and CONTAINERS, EXEC, IMAGES and POST for the collector lifecycle. It does not publish its own port. Caddy's certificate/config volumes contain sensitive operational material and should be protected and backed up according to your host policy.

## browser connectivity

A successful command-line request does not prove a browser request will succeed. Cross-origin requests require CORS responses allowing the exact application Origin and explicitly listing Authorization and Content-Type. Browser local-network permissions and certificate trust are separate requirements. HTTPS endpoints avoid relying on browser-specific exceptions for an HTTPS application contacting an HTTP private endpoint.

Wtop can declare local or loopback target address space when a secure page contacts a private HTTP endpoint. Automatic classification is a hint based on host spelling, not a DNS resolver. Set addressSpace explicitly for split-horizon names that cannot be classified reliably. Public HTTP targets are not made safe by this setting. Support and prompts depend on the browser; use trusted HTTPS endpoints where possible.

## collector requirements

The default collector image is oven/bun:1.4.2-distroless, pulled by the Docker daemon on demand. The target must permit privileged containers, host PID, host UTS and host cgroup namespaces. Python's standard library supplies the collector; no server daemon, package installation in the container or custom image build is needed. An alternative image must expose python3 and Linux pidfd support. A digest-pinned image can be selected with the image parameter.

Configuration-fingerprinted collectors are shared only with compatible clients. By default a collector stops after 120 seconds without samples and Docker auto-removes it. Pausing or backgrounding the last client allows the collector to expire. A new active sample recreates it. Do not change or remove containers that merely have similar names; Wtop refuses incompatible same-name objects.

## validation commands

**bun run test:collector** runs only synthetic fixtures and disposable-process tests in an unprivileged, networkless container. Sources are streamed through stdin so this command works with an SSH Docker context without sharing the project directory. Docker must already be configured; the command does not change the default context.

**bun run smoke:docker** is different: it creates a privileged collector on the explicitly supplied WTOP_DOCKER_URL, optionally using WTOP_DOCKER_BEARER. It verifies shared collection and eventual auto-removal without sending real process signals. Use only on an authorized Linux host. A matching client can keep the same ten-second collector alive and make the expiry assertion fail.

## references

The access example follows the official [Caddy route](https://caddyserver.com/docs/caddyfile/directives/route) and [request matcher](https://caddyserver.com/docs/caddyfile/matchers) contracts and the [LinuxServer Socket Proxy configuration](https://github.com/linuxserver/docker-socket-proxy). Safe process signaling uses Python's [pidfd_open](https://docs.python.org/3/library/os.html#os.pidfd_open) and [pidfd_send_signal](https://docs.python.org/3/library/signal.html#signal.pidfd_send_signal). These references explain platform mechanisms; they are not substitutes for configuring host access control.
