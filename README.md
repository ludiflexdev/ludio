# Fish Studio

A usable local voice studio powered by Fish Audio. Dark interface, real voice browsing and sample previews, consistent voice selection, and recordings that survive refresh.

## Start

Requires Node.js 22 or newer. No dependency installation is needed.

1. Keep your existing `.env`, or copy `.env.example` to `.env`.
2. Add `FISH_API_KEY` from [Fish Audio API Keys](https://fish.audio/app/api-keys/) and set `FISH_MODEL=s2.1-pro-free`.
3. Run `npm start`.
4. Open <http://127.0.0.1:5173>.
5. Open **Voice library**, preview a voice, and click **Use voice**. Write your script and click **Generate speech**.

`npm run dev` restarts the server when source changes. Set `PORT` in `.env` to use another port. Restart after changing `.env`.

## Features

- **Create speech:** recording title, saved draft, 3,000-character script, emotion cues, speed control, Ctrl/Cmd+Enter shortcut, MP3 playback and download.
- **Voice library:** live named voices from Fish Audio, language/name filters, licensed/community/owned sources, pagination, existing sample previews, local favorites, and voice-link/ID import.
- **Recordings:** persistent audio, script, voice ID/name, synthesis engine, speed, and generation timing. Search, play, download, reuse exact settings, or delete a local recording after confirmation.

Each studio generation requires a selected voice. The request uses its exact `reference_id`. “Voice” is the speaker identity; “engine” is `s2.1-pro-free`. Delivery may still vary between generations. The old prototype's unspecified default voice cannot be reliably identified afterward; its in-memory audio was not automatically imported. Existing MP3 files in `output/` are preserved.

## Storage and privacy

Drafts, selected voice, and favorites are stored in this browser's localStorage. MP3s and recording metadata are stored in IndexedDB, with a limit of 50 saved recordings. Delete older recordings to make room; download copies first. If storage is unavailable/full, the new clip remains playable and downloadable but is marked **Not saved**. Stored audio is specific to this browser and local origin; opening another browser or port starts a separate library.

The API key stays on the localhost server. `.env` is excluded from Git and the static-file allowlist. Voice sample previews use existing provider samples, with no synthesis request. Scripts go to Fish Audio when generating. No account sync, cloud uploads, or sharing is implemented.

## Free developer access

Checked October 3, 2026: Fish Audio advertises `s2.1-pro-free` access through **November 30, 2026**, subject to fair use and account eligibility. The studio always sends that exact engine header and never retries on a paid engine. Confirm current availability before using it after the advertised end date.

- [Official promotion](https://fish.audio/blog/s2-1-pro-free-api/)
- [Voice catalog API](https://docs.fish.audio/api-reference/endpoint/model/list-models)
- [Speech API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)

## Documentation and checks

- [Detailed UI and feature plan](docs/product-plan.md)
- [API implementation notes](docs/api-notes.md)
- [Validation results and limits](docs/validation.md)
- [VPS deployment with Dokploy](docs/dokploy-deployment.md)

Run `npm test` for offline server tests. Common API failures: 401 = credentials, 402 = credits/access, 429 = throttling, 502/504 = provider/network/timeout. Speech requests have a two-minute timeout, use one active generation at a time, and buffer audio before playback.

For a private VPS deployment, use the included Dockerfile and Dokploy guide. Production requires an HTTPS origin, private studio password, and Fish API key; the server listens on the container network and checks the configured origin. Hosted multi-user SaaS still requires individual accounts, isolated storage, and account-level rate limits.
