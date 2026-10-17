# Stigmergy Web

A standalone, responsive operator console for the Stigmergy API. It discovers
resources and operations from the API's OpenAPI document at runtime. The UI is
built with Mantine components; OpenAPI schemas are rendered with the Mantine
renderer for react-jsonschema-form.

## Run locally

Start the Stigmergy API on port 8080, then:

```sh
npm install
npm run dev
```

Open <http://localhost:4173>. The development server listens on `0.0.0.0` and
proxies API requests to `http://127.0.0.1:8080`.

To use another API address:

```sh
STIGMERGY_API_URL=http://192.168.1.10:8080 npm run dev
```

The File registry navigation item opens Copyparty at
`https://copyparty.ryuugu.dev/`. To point it at another deployment, set:

```sh
VITE_FILE_REGISTRY_URL=https://files.example.com/ npm run dev
```

## Production build

```sh
npm run build
npm run preview
```

## Server provisioning

Servers have a **Provision** action in list rows/cards and detail pages. Configure
the supported OS, boot ISO, SSH CA and provisioning.enabled first. This flag
alone never installs. The dialog fetches the bound Machine's discovered disks
and shows model, capacity, serial/WWN and transport. Select one system disk;
USB, unidentified and ambiguous devices are unavailable. Type the exact Server
name to authorize permanent replacement of the selected disk, not a normal reboot.

Confirmation POSTs an immutable ProvisioningRun with the Server/Machine UIDs,
reviewed Server generation and selected disk ID. The API atomically reserves the
Server; it conflicts if the desired configuration/binding changed or another run
already owns it. No automatic retry or direct Concourse invocation occurs.

Server detail follows activeRunRef/lastRunRef and polls Server/run status every
five seconds while visible. The panel shows every workflow checkpoint, current
phase, failure/maintenance message, run/build identity and timestamps. It is a
workflow view, not an invented event history. LastSuccessfulRunRef remains the
last verified installation even when a later run fails. Refresh failures retain
the last status, and stale/replaced-UID responses cannot overwrite it. Reserved,
paused/deleting/unbound or incomplete Servers cannot request another run.

Run `npm test` for request/safety regression checks. Tests use mocked requests;
never click the real provisioning confirmation during a UI smoke test.

## Resource inspection

All discovered resource kinds appear in navigation, including a fallback category
for new API kinds. List pages filter by text, reported phase, related Server and
labels (for example `cluster=lab`). Server filters use explicit resource references;
the UI does not infer command targets by parsing scripts.

Detail pages show clickable named references, readable controller conditions,
checkpoint/failure messages and reported generations. Server storage panels load
the UID-bound Machine and this Server's DiskPartitions, displaying desired layouts
separately from discovered disks/filesystems. Refresh storage to read newer reports.
These panels only read resources; they never reconcile storage or create requests.

KubeCluster details separate cluster setup from component Configurations. Components
are associated through an explicit Kubernetes context reference, or a cluster target
and dependency chain leading to cluster setup. The panel links each Configuration
and its dependencies, showing reported reconciliation and last verification time.
Changed generations, replaced references and stale observations are not shown as
currently verified. This is not a live Kubernetes workload inventory.

SSHCertificate details show validity/expiry/renewal dates. Server and ISO details
compare desired trust digests with reported installed or completed-image digests.
Matching digests and valid dates alone are not proof of live health/readiness.

Pipeline, ISO, CommandsPipeline and Command details resolve Concourse links through
the recorded Pipeline/provider. Commands link to their recorded global build ID.
ProvisioningRun currently lacks a provider-qualified build reference, so the UI
shows its reported backend ID without guessing a pipeline or build URL. Unknown or
replaced references are surfaced rather than silently linked to another execution.
