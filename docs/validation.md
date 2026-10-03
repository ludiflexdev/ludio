# Validation — Fish Studio v0.2

October 3, 2026.

## Free studio expansion

The current offline suite passes **34 tests**, including free-model enforcement for all four formats, dialogue and pronunciation payloads, private fast-clone uploads with automatic synthesis disabled, custom voice editing/deletion, pending voice status and refresh, mutation origin checks, the bundled font route, and timestamp streams. Timestamp checks cover fragmented UTF-8/SSE frames, cumulative snapshot replacement, global timing offsets, subtitle export, and safe failure without retrying another model. Docker build context includes the new server modules.

A temporary Happy DOM and IndexedDB smoke check verified frontend startup, voice selection, cue insertion at the cursor, dialogue selection, pronunciation editing, PCM generation/playback URLs/download metadata, saved preferences, recording reuse, catalog refresh, and SRT download contents using mocked provider responses. No permanent frontend test dependencies were added.

The local server on port 5173 was restarted; `/fonts/manrope-variable.ttf` now returns HTTP 200, `font/ttf`, and the expected 164,700 bytes. The earlier server returned 404 for this route.

The added clone/edit/delete flows are covered with mocked providers; no real account voice was created or deleted during this expansion. New format controls and the current layout have not been visually inspected in a browser in this session because no browser automation surface was available. Earlier browser checks below describe the prior interface.

## Offline checks

`npm test`: 14 tests covering request validation, safe configuration, secret/static-file isolation, free-engine enforcement, error recovery, one active generation, explicit voice IDs across two requests, catalog filtering/normalization, preview-host restrictions, bounded preview responses, and provider failures. JavaScript syntax checks cover the frontend modules.

## Live API checks

- Licensed English catalog: HTTP 200, 20 matching voices, first page of 12 usable voices.
- Voice detail and existing sample preview: HTTP 200; proxy returned `audio/mpeg` (237,399 bytes for the tested sample).
- Two scripts with **Calm Narrator Voice**, ID `6d71c24e892b467ebef21f3dd3f4810a`: both returned HTTP 200, that exact voice ID, and `s2.1-pro-free`. The requests took approximately 2.9s and 2.3s. This verifies fixed speaker identity in the requests, not identical audio delivery.
- A browser generation with that voice returned a playable MP3 in approximately 5s and saved it to IndexedDB.

## Browser workflow checks

- Choose a catalog voice; Generate remains disabled before voice selection.
- Favorite a voice; saved count updates.
- Generate a named recording; result displays the voice and recording metadata.
- Refresh; chosen voice, draft, favorite, recording metadata, and audio are restored.
- Edit draft and click Reuse settings; original recording script and selected voice are restored.
- Saved tab lists the favorite after refresh.
- Desktop at 1280×900 and narrow layout at 390×844 inspected visually. Navigation, editor, voice settings, result, and voice cards fit their layouts.
- Desktop and mobile screenshots are retained under `output/studio-desktop.jpg` and `output/studio-mobile.jpg`.

MP3 response and playable saved audio were verified. Download links point to retained MP3 blobs with voice-specific filenames; a browser save-to-disk event has not been independently verified in this release.

## Known limits

- Browser-local storage; no cloud sync or user accounts. Other browsers/ports use separate libraries.
- Up to 50 stored recordings and 100 favorite voices. Storage errors leave a downloadable unsaved clip rather than deleting existing audio.
- The old prototype did not record an explicit voice ID or persist its audio. A previously liked unnamed voice cannot be identified reliably from the original MP3-only response.
- Samples are restricted to observed official Fish Audio hosts, including one specific R2 account/bucket path. If the provider changes CDN hosts, update the allowlist after verifying the new host.
- Synthesis varies in delivery even with the same voice ID. The studio fixes identity, not the waveform.
- The free tier has no latency/SLA guarantee and remains subject to Fish Audio's availability and fair-use rules.

## Dokploy preparation

Added a runtime Dockerfile, restricted build context, explicit HTTPS APP_ORIGIN, container HOST configuration, production Basic Authentication, global synthesis rate limit, and public minimal `/healthz`. The updated suite passes 20 tests, including proxy-compatible HTTPS requests, rejected foreign origins/forwarding-header spoofing, protected UI/API access, and rate limits. Local development still defaults to localhost with no studio sign-in requirement.

The Docker daemon is not running on this machine, so an actual image build/run was not verified. No VPS deployment was performed. Follow [dokploy-deployment.md](dokploy-deployment.md) for the runtime environment, domain settings, and deployment verification.
