# Voice API implementation notes

Verified against the official OpenAPI contract and a live authenticated catalog request on October 3, 2026.

- Catalog: GET `https://api.fish.audio/model`; bearer authentication. Query fields: `page_size` (1–100), `page_number` (>=1), `title`, `language`, `self`, `licensed`, `sort_by` (`score`, `task_count`, `created_at`). Response: `items`, `total`, nullable `has_more`, and pagination window metadata.
- Detail: GET `/model/{id}`; response includes `_id`, `title`, `type`, `state`, `languages`, `tags`, `author`, `licensed`, `samples`, `dmca_taken_down`, and `pvc_release_state`.
- Samples: `samples[].audio` is an existing audio URL. The live licensed catalog returned HTTPS URLs under `platform.r2.fish.audio/task/*.mp3`. Detail responses instead returned temporary signed objects in the specific `c97f3361a1c971323738e24f451a0225.r2.cloudflarestorage.com` account under `/fish-platform-data/tasks/`. Both exact hosts are allowed; other R2 accounts and buckets are rejected. Never log signed URLs or forward bearer credentials to sample hosts.
- Synthesis: POST `/v1/tts`; set header `model: s2.1-pro-free` and JSON `reference_id` to the selected voice's `_id`. Response is MP3 bytes, not JSON voice metadata.
- Voice identity and synthesis engine must be separately labeled and persisted. There is no reliable retrospective identifier for the original prototype's unspecified default voice.
- Return normalized product data instead of full provider entities; do not expose account identifiers, quality diagnostics, or provider errors that may echo private data.
