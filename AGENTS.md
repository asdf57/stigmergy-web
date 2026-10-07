# Web console instructions

- The UI discovers generic resource routes/forms from OpenAPI in
  `src/AppMantine.jsx`. Reuse `apiFetch`/`authorizedFetch` for same-origin bearer
  auth and error handling; do not add a separate auth scheme or leak tokens to
  external links.
- Server provisioning uses `ServerProvisionButton.jsx` and tested helpers in
  `serverProvisioning.js`. Fetch UID-bound Machine storage, select one system disk
  and POST an immutable ProvisioningRun; never PATCH disk/counters into Server.
- `ServerProvisionProgress.jsx` follows activeRunRef/lastRunRef and polls generic
  Server and ProvisioningRun GET every five seconds while visible. Derive states
  in `serverProvisioningProgress.js`; do not invent persisted event history or
  completed/skipped stages. Keep run identities separate and reject stale or
  replaced-UID poll responses. Polling must never write.
- Show discovered disks and OS/ISO, require exact-name confirmation, and send
  the reviewed Server generation plus Server/Machine UIDs. Never retry conflicts
  or queue duplicate pending/active requests. A Provision click authorizes disk
  replacement; do not trigger a real node when testing UI code.
- Use `npm test`, `node src/serverProvisioning.test.js` for detailed case output,
  and `npm run build`. Safety tests use mock fetch callbacks only.
- The deployed source checkout is `/srv/homelab/stigmergy-web`. Fast-forward the
  pushed revision and use the existing private compose env file, project `infra`,
  and `up -d --build --no-deps stigmergy-web` for a UI-only deployment. Do not
  restart the API or unrelated services for frontend-only changes.
- Verify the served HTML/assets after rollout without issuing a provisioning
  request. Keep tokens/private env files out of source control and logs.
- The live UI is `https://stigmergy-ui.ryuugu.dev/`, not the API hostname
  `https://stigmergy.ryuugu.dev/`. A 401 at the API's `/` is not a frontend
  outage. Check the UI HTML's current hashed asset and UI `/readyz`; the latter
  proxies API readiness. Never test a Provision action against a real disk.
