# Security and privacy boundaries

The building stores its own accounts, offices, sessions, invitations, grants, publisher credentials and latest status snapshots. It does not read T3 Code data by default. No commands or messages are sent to agents.

## Shared service

- Passwords use salted scrypt. Session, invitation and publisher tokens are stored hashed. Sessions last seven days, invitations 24 hours, publisher keys 30 days.
- Cookies are HttpOnly and SameSite=Strict, with Secure on actual TLS connections. Cross-origin requests are rejected. Mutations require bounded JSON bodies. Authentication limits use socket addresses rather than untrusted forwarding headers.
- Every office read checks ownership or an explicit grant. Unshared offices are undiscoverable. Presence-only visitors receive no agent activity or counts.
- Published snapshots allow only opaque ID, provider and status. The bridge pseudonymizes raw thread IDs locally. The server generates generic names and excludes titles, prompts, paths, transcripts, costs and tool output.
- Owners can separately choose public character names and work-area categories. Browser sharing sends these only after an explicit share action; profile changes use an owner-only endpoint that publisher keys cannot call. Presence-only visitors receive neither names nor areas. Local aliases remain in browser storage until shared.
- Pause clears snapshots. Revoked grants deny subsequent reads; revoked keys deny subsequent publications, including requests whose bodies were already in flight. Existing viewer content clears on the next refresh. A recipient can retain information they already saw.
- State lives in ignored `.local/`, with dev-server file access denied for that directory and SQLite files. Keep backups and publisher-key files private.

## Local companion

`T3_LOCAL_DATA=1` explicitly enables the upstream read-only T3 API on a separate loopback instance. It reads sensitive local data. Do not tunnel, reverse-proxy or publicly host this companion. Its private routes reject non-loopback clients. The bridge accepts only loopback source origins, refuses redirects and requires HTTPS for remote destinations.

The normal building/shared-office UI never calls the private T3 APIs. Tests and screenshots use synthetic data. Developing the application does not authorize inspecting actual private databases or transcripts.

The original own-office view uses private local APIs only on an explicitly enabled companion/local launcher. Sharing controls serialize start/stop changes, cancel pending starts on logout and guard late account responses. Shared snapshots refresh independently of renderer frame rate; stalled reads cover the old scene until access is revalidated, while explicit access denial returns to the user's own office.

## Release limits

This release is verified locally and is not publicly deployed. Public operation needs reviewed TLS/trusted-proxy configuration, account recovery, signup/abuse controls, backups and operational monitoring. The current service deliberately does not trust forwarding headers for origin/cookie decisions. Do not disable checks to make a proxy work.

Report vulnerabilities privately to the maintainer of the repository where encountered. Do not post real conversations or credentials in public issues. This extension does not automatically contact upstream or send reports.
