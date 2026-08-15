# Security Policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose local browser data or enable unauthorized browser control. Report it privately to zikedece@proton.me with reproduction steps and the affected version.

AgentLimb binds its Bridge to `127.0.0.1` and does not require cloud credentials. Reports involving a non-loopback bind, Native Messaging host registration, command execution, path traversal, or unintended storage of credentials are especially important.

## Repository hygiene

Never commit API keys, Cloudflare tokens, browser cookies, Chrome profiles, `.env` files, private keys, or generated runtime state. Release assets are built from an allowlist in `scripts/build-release.mjs` and include SHA-256 checksums.
