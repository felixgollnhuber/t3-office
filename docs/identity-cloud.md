# Identity and cloud preparation

Status (2026-11-02, OFF-023): protocol, gated local HTTP/account integration and the native configured-provider interface are implemented and tested using a simulated provider. The normal service has **GitHub disabled**. A registered application, safely delivered configuration and a real consent/callback trial are still required. No GitHub credentials, external account or cloud resources were created. Cloudflare hosting/storage/live connections remain a proposed migration.

The service accepts an explicit `GitHubIdentityBroker` through the `github` option of `createBuildingHandler`/`buildingApi`; it never discovers credentials implicitly from the desktop or enables the provider by default. The browser shows the GitHub option only when `/auth/providers` reports it available.

| Route under /api/building | Behavior |
| --- | --- |
| GET /auth/providers | Availability boolean only; no credentials |
| POST /auth/github/start | Anonymous, same-origin JSON start; browser binding cookie and PKCE challenge |
| GET /auth/github/callback | Validate provider response; stage only public identity; fixed local redirect |
| GET /auth/github/pending | Browser-bound public identity for explicit confirmation |
| POST /auth/github/confirm | Fresh anonymous check, one-use confirmation, transactional mapping and app session |
| POST /auth/github/cancel | Discard staged proof and binding cookies; leave current app account intact |

The callback never creates an application account or signs the browser in automatically. A ten-minute HttpOnly/Strict confirmation cookie carries only a random reference; provider tokens are discarded. A fresh same-origin confirmation prevents a delayed provider roundtrip from silently replacing a signed-in account. Local sign-in and sign-out invalidate pending GitHub proofs. Stable `(provider, subject)` mapping survives restart/rename; local names/emails are never used to merge accounts. Parallel confirmations for the same subject create one office. Pending challenges/confirmations are intentionally ephemeral and must restart after service loss.

Configured sign-in uses a separate root-scoped HttpOnly, SameSite=Strict browser auth-context cookie, issued by provider discovery. Its server-side generation is captured before reading request bodies and rechecked after asynchronous work. Starting/cancelling a provider flow or changing a local session invalidates older attempts, including requests captured before a binding/confirmation cookie existed. Missing context returns428 before mutation; the native client primes discovery and retries once. Changed context returns409 and requires a fresh user action. Contexts are bounded to1000 and expire after seven days; pending attempts/proofs are bounded to100 and expire after ten minutes. These stores are process-local: restart requires a new flow. The Lax provider binding and Strict confirmation cookies are root-scoped so local sign-in/out can invalidate them too.

Invalid callback state remains a safe error. Valid provider denial and provider transport failure return generic cancellation/failure markers to the local UI; no provider error or credential is placed in the redirect. New OAuth routes use the existing sign-in rate limit. Configured HTTPS currently requires an actual TLS socket and exact configured Host; trusting reverse-proxy headers is not implemented. Cloud deployment requires a separate proxy/origin review.


## Smallest next identity slice

`server/github-identity.ts` uses Web Crypto, Fetch, URL and bounded in-memory challenges. It has no Node database/filesystem dependencies or third-party packages. `GitHubIdentityBroker.begin()` produces an authorization URL and a separate browser binding; `cancel()` safely consumes a browser-bound denial, and `complete()` verifies the callback and returns only `{provider, subject, login, displayName}`. Subject is the stable numeric GitHub ID as a string; login/name are presentation values.

The adapter requests no additional scopes. GitHub documents authorization-code flow, state and S256 PKCE, and its authenticated-user endpoint can return the public user representation without `read:user`. We do not request email, repository access, organization membership or offline/refresh tokens. Previously authorized broader provider grants may still exist; the adapter discards fields outside its identity allowlist. See [GitHub authorization flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) and [authenticated user permissions](https://docs.github.com/en/rest/users/users#get-the-authenticated-user).

Pending attempts expire after ten minutes, are bounded to100 per broker and are consumed before token exchange. Wrong browser binding, expiry, replay and duplicate simultaneous callbacks fail. Provider endpoints are fixed, redirects are rejected, requests and response-body reads have enforced eight-second deadlines, and response bodies have explicit size limits. Raw provider errors, tokens, email and private profile fields are never returned. Unfinished attempts restart safely after process loss. This is a protocol foundation, not a distributed pending-state store.

Before enabling real GitHub sign-in (HTTP/native integration below is now implemented):

1. Configure an explicitly registered GitHub application and fixed callback URL through supported secret delivery. Choose the application type and permitted deployment environment before activation; GitHub recommends considering a GitHub App. No app or secret was created/read during development.
2. The gated routes are implemented; configure the registered application explicitly. Validate the actual request origin against configured public origin; never construct redirects from untrusted Host/forwarding headers. Rate-limit start/callback routes.
3. The binding uses a ten-minute HttpOnly, SameSite=Lax cookie and Secure on HTTPS. Callback state must match both the server challenge and the browser cookie. Do not reuse the existing Strict session cookie as the cross-site callback binding.
4. Mapping/session issuance is implemented transactionally after explicit confirmation; provider tokens are discarded. Store only the public identity allowlist. Require explicit confirmation for any future linking of an existing local account. **Never auto-merge by username, display name or email.** A verified provider account is not proof of a real-world human identity.
5. Fixed local redirects preserve the existing explicit invitation flow. Sign-in must not accept the invitation, enter a room, grant access or start publication. Show the GitHub option only when the service actually enables it.
6. Synthetic HTTP and intercepted-browser tests pass; perform a separately authorized live OAuth trial before rollout. Current tests use a fake transport and synthetic client secrets; real consent screens, callbacks and provider behavior remain unverified.

## Cloud boundary

Keep the original office client and private T3 companion separate. The cloud service receives only current allowlisted publication fields, explicit human messages and consented presence. Never tunnel or proxy `/api/t3/*`, provider credentials, prompts, transcripts, paths or local usage databases. The existing bridge's HTTPS and publish-only credential rules remain mandatory.

Cloudflare documents D1 and SQLite-backed Durable Objects as storage choices; Durable Objects can coordinate a room's WebSocket clients. See [database choices](https://developers.cloudflare.com/workers/databases/connecting-to-databases/) and [WebSocket coordination/hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/). The following is our proposed integration, not a deployed architecture:

| Component | Proposed responsibility | Migration requirement |
| --- | --- | --- |
| Worker HTTP entry | Identity, sessions, invitations and authenticated routing | Preserve origin/body limits, rate limits and fixed callbacks; no local-data endpoints |
| D1 | Accounts, provider identity mapping and durable invitation/grant records | Port and test Node SQLite transactions, uniqueness and revocation semantics |
| One Durable Object per office | Admitted human room, serialized messaging and live connections | Port room policy; close connections on revocation/expiry, not only on reconnect |
| Existing local companion + bridge | Private agent source and explicit safe publication | Retain loopback-only private source; target cloud HTTPS with publish-only keys |
| Original browser client | Office, friends, avatar, chat and tour | Add a transport adapter without rewriting the office or assuming WebSocket access grants permission |

`node:sqlite`, synchronous Node HTTP handlers and the current in-memory presence assumptions are not drop-in Workers implementations. Do not route production traffic to a second partially implemented backend. First reuse the permission fixtures against an adapter, preserving single-use invitations, separate human admission, sequence-based history, retention, moderation receipts, cross-user isolation and revocation.

A useful first hosted trial should include two separate computers using synthetic work data, reconnect and concurrent-device tests, deletion/retention checks, operational recovery and an agreed cost cap. Public resources, deployment, real-data publication and external OAuth activation require separate authorization; no automatic deployment or daily Git automation is active.
