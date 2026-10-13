# Security Policy

T3 Office runs a small web server on your machine that reads T3 Code's local data: thread titles, prompts, tool
calls, file paths and costs. Keeping that data on your machine is the most important thing this project does.

## How T3 Office protects your data

- The server listens on `localhost` only. Vite's host check rejects requests for other host names, which protects
  against DNS rebinding from websites you visit.
- Everything is read-only. The SQLite database is opened read-only, nothing is written to T3 Code or the provider
  folders, and no messages are sent.
- There is no telemetry. The only outgoing requests are the ones listed in the README's
  [privacy section](README.md#privacy).

Please do not expose the office to a network (for example with `--host 0.0.0.0` or a tunnel): anyone who can reach
the port can read your threads.

## Supported versions

Security fixes go into `main`. Please make sure you run the latest version before reporting.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
[GitHub's private vulnerability reporting](https://github.com/felixgollnhuber/t3-office/security/advisories/new)
(the "Report a vulnerability" button on the Security tab).

Helpful to include: what an attacker can do, the steps to reproduce, and the version or commit you tested. You will
get an answer within a week. Once a fix is out, you are credited in the advisory unless you prefer otherwise.

Things that are especially interesting:

- ways for a website or another local user to read data from the office's API
- anything that makes T3 Office write to T3 Code's data or run commands it should not
- data leaving the machine without the user expecting it
