<img src="assets/icon.svg" width="64" height="64" alt="">

# T3 Office — friends in the building

Your original pixel-art office, with an optional **Friends & characters** menu. Based on [Felix Gollnhuber's T3 Office](https://github.com/felixgollnhuber/t3-office).

## First visit

Requires Node.js 22.18 or newer; Node 24 recommended.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Start in your original full-screen office; no account or AI provider is required. **Show me around** starts the optional first-user guide. Click a coworker to customize it, or open **People & chat → Friends** to create a local account and invite someone. Open the invitation in a private window to try a second account. Accounts created on this normal server persist in ignored `.local/building.sqlite`; passwords need at least12 characters and there is no account recovery yet.

The default service disables private T3 data routes. Accepting an invitation grants only its stated office scope; human conversations still require the host to open the room, admit the guest and each participant to enter explicitly. The guide does not create invitations, grant access or publish activity for you. Pause/resume, Skip and replay are available; guide hints store only step/timestamp/pause state in this browser session.

## Connect your own local T3 agents

```sh
npm run local
```

Open http://localhost:5173. The local launcher explicitly enables the read-only T3 connection on loopback. The original HUD, characters, interactions, themes, music and usage views remain. If T3 Code is unavailable, the original simulation is used. Do not expose this private companion to other computers; use the explicit publication bridge below.

For a guaranteed simulated office, use `/?source=demo&weather=clear`. To use another port: `npm run local -- --port 5174`. The untouched upstream revision is b14eb1c1f02933df071f62f32f79ed954dceadd8; its license and source provenance are preserved. The original reference README is [here](docs/upstream-readme.md).

## Names, work areas and friends

Open **Friends & characters** from the existing clock panel. In phone/kiosk mode a small menu button remains available.

Use the **Building view** button to zoom out into the interactive building on the original office canvas. It reuses the original pixel renderer, toon shading, textures, character models, lighting and clock/music HUD. Navigation is a small in-scene toolbar; **Floors** opens the optional directory, and selecting a floor opens its themed inspector. Click a floor or its label to zoom into that office; choose **Enter this office** to visit it. **Whole building** zooms back out, and **Back to office** closes the overview. Drag to turn the model and scroll over it to zoom. Only owned/granted floors appear; presence-only interiors stay opaque. You can also open `/?building=1` directly. Without an account, your own floor remains available and Friends & invitations opens the existing optional menu.

- **Click a character:** the side sheet opens on **Customize**. Rename the coworker, choose a work area, hairstyle, outfit, skin/hair/clothing colors or glasses, then **Save character**. A successful save closes the sidebar and smoothly returns the camera to the full office view. Changes apply without a reload and persist in this browser without an account. **Overview** and the existing thread reader remain available. Typing in the editor does not trigger office keyboard shortcuts. Friends’ characters remain read-only. **Your characters** in the menu is a picker that opens the same sidebar.
- **Friends:** optionally create/sign into a building account. Create a presence-only or activity invitation. Recipients sign in and explicitly accept the single-use link. The elevator selector shows only your own and invited floors, with a current-floor marker and online windows. Choosing another floor pulls the camera back to a cutaway building, closes the cabin doors, moves the elevator and changes its indicator, then opens the destination doors with a camera move into the office. Animation takes about two seconds, plus actual loading. **Skip animation** and system reduced-motion preferences bypass motion; neither bypasses access checks or office loading. Choosing a floor opens its office full screen. The **← Your floor** button is always available while visiting; floor numbers are positions in your authorized directory, not permanent building addresses.
- **Office style:** choose any of the four original themes, Original/Focus/Lounge furniture presets and Original/Warm/Cool lighting. Focus opens the break area by removing lounge furniture; Lounge adds sofa, beanbags and table tennis. Desk capacity and navigation remain unchanged. Preferences persist on this browser, without an account. Applying with an account also saves the room style for activity guests; starting browser sharing synchronizes the current look. Applying reloads the office and stops browser publishing until you explicitly start it again. Presence-only guests do not receive room preferences.
- **Sharing:** see exactly which guests have permission and what each can see, refresh/revoke access, and check the last server-received activity timestamp. This is a permission list, not a live viewer count. Browser publication and server freshness are shown separately because an external bridge may still be publishing. Explicitly choose **Share this office with my invited friends** to publish current character names, chosen work areas, provider, status and any customized character appearance. It starts off and is never resumed automatically on reload. No prompts, task titles, projects, paths, tools, conversations, context usage or costs are published. Closing the page stops new heartbeats; the shared office becomes offline after 45 seconds. **Stop sharing** pauses the office and immediately clears its snapshot.

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

The detailed usage view aggregates provider-native sessions over its selected range, including sessions outside T3. The reader now supports T3 Code 0.1.3’s v9 scan cache and older v5–v8 caches, uses the newest supported generation without merging overlapping caches, and validates cumulative Codex counters. Equal-sized genuine requests are counted; duplicate events and copied fork history are not. Append checkpoints validate the 64 bytes before their saved offset; same-size files with changed modification times are rescanned. Arbitrary earlier edits combined with an append are not fully detected by this boundary guard. Final JSONL tails count once, large files are read fully, and retained deleted-session history is preserved. Billing-model hints respect user overrides and aliases. Read failures are reported rather than presenting an uncached partial total as complete.

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

The existing starter history and Felix Gollnhuber's MIT license/authorship are retained. No external fork or remote repository has been created. Elevator travel uses a compact stylized cutaway animation. Human office chat is available locally; remote agent control remains outside this release. Created in [T3 Code](https://t3.codes).

## Try a simulated friend

Run `npm run demo:friends`, then open http://127.0.0.1:5175/preview/building for the complete interactive building, http://127.0.0.1:5175/preview/start for your simulated office or http://127.0.0.1:5175/preview/visit to visit Maya directly. Friends → Elevator shows both floors. Maya has eight synthetic coworkers with changing status, chosen names/work areas and a warm lounge style. The preview banner links between both offices.

This is a disposable, loopback-only demo with automatically signed-in synthetic accounts and an accepted synthetic invitation. It uses a temporary database, disables private T3 endpoints and never publishes real activity. The separate `127.0.0.1` host keeps its cookies apart from the normal `localhost` office; do not use it as a public service. Ctrl+C stops the simulation and removes its temporary database on clean shutdown. Restarting creates a fresh demo. Optional verification: `node scripts/friend-preview.mjs --check-browser`.

## Build together, celebrate, and take a tour

The original office remains home. Open **Friends & characters → More tools** and choose:

- **Build together**: start a 25- or 50-minute focus session, or explicitly join an invited friend's session. Joining shares your chosen display name and quiet preference with the host and joined participants. Close the panel to work in your office; its small timer stays visible and can reopen the session. Quiet mode suppresses the gentle halfway check-in. Leave or end the session when finished.
- **We shipped**: enter a short milestone, preview the audience/text, then explicitly publish to activity guests. Nothing is read from your agents or published automatically. Activity-granted friends also see the latest moment and a celebration lantern on your building floor. Owners can delete a moment or preview/download a safe PNG card; the export contains only the chosen title, kind, display name and date. A moment is owner-reported, not independent proof of completion. No upload occurs.
- **Take a tour**: replay the first-user guide: welcome, optional coworker customization, invitation, admitted visit, walking/chat and privacy controls. It follows your choices and does not create invitations, admit people or publish work. Continue later, Skip, keyboard controls and reduced motion are supported.

Focus sessions and moments use your optional building account. The existing invitation grant controls who can discover/join your session; only activity guests see moments. Joining is always a separate choice. Revocation removes membership and access; regranting does not rejoin. Sessions expire on server time, and moments retain for seven days with at most 20 per office/feed. Stopping agent activity sharing does not end a session or delete a moment—use those explicit controls.

For the full two-office first tour, run `npm run demo:friends` and open [the guided simulation](http://127.0.0.1:5175/preview/tour). This loopback-only launcher uses disposable synthetic identities and preaccepted demo invitations. Maya is explicitly scripted: she admits demo visit requests and sends a generic reply. Normal app routes never automatically sign in, accept invitations or create consent. The tour is user-paced and has no forced timer.

Verification: `npm test`, `npm run build`, `npm run test:e2e` (including the social browser checks), and `npm run test:tour`. `npm run test:social` runs just the synthetic multi-user social flow. No real private provider data is required.

## Personal floors and doorbell

Open **Friends & characters → Office style** to choose your accent, emblem and three raised shelf furnishings (plants, books or lamps). Apply saves and reopens the office, following the existing style behavior. The decor appears in your full office and building preview; defaults keep the original room. With an account, explicitly saved decor is visible to activity guests; presence-only guests never receive it. Your floor name remains editable under Sharing.

Open **Friends & characters → Doorbell** to let invited friends request to join your focus session. It starts off. Once enabled, new participants need **Let them join** approval; **Not now** declines. Guests can choose quiet mode before ringing and cancel their request. Rings expire after two minutes, and a one-minute cooldown prevents repeated ringing even after cancellation.

**Do Not Disturb** blocks new rings and focus participants, and declines pending requests. Existing participants remain. With both DND and ringing off, the original Join session action works. Approval never upgrades a guest's office access. No audio, messages, prompts or task information are sent. Dismissing an accepted request receipt does not leave the focus session; use its Leave session action.

`npm run test:doorbell` runs the synthetic two-user browser checks. It is also included in `npm run test:e2e`.

In the disposable demo, [Simulate a doorbell](http://127.0.0.1:5175/preview/doorbell) enables simulated Maya's doorbell; she automatically accepts valid demo rings. This behavior is confined to the demo launcher. If you already joined her focus session through Build together, leave it before trying a new ring.

## Human avatars, office conversations and walking

Open **People & chat** in the office, or from Friends & characters. **My avatar** sets your chosen human name, clothing color, hairstyle and availability. People have colored floor rings and explicit PERSON/YOU labels, separate from AI coworkers. Profile editing alone does not announce your presence.

Under **Visits**, an owner can open their office for conversations or enable Do Not Disturb. An invited friend requests an office visit; the owner explicitly admits or declines them. The guest then chooses to enter. Activity sharing, presence-only invitations and focus-session doorbells do not automatically grant human chat access. The focus doorbell offers a separate **Office visits & chat** entry point.

After entering, exchange plain-text messages in Conversation. Sending/Sent/Not sent states and a manual Retry action handle failures; retries do not duplicate accepted messages. Unread messages appear on the launcher while the panel is closed. Authors can delete their messages, and hosts can delete messages or remove visitors. Chat is stored as plaintext on this building server, not end-to-end encrypted. It never reads your agents, prompts, transcripts, files or usage automatically. Do not paste secrets.

**Walk** enables tap/click-to-walk on open floor, or arrow-key movement. Turn it off to restore normal camera panning. Human avatars use the original office navigation for local paths; remote movement is interpolated from bounded server updates. Walking is limited to the main office, not a walkable city or exterior. The current local implementation uses polling rather than WebSockets. Presence-only guests keep their generic room appearance; human admission does not reveal activity-only room/character customization.

Leaving removes your live avatar and chat read access. A missed heartbeat expires presence after 20 seconds. Revoking the underlying invitation grant, closing conversations or removing a guest denies subsequent reads and clears the UI; a fresh office grant does not restore conversation admission. Do Not Disturb blocks new visits and absent guests from re-entering while currently present people can remain. Admissions last while the room stays open and the grant remains valid; hosts can remove them. Requests expire in two minutes and have a one-minute cooldown.

Messages are limited to 500 characters, one per second and twenty per minute. Rooms retain at most 200 messages, display the most recent 100 available to you, and hide/prune messages older than seven days on room requests. Newly admitted guests see only messages sent after admission, using a sequence boundary even for identical timestamps. Downloaded or previously seen text cannot be recalled. Nothing is publicly hosted by enabling these local features.

`npm run test:humans` runs the synthetic two-user original-office avatar/chat/walking test; it is included in `npm run test:e2e`. Run `npm run demo:friends`, then open [Meet simulated Maya](http://127.0.0.1:5175/preview/people). Request entry, wait for the explicitly simulated host to admit you, enter the conversation, and send a greeting. Maya is a scripted simulation, not a real person or AI model; this automatic admission/reply behavior exists only in the disposable demo launcher.

## A simpler way to meet friends

Open **People & chat → Friends**. **Invite a friend** creates a presence-only invitation; copy its link. The recipient uses **Have an invite? → Add friend** in the same panel. Activity sharing remains a separate explicit choice under account/office settings.

Choose **Open & join my office** to accept visit requests and appear in your office in one action. Friends ring from their office card; you admit them and they choose to walk in. This does not bypass admission. **Visit settings** contains closing/DND; **People in this room** contains removal. Your avatar is under **You**. The original menu keeps focus, milestones, tour and doorbell under **More tools**. The synthetic preview's five shortcuts are under **Demo shortcuts**.

## Identity and cloud preparation

The tested GitHub identity adapter is a disabled integration foundation, not an available sign-in option. No GitHub app, real authorization or cloud service has been provisioned. [Identity/cloud preparation](docs/identity-cloud.md) records the verified local adapter, activation requirements and proposed Cloudflare boundary. Local accounts continue to work independently.

For the complete first-user verification locally, run `npm run test:onboarding`. It covers real two-browser setup, a scripted one-person demo, recovery/account races, keyboard/phone layouts and all four themes. `npm run test:tour` runs the fresh-account journey alone; `npm run test:onboarding:demo` runs the disposable scripted visit. These use synthetic accounts and isolated databases. No remote browser CI run is claimed.
