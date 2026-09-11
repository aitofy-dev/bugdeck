# Security Policy

## Reporting a vulnerability

Report privately to **hello@aitofy.dev**. Do not open a public issue for a vulnerability.

Include:

- the package and version (`@bugdeck/core`, `@bugdeck/server`, `bugdeck`), Node version and OS
- what an attacker can do, and the steps to reproduce it
- any proof-of-concept code or output, with tokens removed

You get an acknowledgement within 48 hours and an assessment within 7 days. Fixes ship in a patch
release; the advisory credits you unless you ask otherwise.

## Supported versions

The latest minor release receives security fixes. Older minors do not — upgrade to the latest
minor first.

## In scope

- Reading a report, a screenshot or a comment as a user who did not file it
- Stored XSS through report text, a filename or a tracker comment rendered back into a page
- An uploaded file that survives sanitisation as anything other than a re-encoded raster image
  (polyglot, SVG, decompression bomb)
- Path traversal through a report id, an asset id or the configured storage path
- Leaking a tracker API key, a user email or report contents to logs, disk outside the storage
  path, or the network
- Unauthenticated access to any route that returns user data

## Out of scope

- Anything that requires an attacker to already have write access to the storage path or to the
  machine
- Vulnerabilities in Plane, GitHub, Linear or the framework you mount the server in — report those
  upstream
- Denial of service by filing many reports from an authenticated account. Rate limits are a
  configuration, not a security boundary.

## Notes on the threat model

The widget runs in a browser you do not control, so everything it sends is untrusted: text is
escaped where it is rendered, images are re-encoded, and block layout is parsed into typed values
at the boundary. The server does not do authentication — the host application supplies
`resolveUser`, and a report is only ever readable by the user it belongs to. There is no telemetry
and no network call the packages did not need for the tracker you configured.
