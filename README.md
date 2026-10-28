<img src="assets/icon.svg" width="64" height="64" alt="">

# t3-office

A collaborative extension of [Felix Gollnhuber's T3 Office](https://github.com/felixgollnhuber/t3-office): a shared building where friends can visit each other's agent offices with permission granted beforehand.

## Run locally

Requires Node.js 22.18 or newer; Node 24 recommended.

```sh
npm ci
npm run dev
```

Open http://localhost:5173 and create your private office. Choose **Share simulated activity** to try it without T3 Code. Under **Invite a friend**, choose presence-only or agent-activity access and create a link. Open it in another browser profile, create a second account and accept the invitation. Only owned and explicitly shared offices appear in the directory.

Links are single-use and expire after 24 hours. Owners can revoke visitors, cancel unused invitations, rename their office and pause sharing. Pausing clears the snapshot; resuming does not restore old data. Server permission changes apply immediately; open viewers clear on their next refresh (normally 3–5 seconds, with a 7-second request timeout).

Accounts, grants and the latest snapshots persist in ignored `.local/building.sqlite`. `BUILDING_DB` can override that path. Passwords use salted scrypt; session, invitation and publisher credentials are stored hashed. Accounts belong to this building server; there is no email or account recovery yet.

## Connect real agent activity

The shared server disables private `/api/t3/*` and `/api/board` routes by default. Each participant runs a separate loopback companion on their own machine. The shared UI never fetches those private APIs.

1. Open **Manage your office → Connect live activity** and create a publisher key. Store it in a local file outside the repository, such as `~/.config/t3-office/publisher.key`, with permissions `600`.
2. Start a separate local companion on the machine running T3 Code:

   ```sh
   T3_LOCAL_DATA=1 npm run dev -- --port 5174
   ```

3. Explicitly start the bridge from that machine:

   ```sh
   npm run bridge -- --server http://localhost:5173 --source http://localhost:5174 --token-file ~/.config/t3-office/publisher.key
   ```

For a remote building, use its HTTPS origin as `--server`. The bridge rejects remote HTTP targets, non-loopback sources and redirects. Never tunnel or publicly host the companion. Live connection code is tested with synthetic sources; real private T3 data was not read during development.

The bridge publishes up to 24 anonymous IDs, provider names and statuses every 10 seconds. IDs are pseudonymized locally. Titles, prompts, conversations, file paths, tool output, models, costs and context usage stay out of the shared service. Publisher keys expire after 30 days and can only publish their owner's office; they cannot read offices or invite guests. Revoke them in owner controls.

Stop the simulation before starting a live bridge so two publishers do not compete. A missing companion clears activity rather than substituting a demo. After 45 seconds without a heartbeat, visitors see the office offline. Restart the bridge after resuming if it exited because sharing was paused.

## Verify and serve

```sh
npm test                    # HTTP permission/concurrency + bridge-filter tests
npm run build               # TypeScript checks and client build
npx playwright install chromium
npm run test:e2e            # isolated synthetic browser acceptance checks
npm run serve               # serve the built application locally
```

Synthetic browser screenshots go to ignored `shots/`. `npm start -- --no-open` also builds and serves through the upstream launcher. The original simulated office remains available at `/?source=demo&weather=clear`. There is no automatic deployment.

## Architecture and upstream

The lightweight directory loads the existing Three.js office for the selected floor only. Hidden floors do not keep renderers running. Every office read is authorized server-side; presence-only visitors receive no agents or counts. Shared views omit transcripts, cost and private project/quota controls.

Upstream source is pinned at **b14eb1c1f02933df071f62f32f79ed954dceadd8**, retaining Felix Gollnhuber's MIT license and authorship. The starter history and project records are preserved. No GitHub fork or remote repository has been created. See the [original README](docs/upstream-readme.md) for upstream features and URL options; private live data now requires explicit companion opt-in.

Implemented: accounts, floor directory, invitations, permissions, persistent state, simulated/live publication and selected-floor rendering. Continuous 3D elevator animation, chat, remote agent control, password recovery and managed hosting are outside this first milestone. Public hosting still requires a reviewed TLS/proxy and operational configuration; this release is verified locally.

## Privacy

There is no telemetry. The shared service stores account/display names, credential hashes, memberships and the latest explicitly published anonymous snapshot. Office/display names are visible to approved visitors. Invitation links grant their selected scope to whoever receives and accepts them, so deliver each link to the intended person.

Building/shared-office pages request no local T3 data or weather service. The original standalone office can request Open-Meteo or YouTube according to its settings; see the upstream privacy notes. Never include real work in screenshots or commit publisher keys. See [SECURITY.md](SECURITY.md) for boundaries and release limits.

## Project context

- [Agent instructions](AGENTS.md): working rules for every thread and harness.
- [Project context](docs/project.md): scope, approved decisions, constraints and open questions.
- [Tasks](docs/tasks.md): ownership, acceptance criteria, verification and handoffs.
- [Concept sketch](outputs/shared-building-concept.html): the original concept illustration.

Use the existing Project HQ conversation for priorities and shared decisions. Open a bounded task conversation for substantial execution; no separate permanent specialist conversations are needed yet.

Created in [T3 Code](https://t3.codes).
