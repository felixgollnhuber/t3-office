# Security and privacy boundaries

The building stores its own accounts, offices, sessions, invitations, grants, publisher credentials and latest status snapshots. It does not read T3 Code data by default. No commands or messages are sent to agents.

## Shared service

- Passwords use salted scrypt. Session, invitation and publisher tokens are stored hashed. Sessions last seven days, invitations 24 hours, publisher keys 30 days.
- Cookies are HttpOnly and SameSite=Strict, with Secure on actual TLS connections. Cross-origin requests are rejected. Mutations require bounded JSON bodies. Authentication limits use socket addresses rather than untrusted forwarding headers.
- Every office read checks ownership or an explicit grant. Unshared offices are undiscoverable. Presence-only visitors receive no agent activity or counts.
- Published snapshots allow only opaque ID, provider and status. The bridge pseudonymizes raw thread IDs locally. The server generates generic names and excludes titles, prompts, paths, transcripts, costs and tool output.
- Owners can separately choose shared character names, work-area categories, bounded character appearance and allowlisted room theme/layout/lighting preferences. Browser sharing sends these only after an explicit share action; profile changes use an owner-only endpoint that publisher keys cannot call. Presence-only visitors receive none of these profile or room preferences. Local aliases remain in browser storage until shared.
- Pause clears snapshots. Revoked grants deny subsequent reads; revoked keys deny subsequent publications, including requests whose bodies were already in flight. Existing viewer content clears on the next refresh. A recipient can retain information they already saw.
- State lives in ignored `.local/`, with dev-server file access denied for that directory and SQLite files. Keep backups and publisher-key files private.

## Local companion

`T3_LOCAL_DATA=1` explicitly enables the upstream read-only T3 API on a separate loopback instance. It reads sensitive local data. Do not tunnel, reverse-proxy or publicly host this companion. Its private routes reject non-loopback clients. The bridge accepts only loopback source origins, refuses redirects and requires HTTPS for remote destinations.

The normal building/shared-office UI never calls the private T3 APIs. Tests and screenshots use synthetic data. Developing the application does not authorize inspecting actual private databases or transcripts.

The original own-office view uses private local APIs only on an explicitly enabled companion/local launcher. Sharing controls serialize start/stop changes, cancel pending starts on logout and guard late account responses. Shared snapshots refresh independently of renderer frame rate; stalled reads cover the old scene until access is revalidated, while explicit access denial returns to the user's own office.

## Release limits

This release is verified locally and is not publicly deployed. Public operation needs reviewed TLS/trusted-proxy configuration, account recovery, signup/abuse controls, backups and operational monitoring. The current service deliberately does not trust forwarding headers for origin/cookie decisions. Do not disable checks to make a proxy work.

Report vulnerabilities privately to the maintainer of the repository where encountered. Do not post real conversations or credentials in public issues. This extension does not automatically contact upstream or send reports.

## Explicit social features

Focus sessions and moments are separate opt-ins, never inferred from private agent work. A host's current invitation grants gate session discovery and joining; participant names/quiet preferences are disclosed only to the host and explicitly joined peers. Presence-only guests can elect to join a focus session but still receive no agent activity or moments. Revocation removes membership; renewed permission does not restore it. Session membership is a chosen commitment, not live-person tracking. Timers expire on server time.

Moments require owner-entered text, a local preview and a separate publication action; they are visible only to current activity guests. They do not establish that work was independently verified. Owners delete them; seven-day visibility and a 20-entry per-office cap bound retention (expired entries are pruned on social requests). A PNG export is owner-only in the UI, previews its exact allowlisted fields and never captures the scene or private HUD. Export does not upload anything. Recipients can retain information already disclosed.

Stopping browser activity publishing does not end a focus session or delete a moment. Use those explicit controls or revoke the grant. Cookie sessions, origin/body checks and per-read authorization apply to social routes; publisher credentials cannot access them. Mutations reauthenticate after body arrival and check the optional UI actor precondition; social reads identify the authenticated viewer to reject blended account responses. UI failures clear social content, and an active timer is revalidated while minimized. Temporary local tour/timer hints contain no credentials or work contents.
