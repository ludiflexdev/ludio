# Studio

A local audio studio powered by Fish Audio's free developer API. Rounded dark interface, green accents, a bundled Manrope font, real voice browsing, and recordings that survive refresh.

## Start

Requires Node.js 22 or newer. No dependency installation is needed.

1. Keep your existing `.env`, or copy `.env.example` to `.env`.
2. Add `FISH_API_KEY` from [Fish Audio API Keys](https://fish.audio/app/api-keys/) and set `FISH_MODEL=s2.1-pro-free`.
3. Run `npm start`.
4. Open <http://127.0.0.1:5173>.
5. Open **Voice library**, preview a voice, and click **Use voice**. Write your script and click **Generate speech**.

`npm run dev` restarts the server when source changes. Set `PORT` in `.env` to use another port. Restart after changing `.env`.

## Features

- **Create speech:** saved title and draft, a 3,000-character script, 93 searchable emotion/delivery/sound cues and custom directions, speed, volume, expressiveness, diversity, normalization, latency, and chunk controls. Generate with Ctrl/Cmd+Enter or the wave button.
- **Dialogue:** choose up to eight voices, then insert speaker tags at the cursor to switch between them.
- **Custom voices:** upload 1–20 audio samples (30 MB total), optional matching transcripts, and sample enhancement. Clones are private and use fast training. Track their status under My voices; refresh, edit metadata/tags, or delete owned voices.
- **Voice library:** live named voices, language/name filters, licensed/community/owned sources, pagination, existing sample previews, local favorites, and voice-link/ID import.
- **Output:** MP3, WAV, Opus, or raw PCM with compatible sample rates and bitrates. PCM uses a WAV wrapper for browser playback while downloads retain the original PCM.
- **Pronunciation:** up to 100 local word-to-phoneme rules, included inline in speech requests.
- **Subtitles:** optional word alignment via the free timestamp endpoint, with SRT subtitle and JSON timing downloads for saved recordings.
- **Recordings:** persistent audio, scripts, all speaker identities, speech settings, and generation timing. Search, play, download, reuse settings, or delete a local recording after confirmation.

Each studio generation requires a selected voice. The request uses its exact `reference_id`. “Voice” is the speaker identity; “engine” is `s2.1-pro-free`. Delivery may still vary between generations. The old prototype's unspecified default voice cannot be reliably identified afterward; its in-memory audio was not automatically imported. Existing MP3 files in `output/` are preserved.

## Storage and privacy

Drafts, selected voices, favorites, pronunciation rules, and speech settings are stored in this browser's localStorage. Audio and recording metadata are stored in IndexedDB, with a limit of 50 saved recordings. Delete older recordings to make room; download copies first. If storage is unavailable/full, the new clip remains playable and downloadable but is marked **Not saved**. Stored recordings are specific to this browser and local origin; opening another browser or port starts a separate library.

The API key stays on the server. `.env` is excluded from Git and the static-file allowlist. Voice previews use existing provider samples without synthesis. Scripts and pronunciation rules go to Fish Audio when generating. Cloning uploads your audio and transcripts to Fish Audio and creates a private voice in your Fish account; edits and deletion affect that account. Generated recordings remain in browser storage, with no recording sync or sharing.

## Free developer access

Checked October 3, 2026: Fish Audio advertises `s2.1-pro-free` access through **November 30, 2026**, subject to fair use and account eligibility. The studio always sends that exact engine header and never retries on a paid engine. Confirm current availability before using it after the advertised end date.

- [Official promotion](https://fish.audio/blog/s2-1-pro-free-api/)
- [Voice catalog API](https://docs.fish.audio/api-reference/endpoint/model/list-models)
- [Speech API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)
- [Custom voice API](https://docs.fish.audio/api-reference/endpoint/model/create-model)

This studio focuses on the free TTS model and its voice workflow. Separate paid transcription and voice-design models are excluded. Automatic sample synthesis is disabled when cloning. Quality guard is optional and depends on provider availability. Timestamp requests use the [free streaming endpoint](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech-stream-with-timestamps); audio and the latest alignment snapshots are assembled before playback. Live WebSocket playback is not implemented.

## Documentation and checks

- [Detailed UI and feature plan](docs/product-plan.md)
- [API implementation notes](docs/api-notes.md)
- [Validation results and limits](docs/validation.md)
- [VPS deployment with Dokploy](docs/dokploy-deployment.md)

Run `npm test` for offline server tests. Common API failures: 401 = credentials, 402 = credits/access, 429 = throttling, 502/504 = provider/network/timeout. Speech requests have a two-minute timeout, use one active generation at a time, and buffer audio before playback.

For a private VPS deployment, use the included Dockerfile and Dokploy guide. Production requires an HTTPS origin, private studio password, and Fish API key; the server listens on the container network and checks the configured origin. Hosted multi-user SaaS still requires individual accounts, isolated storage, and account-level rate limits.
