# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository. Include what you found, how to reproduce it
and the version or commit. You can expect an acknowledgement within a few days.

## Scope

This project is a local example, not a hosted service. The chat server binds to `127.0.0.1` and is
not meant to be exposed to a network. Reports about running it publicly are out of scope, but
bypasses of the loopback-only design (request gate, CSP, path traversal, secret redaction in logs,
the read-only Grafana MCP) are welcome.

## Secrets

Never commit `.env`. `npm run scan:secrets` (gitleaks plus a regex scan of files and history) must
report zero findings before a change is merged.
