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
the stable target disk, supported OS, boot ISO and SSH CA first. The confirmation
shows the disk/OS/ISO and requires the exact Server name: it authorizes permanent
replacement of that disk, not a normal reboot.

Confirmation sends one conditional spec merge PATCH enabling provisioning and
incrementing `reprovision` by one. It does not directly invoke Concourse or alter
status; the shared operator consumes desired state on its next run. Refresh the
Server to see its provisioning phase and observed counter. Pending/active work,
maintenance, paused/deleting resources or incomplete configuration disable the
action. A conflict requires refreshing and confirming again, never an automatic
retry.

Run `npm test` for request/safety regression checks. Tests use mocked requests;
never click the real provisioning confirmation during a UI smoke test.
