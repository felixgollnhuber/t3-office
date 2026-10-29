<img src="assets/icon.svg" width="64" height="64" alt="">

# T3 Office — friends in the building

Your original pixel-art office, with an optional **Friends & characters** menu. Based on [Felix Gollnhuber's T3 Office](https://github.com/felixgollnhuber/t3-office).

## Open your own office

Requires Node.js 22.18 or newer; Node 24 recommended.

```sh
npm ci
npm run local
```

Open http://localhost:5173. You start directly in your own full-screen office with the original HUD, characters, interactions, themes, music and usage views. No building account or dashboard is required. The local launcher explicitly enables the read-only T3 connection on loopback. If T3 Code is unavailable, the original simulation is used.

For a guaranteed simulated office, use `/?source=demo&weather=clear`. To use another port: `npm run local -- --port 5174`. The untouched upstream revision is b14eb1c1f02933df071f62f32f79ed954dceadd8; its license and source provenance are preserved. The original reference README is [here](docs/upstream-readme.md).

## Names, work areas and friends

Open **Friends & characters** from the existing clock panel. In phone/kiosk mode a small menu button remains available.

- **Your characters:** rename current characters and choose General, Frontend, Backend, Design, Testing, Research or Operations. Local names/areas persist in this browser and do not require an account. Inspect a character to see its chosen work area. Private task titles and project grouping retain the original behavior in your own office.
- **Friends:** optionally create/sign into a building account. Create a presence-only or activity invitation. Recipients sign in and explicitly accept the single-use link. The elevator selector shows only your own and invited floors, with a current-floor marker and online windows. Choosing a floor opens its office full screen. The **← Your floor** button is always available while visiting; floor numbers are positions in your authorized directory, not permanent building addresses.
- **Office style:** choose any of the four original themes, Original/Focus/Lounge furniture presets and Original/Warm/Cool lighting. Focus opens the break area by removing lounge furniture; Lounge adds sofa, beanbags and table tennis. Desk capacity and navigation remain unchanged. Preferences persist on this browser, without an account. Applying with an account also saves the room style for activity guests; starting browser sharing synchronizes the current look. Applying reloads the office and stops browser publishing until you explicitly start it again. Presence-only guests do not receive room preferences.
- **Sharing:** see exactly which guests have permission and what each can see, refresh/revoke access, and check the last server-received activity timestamp. This is a permission list, not a live viewer count. Browser publication and server freshness are shown separately because an external bridge may still be publishing. Explicitly choose **Share this office with my invited friends** to publish current character names, chosen work areas, provider and status. It starts off and is never resumed automatically on reload. No prompts, task titles, projects, paths, tools, conversations, context usage or costs are published. Closing the page stops new heartbeats; the shared office becomes offline after 45 seconds. **Stop sharing** pauses the office and immediately clears its snapshot.

Presence-only friends see online/offline state without names, work areas, agent counts or agents. Activity guests see only the fields you selected for sharing, including owner-chosen names and areas. Invitations last 24 hours and can be used once. Cancel invitations or revoke visitors in the menu. Authorization is checked on every read; a viewer refreshes normally every three seconds with seven-second request timeouts. A recipient may retain information already seen.

Accounts, grants, office character labels and snapshots persist in ignored `.local/building.sqlite`; use `BUILDING_DB` to select another path. Local-only aliases are in browser storage. Passwords use salted scrypt, and credentials are stored hashed. There is no email or account recovery yet. Profile/office names are visible to accepted visitors, so choose suitable names.

## Separate shared service and CLI bridge

For a building service that does not read any private local data, use `npm run dev`, or `npm run build` followed by `npm run serve`. Both start on loopback and disable private `/api/t3/*` and `/api/board` routes. The home screen remains an office; no data means the original demo. Public deployment still needs reviewed TLS/proxy, identity/abuse/recovery and backup configuration; this release is verified locally, not publicly hosted.

A participant can also publish using a separate loopback companion:

1. In **Friends & characters → Sharing**, create a publisher key. Save it outside the repository in a local file with permissions `600`, such as `~/.config/t3-office/publisher.key`.
2. Run the companion on the participant's own machine:

   ```sh
   npm run local -- --port 5174
   ```

3. Explicitly start the bridge:

   ```sh
   npm run bridge -- --server http://localhost:5173 --source http://localhost:5174 --token-file ~/.config/t3-office/publisher.key
   ```

The CLI sends up to 24 pseudonymous IDs, providers and statuses every 10 seconds, without raw thread IDs or work details. For a remote building, use an HTTPS origin. It rejects remote HTTP, non-loopback sources and redirects. Never tunnel the private companion. Publisher keys can only publish their owner's office, expire after 30 days and can be revoked. A revoked key cannot read offices or edit character labels.

CLI IDs are stable across restarts with the same key so server-side names/areas survive; rotating the key changes identities. CLI characters start with generic names and General areas; edit published character labels through your account's character menu when viewing a shared office. Browser sharing uses its own stable local identities. Use one publisher per office to avoid competing snapshots. A missing companion clears activity rather than substituting a demo. Restart the CLI after resuming if it exited on a pause response.

## Usage figures

The small **Receipt · today** counts processed tokens from completed T3 turns since local midnight, including cached input once. Reasoning tokens are already part of output and are not added again. This fixes the earlier receipt undercount. Its cost remains a simpler API-price estimate.

The detailed usage view aggregates provider-native sessions over its selected range, including sessions outside T3. The reader now supports T3 Code 0.1.3’s v9 scan cache and older v5–v8 caches, uses the newest supported generation without merging overlapping caches, and validates cumulative Codex counters. Equal-sized genuine requests are counted; duplicate events and copied fork history are not. Append checkpoints validate their prefix, final JSONL tails count once, large files are read fully, and retained deleted-session history is preserved. Billing-model hints respect user overrides and aliases. Read failures are reported rather than presenting an uncached partial total as complete.

The detail receipt shows its cache version and source refresh time; results may be cached for 45 seconds. These figures still need matching ranges, timezone and source scope for comparison, and API estimates are separate from subscription billing. The public/static demo is simulated. Confirmed implementation defects were fixed using synthetic regression fixtures and comparison with installed application code; the user’s exact paired figures have not been numerically reconciled.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Tests use synthetic accounts/sources and an isolated database. Browser checks cover original office/HUD startup without an account, persistent names and areas, explicit sharing, invitations, renderer updates, pause/revocation, saved room styles and guest rendering, elevator/home navigation, sharing visibility, mobile and German menus. Screenshots are ignored under `shots/`. No real prompts or provider transcripts are used in development tests. Local CI configuration exists; no remote CI or deployment has run.

## Project records

- [AGENTS.md](AGENTS.md): shared agent protocol.
- [Project context](docs/project.md): decisions and limits.
- [Tasks](docs/tasks.md): ownership, evidence and handoffs.
- [SECURITY.md](SECURITY.md): privacy boundaries.

The existing starter history and Felix Gollnhuber's MIT license/authorship are retained. No external fork or remote repository has been created. Continuous 3D elevator travel, chat and remote agent control are outside this release. Created in [T3 Code](https://t3.codes).
