# Identity and cloud preparation

Status (2026-11-02): the local first-user flow is implemented. The GitHub protocol adapter is implemented and tested with synthetic responses, but is **not connected to sign-in routes or account creation**. Cloudflare hosting, resources and deployment are not implemented. This is the next integration brief, not a claim that friends on separate computers can connect yet.

## Smallest next identity slice

`server/github-identity.ts` uses Web Crypto, Fetch, URL and bounded in-memory challenges. It has no Node database/filesystem dependencies or third-party packages. `GitHubIdentityBroker.begin()` produces an authorization URL and a separate browser binding; `cancel()` safely consumes a browser-bound denial, and `complete()` verifies the callback and returns only `{provider, subject, login, displayName}`. Subject is the stable numeric GitHub ID as a string; login/name are presentation values.

The adapter requests no additional scopes. GitHub documents authorization-code flow, state and S256 PKCE, and its authenticated-user endpoint can return the public user representation without `read:user`. We do not request email, repository access, organization membership or offline/refresh tokens. Previously authorized broader provider grants may still exist; the adapter discards fields outside its identity allowlist. See [GitHub authorization flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) and [authenticated user permissions](https://docs.github.com/en/rest/users/users#get-the-authenticated-user).

Pending attempts expire after ten minutes, are bounded to100 per broker and are consumed before token exchange. Wrong browser binding, expiry, replay and duplicate simultaneous callbacks fail. Provider endpoints are fixed, redirects are rejected, requests and response-body reads have enforced eight-second deadlines, and response bodies have explicit size limits. Raw provider errors, tokens, email and private profile fields are never returned. Unfinished attempts restart safely after process loss. This is a protocol foundation, not a distributed pending-state store.

Before wiring it to the current Node service:

1. Configure an explicitly registered GitHub application and fixed callback URL through supported secret delivery. Choose the application type and permitted deployment environment before activation; GitHub recommends considering a GitHub App. No app or secret was created/read during development.
2. Add start/callback/provider-availability routes behind an explicit configuration gate. Validate the actual request origin against configured public origin; never construct redirects from untrusted Host/forwarding headers. Rate-limit start/callback routes.
3. Store the browser binding in a ten-minute HttpOnly, SameSite=Lax cookie; use Secure for HTTPS. Callback state must match both the server challenge and the browser cookie. Do not reuse the existing Strict session cookie as the cross-site callback binding.
4. Map `(provider, subject)` to a local account in one transaction, rotate the application session and discard the provider token. Store only the public identity allowlist. Require explicit confirmation for any future linking of an existing local account. **Never auto-merge by username, display name or email.** A verified provider account is not proof of a real-world human identity.
5. Restore only a fixed local destination and the locally pending invitation. Sign-in must not accept the invitation, enter a room, grant access or start publication. Show the GitHub option only when the service actually enables it.
6. Verify sign-in/cancel/replay/account-switch behavior through real HTTP integration tests, then an explicitly authorized live OAuth trial. Current tests use a fake transport and synthetic client secrets; real consent screens, callbacks and provider behavior remain unverified.

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
