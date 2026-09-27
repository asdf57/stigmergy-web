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
