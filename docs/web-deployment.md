Current behaviour.

# Business web deployment

`web/` (the business web app) runs as the `carma-business` Azure Container
App and deploys automatically from `.github/workflows/deploy-web.yml` on
every push to `main` that touches `web/**` or the root `package.json` /
`package-lock.json` / `tsconfig.json`. It can also be run by hand from the
Actions tab ("Run workflow") - a manual run is refused unless it targets the
`main` ref.

## Why a Container App and not Static Web Apps

Static Web Apps is the obvious host for this and is what CAR-284 was written
against. It cannot be used on our subscription. The service exists in five
regions only - Central US, East US 2, West US 2, West Europe, East Asia - and
the Azure for Students subscription carries a platform policy,
`sys.regionrestriction`, permitting five entirely different ones: Germany
West Central, Spain Central, UAE North, Poland Central, Israel Central. The
lists do not intersect. The policy is applied by the offer rather than by us,
so being Owner on the subscription does not allow exempting it.

A Container App running nginx costs consumption credit where Static Web Apps
would have been free, and in exchange it sits in Germany West Central beside
`carma-api`, reuses the existing registry and OIDC identity, and serves a
real HTTP 200 on a deep-link reload. (CAR-285)

## Public URL

`https://carma-business.whitedesert-5aabb28f.germanywestcentral.azurecontainerapps.io`

## What the workflow does

1. `npm ci` at the repo root (`web/` is an npm workspace sharing the root
   `package-lock.json`, same as `ci-web.yml`).
2. `npm run build` inside `web/`, with `VITE_API_URL` set to the live API
   origin. This is public configuration baked into the client bundle at
   build time - not a secret - and is read from the `VITE_API_URL` repo
   variable. There is no fallback: an unset or empty variable fails the
   workflow before the build runs, rather than silently shipping a guessed
   origin.
3. Log in to Azure over OIDC and to ACR, using the same managed identity and
   the same five secrets as `deploy.yml`. No new credential.
4. Build `web/Dockerfile` - nginx plus the `web/dist` from step 2 - tag it
   with the commit SHA, push it to ACR, and roll the Container App onto it.

`web/nginx.conf` serves `index.html` for any path that is not a file on disk,
so client-side routes (`/sign-in`, `/register`, `/register/status`,
`/redemption`, `/rewards`, `/permissions`) survive a direct visit or a reload
with a 200 instead of a hosting-level 404.

## One-time setup (manual, not part of any workflow)

```bash
az containerapp create \
  --name carma-business \
  --resource-group carma-rg \
  --environment carma-env \
  --image nginx:1.27-alpine \
  --target-port 8080 --ingress external \
  --min-replicas 0 --max-replicas 3 \
  --cpu 0.25 --memory 0.5Gi
```

The placeholder image is replaced by the first workflow run. Then point the
app at ACR, using the same admin credential `carma-api` uses:

```bash
az containerapp registry set \
  --name carma-business --resource-group carma-rg \
  --server carmaregistry3819.azurecr.io \
  --username <acr-user> --password <acr-password>
```

Finally add the `VITE_API_URL` repository *variable* (Settings -> Secrets and
variables -> Actions -> Variables tab) with the live API origin, and read the
assigned hostname:

```bash
az containerapp show --name carma-business --resource-group carma-rg \
  --query properties.configuration.ingress.fqdn -o tsv
```

Until `AZURE_CLIENT_ID` exists, `deploy-web.yml`'s `check-secrets` gate skips
the deploy job and the workflow reports green - the same pattern `deploy.yml`
uses for the server.

A manual "Run workflow" dispatch is refused with a failed run, not a silent
skip, if the selected ref is not `main`. The workflow enforces this itself,
so nothing relies on whoever runs it remembering to pick the right branch.

## Browser-origin configuration

A browser session from the deployed site needs two settings on `carma-api`,
both plain environment variables on the Container App:

```
CORS_ORIGINS=https://carma-business.whitedesert-5aabb28f.germanywestcentral.azurecontainerapps.io
REFRESH_COOKIE_SAMESITE=none
```

`CORS_ORIGINS` names that one origin and nothing else. It was `*` before, and
a wildcard is not a permissive version of this - the CORS spec forbids pairing
a wildcard with credentials, so the server refuses credentialed requests
entirely while it is set (`config.cors_allows_credentials`). No other origin
gets a credentialed session, preview URLs included.

`REFRESH_COOKIE_SAMESITE=none` is what keeps the browser attaching the refresh
cookie to `POST /api/auth/refresh` from the web app. `lax` would probably work
too, and that is the problem: whether the two hostnames count as one site is
decided by the Public Suffix List, which does not list `azurecontainerapps.io`
at all, so today both reduce to that one registrable domain. Microsoft lists
its other multi-tenant hosts there - `azurewebsites.net`,
`azurestaticapps.net`, `azure-api.net` - and an entry for this one, depending
on how it is written, could split the two apps into separate sites and drop
every session with no deploy and no warning. `none` is correct either way and
costs nothing here. It forces the Secure flag on, which production has anyway.

Nothing about CSRF rests on SameSite here. `/api/auth/refresh` and
`/api/auth/logout` require the `X-Requested-With` header
(`core.deps.require_browser_header`), which forces a preflight that only an
allow-listed origin can pass.

The cookie the browser receives is `carma_refresh`, `HttpOnly`, `Secure`,
`SameSite=None`, `Path=/api/auth`, 30 days. Mobile never sees any of this - it
authenticates with a bearer token and sends no cross-origin request.
