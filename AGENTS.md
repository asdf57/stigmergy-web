# Web console instructions

- The UI discovers generic resource routes/forms from OpenAPI in
  `src/AppMantine.jsx`. Reuse `apiFetch`/`authorizedFetch` for same-origin bearer
  auth and error handling; do not add a separate auth scheme or leak tokens to
  external links.
- Server provisioning uses `ServerProvisionButton.jsx` and the small tested
  `serverProvisioning.js` request/guard helpers. It is a desired-state spec PATCH,
  not a direct pipeline trigger or an invented API action endpoint.
- `ServerProvisionProgress.jsx` displays the checkpoint workflow and polls
  generic Server GET every five seconds while visible. Derive display states
  in `serverProvisioningProgress.js`; do not invent persisted event history or
  completed/skipped stages. Keep request counters separate from the previous
  attempt and reject stale/replaced-UID poll responses. Polling must never write.
- Show the approved stable disk and OS/ISO, require exact-name confirmation,
  increment the counter once and use If-Match. Never silently retry conflicts
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
