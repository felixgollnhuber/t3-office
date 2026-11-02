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

Personal floor decor accepts fixed accent/emblem identifiers and three fixed raised shelf slots only. Unknown metadata is stripped; malformed identities are rejected. It follows room-style ownership and activity-grant restrictions; presence-only readers receive none of it. No uploaded asset, URL or arbitrary placement is supported.

The optional doorbell starts disabled. Opted-in hosts approve new focus membership; DND blocks new membership even with ringing off. Requests are scoped to current grants and active focus sessions, expire after two minutes, and are disclosed only to their host/requester. Host approval never changes the underlying grant or publishes activity. Cancellation cannot reset the one-minute per-host cooldown. Revocation and session end invalidate requests; publisher credentials cannot read or mutate them. An accepted request is consented focus membership, not proof that the requester is currently watching or online. There is no chat/free-text request payload or audible notification.

## Human conversation rooms

Human profile editing and room presence/chat are separate from agent publication. Each human mutation uses the existing authenticated cookie, origin/body checks and optional actor precondition. Only fixed appearance/availability identifiers and bounded names are accepted. Publisher keys cannot read or control humans. An invitation grant alone does not authorize chat: guests need host admission, an open room and a current active presence lease. Owners also explicitly enter before reading conversation state. Names, appearance, availability and bounded position become visible only to admitted active participants. Visit requests expose only the requester's chosen name to their host.

Requests expire after two minutes, are bounded to twelve pending/admitted guests per office, and cancellation does not reset the one-minute cooldown. DND rejects new visits; closing removes guest admission. Kick/revocation remove pending/admitted/live state, and regrant does not silently restore it. All reads/mutations recheck authorization; request bodies arriving slowly cannot retain revoked permission. A twenty-second presence lease expires without heartbeats; stale tabs cannot move or remove a replacement lease. Leaving denies further chat reads. Existing information cannot be recalled from recipients.

Messages are manually entered plaintext, never extracted from AI work. They are escaped as text in the UI, limited to500 characters and1/second/20per minute, retained up to seven days with at most200 per room/100 returned, and filtered by a strict admission sequence. Retention pruning runs on room requests. Authors and hosts can delete messages. Idempotency receipts survive deletion for the retention window and use the authenticated author/client ID; retries cannot duplicate or resurrect moderated text. Message/receipt writes are transactional. There is no E2E encryption, attachment upload, public chat discovery or claim of GitHub-verified identity. Movement is cosmetic coordination within authorized rooms, never a permission boundary or remote agent-control mechanism.

## First-time setup and identity preparation

The normal first-visit service leaves private T3 endpoints disabled. Native account setup uses the existing password/session/origin/abuse controls and rechecks current authentication before submitting a stale form. Passwords are not written by the app to browser persistence. A pending single-use invitation token remains in session storage until accepted or dismissed; acceptance is explicit and separate from human admission. Advanced settings revalidate the active account after native sign-in.

The guide stores only a validated step, timestamp and pause flag, never account names, room IDs, messages or credentials. Guide progression is a local convenience, not evidence of a completed permission change. It never calls publication or grant mutation APIs. A closed conversation does not revoke an existing office-viewing grant; use access revocation for that. Page hiding clears human/chat DOM and actors; restored cached-page lifecycle events revalidate the session and prior consent before any resume. Synthetic lifecycle tests are not a certification of every browser's back/forward cache behavior.

The GitHub flow is wired behind explicit broker injection; normal service configuration leaves it disabled. The callback only stages public identity and requires a fresh same-origin confirmation before creating an account/session. A root-scoped HttpOnly auth-context cookie and server generation reject stale/in-flight authentication writes across local sign-in/out, cancellation and provider-flow replacement, including requests captured before provider cookies existed. Missing context is rejected before mutation and the native client primes it once; changed context requires a fresh action. Local sign-in/out clears unfinished proofs; no identity is merged by name/email. Its fake-transport tests cover browser-bound state, S256 PKCE, expiry, cancellation, replay/concurrency, fixed endpoints, response limits and enforced deadlines. It returns only stable provider ID and public presentation fields. No actual GitHub credentials, authorization or private API responses were used. Before activation, follow the session/cookie/account-linking gates in [identity/cloud preparation](docs/identity-cloud.md).
