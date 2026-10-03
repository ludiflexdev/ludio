# Deploy Fish Studio on a VPS with Dokploy

Prepared October 3, 2026. The application includes a Dockerfile and support for Dokploy's HTTPS reverse proxy. It has not yet been deployed to your VPS.

## Deployment model

Use one Dokploy **Application** containing the Node server and frontend. The container listens on `0.0.0.0:5173`; Dokploy/Traefik routes your HTTPS domain to that internal port. No database or persistent server volume is required because recordings live in each browser.

This configuration is a private studio protected by a shared username/password. It does not implement separate SaaS user accounts or cloud audio sync.

## 1. Connect the source

Push this project to your own repository and connect that repository in a Dokploy project/application. Include the Dockerfile, `.dockerignore`, source modules, and `public/`. Keep `.env` and `output/` private; `.gitignore` excludes them and the Docker build allowlist does not include them.

This workspace currently has no Git repository. No remote repository or upload has been created by this preparation work.

In **General**, select:

| Setting | Value |
| --- | --- |
| Build type | Dockerfile |
| Dockerfile path | Dockerfile |
| Docker context | . |
| Build path | Repository root |
| Replicas | 1 |

Do not select a static build: `/api/*` requires the Node backend. The image uses Node.js 22 Alpine, runs as the unprivileged `node` user, and has no npm dependencies to install.

## 2. Set runtime environment variables

In the application's **Environment** tab, add these runtime variables. Replace the domain, API key, and password. Do not put credentials in Docker build arguments or bake them into the image.

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=5173
APP_ORIGIN=https://studio.example.com
FISH_API_KEY=your_actual_fish_audio_api_key
FISH_MODEL=s2.1-pro-free
STUDIO_USERNAME=studio
STUDIO_PASSWORD=your_long_random_password
TTS_REQUESTS_PER_MINUTE=10
```

`APP_ORIGIN` must match the exact browser origin, including scheme and any nonstandard port, with no path. A trailing slash is normalized. Use a random 16–128-character password (ASCII works consistently with browser Basic Authentication). Production startup fails if the HTTPS origin, password, or API key is missing, or a paid engine is configured. The app does not load a bundled `.env` in the Docker image.

The browser will show a built-in sign-in prompt for `STUDIO_USERNAME` / `STUDIO_PASSWORD`. The Fish Audio API key remains a separate secret on the server. The password applies to the whole site and all voice/synthesis endpoints. `/healthz` is publicly accessible but returns only `{"status":"ok"}`.

The rate limit covers synthesis requests per minute across the entire single application instance. One active generation is allowed at a time. It is a personal-studio guard, not per-user SaaS quota tracking. Voice catalog and previews do not perform synthesis.

## 3. Configure your HTTPS domain

Point the domain's DNS A record to your VPS. In the application's **Domains** tab, add:

| Setting | Value |
| --- | --- |
| Host | studio.example.com (replace with your domain) |
| Path | / |
| Container port | 5173 |
| HTTPS | Enabled |
| Certificate | Let's Encrypt, or your configured certificate |

The domain's container port is internal Traefik routing. You do not need to publish `5173` through Advanced → Ports. Keep the container behind Dokploy's proxy so access uses the HTTPS domain.

Use the same domain in `APP_ORIGIN`. The app checks this configured origin directly, so it does not rely on trusting client-supplied forwarding headers to infer HTTPS. Dokploy terminates TLS; HTTP inside the container network is expected.

## 4. Deploy and verify

Deploy the application and inspect its logs. Successful startup prints the public studio URL without secrets. Health checks poll `/healthz`.

1. Open your HTTPS domain and sign in.
2. Confirm the page loads and the API configuration indicator appears.
3. Open Voice library and play a sample.
4. Select a voice, generate a short clip, and confirm playback and voice metadata.
5. Refresh and confirm the recording and selected voice return.
6. Check Download in the browser you intend to use.

The VPS needs outbound HTTPS access to Fish Audio and its sample hosts. If speech fails after roughly two minutes, inspect the application and proxy timeout configuration; the synthesis timeout is 120 seconds. An app redeploy can interrupt active requests. A stable domain keeps each browser's existing storage across redeploys.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Container exits at startup | Required runtime variables; password length; HTTPS APP_ORIGIN |
| Domain returns 502 | Container running; domain container port 5173; HOST=0.0.0.0 |
| Generate returns 403 | Browser URL exactly matches APP_ORIGIN; use the canonical domain |
| Sign-in keeps reappearing | STUDIO_USERNAME / STUDIO_PASSWORD; browser credential cache after changing them |
| Fish Audio returns 401 | Fish API key, separate from the studio password |
| Studio returns 429 | One generation already running, or global minute limit reached |
| Old localhost recordings missing | Different origins have separate browser storage; download old clips before moving |

## Scope and validation

Unit/integration checks cover production configuration, password protection, HTTPS origins, untrusted forwarding headers, request limiting, and the health endpoint. A local Docker image build could not be verified because the Docker daemon is not running on this machine. Build and runtime verification in Dokploy remain required; no VPS access or actual deployment was performed.

For a public product with independent users, add account authentication, per-user limits, shared recording storage, and an appropriate queue before increasing replicas. All signed-in visitors currently use the same Fish Audio API key, while their saved recordings stay in their individual browsers.

## Official references

- [Dokploy Dockerfile build settings](https://docs.dokploy.com/docs/core/applications/build-type)
- [Dokploy application environment settings](https://docs.dokploy.com/docs/core/applications)
- [Dokploy domain routing and container ports](https://docs.dokploy.com/docs/core/domains)
