# Deploying CivicProof

| Part | Where | How |
| --- | --- | --- |
| Web app (`apps/web`) | **Northflank** | Docker image from `deploy/web/Dockerfile` (this folder) |
| Backend (database, auth, `civicproof-api`) | **Supabase** | Already deployed by P2. See `docs/SUPABASE-SETUP.md` |
| Contracts | **Avalanche Fuji** (BNB testnet ready) | `contracts/`: addresses in `contracts/deployments/` |

There is no separate API server to host: the browser talks to Supabase directly.

## Web app on Northflank

The image builds the Vite app, then serves the static files with unprivileged nginx on **port 8080**. The nginx config sends every unknown path to `index.html`, so React Router deep links like `/projects/CP001` work on refresh. `GET /healthz` returns `200 ok` for health checks.

### One-time setup

1. **Create a project** in Northflank (any region close to South Africa / Europe).
2. **Add a service → Combined service** (build + deploy in one).
3. **Repository:** connect GitHub and choose `Wityd/civic_proof`, branch **`main`**.
4. **Build type: Dockerfile**
   - Build context: `/`
   - Dockerfile location: `/deploy/web/Dockerfile`
5. **Build arguments.** These are *build* arguments, not runtime variables: Vite bakes them into the JavaScript.

   | Build argument | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the Supabase **anon / publishable** key |
   | `VITE_API_URL` | `https://<project-ref>.supabase.co/functions/v1/civicproof-api` |
   | `VITE_USE_MOCKS` | `false` (`true` serves the built-in mock data, useful as a demo fallback) |

   > 🔐 Only public values belong here: they end up in every visitor's browser. **Never** put the service-role key, `DEPLOYER_PRIVATE_KEY` or an AI key in a `VITE_*` argument.

6. **Networking:** port **8080**, protocol **HTTP**, **public** (Northflank gives you a `*.code.run` URL).
7. **Health check (optional):** HTTP `GET /healthz` on port 8080.
8. **Create service.** The first build takes a few minutes.

With the service building from `main`, every merged PR redeploys the site automatically.

### Checking a deployment

- Open the Northflank URL: the public dashboard should load.
- Refresh on a deep link (e.g. `/projects/CP001`): it should still load, not 404.
- `https://<your-url>/healthz` should return `ok`.
- Browser dev tools → Network: calls go to `*.supabase.co` and return 200 (or 401 before signing in).

### Building the same image locally

```bash
docker build -f deploy/web/Dockerfile \
  --build-arg VITE_SUPABASE_URL=https://<project-ref>.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=<anon-key> \
  --build-arg VITE_API_URL=https://<project-ref>.supabase.co/functions/v1/civicproof-api \
  -t civicproof-web .
```

```bash
docker run --rm -p 8080:8080 civicproof-web
```

Then open http://localhost:8080.

### Demo-day fallback

If Supabase or the venue network misbehaves, rebuild with `VITE_USE_MOCKS=true`. The site then runs entirely on the built-in mock data, with no backend calls.
