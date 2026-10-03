# Fish Audio Studio — UI and functionality plan

Written October 3, 2026, before implementation. This document defines the first usable local product release and its acceptance criteria.

## 1. Product goal

Make creating, comparing, and reusing voice recordings a dependable daily workflow. A user should always know which voice and synthesis engine produced a recording, hear a voice before selecting it, and retrieve yesterday's recording after refreshing the page.

The current prototype proves synthesis works. Its main problems are excessive promotional copy, a sparse landing-page layout, manual voice IDs, a randomly assigned default voice, and recordings disappearing on refresh.

## 2. Reference interpretation and visual direction

The supplied image shows a dark Codex tools panel rather than a complete voice editor. Use its charcoal palette, layered rounded surfaces, understated separators, compact typography, and mint-green accent as the visual foundation. Build an original studio interface from those cues.

Design tokens:

| Element | Direction |
| --- | --- |
| Background | Near-black #141615 |
| Sidebar | #191c1a, separated by a subtle vertical rule |
| Cards / editor | #202421, elevated controls #292e2a |
| Text | Warm off-white, muted gray-green secondary text |
| Accent | Mint #b1eccb; reserve solid fills for the primary action |
| Borders | #333a34; stronger mint outline for selected voice |
| Typography | System sans-serif; 13–14px working text, 28px page title |
| Corners | 8–12px for controls, 16px for panels |
| Icons | Small consistent inline SVG icons, no decorative emoji |
| Motion | Brief hover/focus transitions; reduced-motion support |

Keep labels concise: “Create speech,” “Voice library,” “Recordings,” “Generate,” “Use voice,” “Preview,” “Reuse settings.” Remove the oversized hero, numbered steps, congratulatory copy, development instructions in the editor, and promotional paragraphs.

## 3. Application structure

### Shared shell

- Persistent left sidebar: brand, workspace name, Create speech, Voice library, Recordings, saved-voice count, and API status.
- Header: breadcrumb / active page, a compact free-model badge, and documentation link.
- Main area constrained for comfortable reading, without wasting large desktop space.
- At narrow widths, replace the sidebar with a compact top navigation. Stack editor and settings; keep all actions usable without horizontal scrolling.
- Real page states only. No fake profile menu, billing metrics, projects, or inactive product navigation.

### Create speech

- Editable recording title, substantial script editor, character count (3,000 max), estimated speaking duration labeled as an estimate, and a small example menu.
- Emotion buttons insert documented inline cues at the cursor instead of presenting generic demo text as the main workflow.
- Right settings panel: selected voice with initials avatar, language/style tags, Preview and Change actions, speaking-speed slider, and a compact engine/output row.
- Require an explicit voice ID for new studio generations. Persist the chosen voice and current draft locally.
- Generate action supports Ctrl/Cmd+Enter; disable while requests are running, with empty text, or until configuration and voice are ready.
- Inline failure message preserves all inputs and the previous playable recording.
- Result panel shows real audio controls, recording title, exact voice name and ID, engine, speed, generation time, Download MP3, and Reuse settings.
- Latest recordings appear below the editor, allowing immediate A/B comparison by playing separate clips.

### Voice library

- Fetch actual catalog data through the local server using Fish Audio's authenticated `/model` endpoint.
- Search by name, language filter, source tabs (licensed catalog / community / owned voices / locally saved voices), and pagination / Load more.
- Card layout: deterministic initials avatar, actual title, languages and style tags, creator when available, Preview, Use voice, and favorite action.
- Preview plays Fish Audio's existing sample; it does not silently generate speech or consume inference quota.
- Only show usable TTS voices, excluding untrained, taken-down, and retiring entries.
- Default to licensed English voices for a useful starting catalog; filters allow other languages and community voices.
- Favorites are local to this browser and do not modify the user's Fish Audio account.
- Add by voice ID: validate a 32-character ID or canonical Fish Audio voice URL, fetch its real details, and use/save it. Never invent labels for missing catalog entries.
- Clear loading, empty, no-sample, and failure states; Retry remains available.

### Recordings

- Persist generated MP3 blobs and metadata in browser IndexedDB, separately from lightweight preferences in localStorage.
- Each item records UUID, creation time, title, script, voice ID/name/details, engine, speed, audio size, and generation time.
- Play, download, and Reuse settings remain available after page reload. Reuse restores both script and the exact chosen voice. A recording can be deleted locally after the user confirms; recommend downloading it first.
- Search by recording title, script, or voice. Show newest first and a real count.
- Bounded local retention: retain at most 50 recordings. When full, generation remains available but explain that the new recording cannot be saved until local storage is managed; do not silently delete older audio.
- If browser storage is blocked or full, keep current audio playable/downloadable in memory and clearly mark it “Not saved.”
- No server-side sharing or account sync in this release; label storage as “This browser.”

## 4. Voice identity and consistency

“Engine” (`s2.1-pro-free`) and “voice” (`reference_id`) are different concepts. Fish Audio calls both synthesis engines and voice resources models in different parts of its API. The product must label them separately.

The original prototype omitted `reference_id` when the voice field was empty. Fish Audio's quick-start describes that as its default voice; the response is MP3 bytes and does not identify an automatically chosen voice. Therefore the previously liked second clip's named voice cannot be recovered from the existing request/response evidence. Do not label an arbitrary catalog voice as a match.

Future requests must send the explicitly selected voice ID. Save it with the result and preferences. This preserves voice identity across scripts, but generated delivery can still vary; do not promise identical waveforms or deterministic prosody.

The old prototype held audio only in browser memory. Refreshing it may lose the current unsaved clip. Preserve existing files under `output/`; do not claim that old in-memory clips have been migrated into the recording library.

## 5. API and architecture

Keep the existing dependency-free Node.js server and vanilla ES modules. A framework migration is unnecessary for this size of product; avoid adding build-tool complexity.

| Local endpoint | Purpose |
| --- | --- |
| GET /api/status | Safe key configuration and free-engine status |
| GET /api/voices | Validated search, language, source, page; normalized catalog data |
| GET /api/voices/:id | Normalize one real voice for manual import |
| GET /api/voices/:id/preview | Proxy an existing provider sample after checking its official CDN host |
| POST /api/tts | Existing free-only synthesis, with explicit voice metadata returned in headers |

Catalog responses return only product fields. Authenticate only to `https://api.fish.audio`. Sample requests never receive the API key. Restrict sample URLs to the observed official Fish Audio CDN, reject redirects, and set timeouts and payload limits. Render provider titles/tags with textContent, never raw HTML. Keep the server bound to localhost and preserve existing cross-origin checks and static-file allowlist.

The new browser sends a stable voice selection snapshot with each request. Controls may change during synthesis, but result metadata must match the submitted snapshot, not whatever is currently displayed afterward. Abort or sequence superseded catalog searches so an older response cannot overwrite current filters.

Store scripts/audio locally in this browser; do not log script content or credentials. Keep the exact free model header and fail on incorrect configuration without a paid fallback.

## 6. Implementation sequence

1. Write this plan and API notes.
2. Implement authenticated voice catalog/detail/sample proxy and safe normalization.
3. Rebuild the shared shell and three working screens using the dark theme.
4. Implement voice selection, filtering, preview, favorites, manual import, and persistent draft.
5. Implement generation snapshots, audio persistence, history, reuse, and download.
6. Extend meaningful API tests; validate real catalog access and explicit-voice synthesis.
7. Inspect desktop/narrow layouts and browser flows; document results and remaining limitations.

## 7. Acceptance criteria

- Catalog cards use names/IDs actually returned by Fish Audio.
- A user can preview and choose a named voice without copying an ID.
- Two synthesis requests using one selected voice send the same `reference_id` and free-engine header.
- Every recording displays voice name/ID and synthesis engine.
- Selected voice, draft, favorites, and saved recordings survive refresh.
- Reuse settings restores the recording's voice/script/speed.
- No paid fallback, API-key exposure, unsanitized provider HTML, or unrestricted preview URL fetching.
- Empty/error/loading states work, stale catalog responses cannot win, and the editor remains usable after failures.
- Navigation and controls work with keyboard focus and accessible labels; narrow layouts have no clipped actions.

## 8. Deferred production work

This release is a usable local studio, not a deployed multi-tenant service. Accounts, team workspaces, cloud recording storage, billing, rate limits per user, sharing links, voice cloning uploads, and realtime conversation are later projects. Do not show buttons for these until they work.

## 9. Sources

- [List Models](https://docs.fish.audio/api-reference/endpoint/model/list-models)
- [Get Model](https://docs.fish.audio/api-reference/endpoint/model/get-model)
- [Text to Speech API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)
- [Quick Start](https://docs.fish.audio/developer-guide/getting-started/quickstart)
- [Canonical OpenAPI contract](https://api.fish.audio/openapi.json)
- [Free developer promotion](https://fish.audio/blog/s2-1-pro-free-api/)

## 10. Implementation status

Implemented the planned local studio: three working screens, live voice catalog/detail/sample proxy, explicit voice selection, favorites and draft persistence, IndexedDB recordings, settings reuse, and confirmed local deletion. Kept the dependency-free runtime and exact free-engine guard. Validation and limitations are recorded in [validation.md](validation.md).

Provider verification revealed a second sample host in detail responses: a specific Cloudflare R2 account with signed task URLs. The preview allowlist covers that exact account and bucket path alongside the public CDN, without forwarding API credentials.
