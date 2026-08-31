Current behaviour.

# Business web deployment

`web/` (the business web app) is published to Azure Static Web Apps and
deploys automatically from `.github/workflows/deploy-web.yml` on every push
to `main` that touches `web/**` or the root `package.json` /
`package-lock.json` / `tsconfig.json`. It can also be run by hand from the
Actions tab ("Run workflow") — a manual run is refused unless it targets the
`main` ref.

## Public URL

`https://<static-web-app-name>.azurestaticapps.net` — the exact hostname is
assigned by Azure when the resource is created and is recorded on CAR-285
once the resource exists.

## What the workflow does

1. `npm ci` at the repo root (`web/` is an npm workspace sharing the root
   `package-lock.json`, same as `ci-web.yml`).
2. `npm run build` inside `web/`, with `VITE_API_URL` set to the live API
   origin. This is public configuration baked into the client bundle at
   build time — not a secret — and is read from the `VITE_API_URL` repo
   variable. There is no fallback: an unset or empty variable fails the
   workflow before the build runs, rather than silently shipping a guessed
   origin.
3. Deploy `web/dist` with `Azure/static-web-apps-deploy@v1`
   (`skip_app_build: true`, since the build already happened in step 2).

`web/public/staticwebapp.config.json` is copied into `web/dist/` by Vite and
tells Azure to serve `index.html` for any path it doesn't recognize as a
static asset, so client-side routes (`/sign-in`, `/register`,
`/register/status`, `/redemption`, `/rewards`, …) survive a direct visit or a
reload instead of getting a hosting-level 404.

## One-time setup (manual, not part of any workflow)

The Static Web App resource is created once, by hand — like `carma-migrate`
in `deploy.yml`, this is a step that holds a credential, so it stays out of
a workflow that could leak it:

```bash
az staticwebapp create \
  --name carma-web \
  --resource-group carma-rg \
  --location westeurope \
  --sku Free
```

Deliberately created without `--source`/`--branch` — that flag has Azure
generate and commit its own GitHub Actions workflow, which would fight with
`deploy-web.yml` over the same deployment. Then:

1. Read the deployment token: `az staticwebapp secrets list --name carma-web
   --resource-group carma-rg --query properties.apiKey -o tsv`.
2. Add it as the `AZURE_STATIC_WEB_APPS_API_TOKEN` repository secret.
3. Add the `VITE_API_URL` repository *variable* (Settings → Secrets and
   variables → Actions → Variables tab) with the live API origin.
4. Read the assigned hostname: `az staticwebapp show --name carma-web
   --resource-group carma-rg --query defaultHostname -o tsv`.

Until the secret exists, `deploy-web.yml`'s `check-secrets` gate skips the
deploy job and the workflow reports green — the same pattern `deploy.yml`
uses for the server, so this file is safe to merge ahead of the Azure
resource.

A manual "Run workflow" dispatch is refused with a failed run, not a silent
skip, if the selected ref isn't `main` — the workflow enforces this itself,
so there's no reliance on whoever runs it remembering to pick the right
branch.

## Browser-origin configuration (CAR-108, owned by Naveh)

The server's `CORS_ORIGINS` and refresh-cookie settings must include this
app's Azure origin before sign-in works from the deployed site. That
production configuration is CAR-108, not this document.
