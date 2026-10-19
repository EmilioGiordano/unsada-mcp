# Security

unsada-mcp holds the user's classroom session and reads untrusted classroom content, so
security reports are welcome.

## Reporting a vulnerability

Report it privately through
[GitHub security advisories](https://github.com/EmilioGiordano/unsada-mcp/security/advisories/new),
not in a public issue. Include the version, the steps to reproduce it and what an attacker
gains. Never include a real `MoodleSession` cookie, `sesskey` or classroom data.

## Scope

- Anything that makes the server change the classroom: post, submit, subscribe, mark, log out.
- Anything that sends the session to another origin or into tool output, logs or files.
- Downloads written outside the allowed roots or into agent and tool configuration.
- Classroom content or files that crash the server or exhaust memory or disk.

Only the latest published version is supported.
