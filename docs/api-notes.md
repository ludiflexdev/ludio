# Voice API implementation notes

Verified against the official OpenAPI contract and a live authenticated catalog request on October 3, 2026.

- Catalog: GET `https://api.fish.audio/model`; bearer authentication. Query fields: `page_size` (1–100), `page_number` (>=1), `title`, `language`, `self`, `licensed`, `sort_by` (`score`, `task_count`, `created_at`). Response: `items`, `total`, nullable `has_more`, and pagination window metadata.
- Detail: GET `/model/{id}`; response includes `_id`, `title`, `type`, `state`, `languages`, `tags`, `author`, `licensed`, `samples`, `dmca_taken_down`, and `pvc_release_state`.
- Samples: `samples[].audio` is an existing audio URL. The live licensed catalog returned HTTPS URLs under `platform.r2.fish.audio/task/*.mp3`. Detail responses instead returned temporary signed objects in the specific `c97f3361a1c971323738e24f451a0225.r2.cloudflarestorage.com` account under `/fish-platform-data/tasks/`. Both exact hosts are allowed; other R2 accounts and buckets are rejected. Never log signed URLs or forward bearer credentials to sample hosts.
- Synthesis: POST `/v1/tts`; always set header `model: s2.1-pro-free`. JSON `reference_id` is the selected voice ID or an array of up to eight voice IDs for dialogue; scripts use zero-based `<|speaker:N|>` tags. Audio bytes are returned in MP3, WAV, Opus, or PCM format.
- Voice identity and synthesis engine must be separately labeled and persisted. There is no reliable retrospective identifier for the original prototype's unspecified default voice.
- Return normalized product data instead of full provider entities; do not expose account identifiers, quality diagnostics, or provider errors that may echo private data.

## Free audio controls

Speech settings map to the official [TTS contract](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech): `prosody`, `temperature`, `top_p`, `normalize`, `latency`, format-specific sample rates/bitrates, and chunk controls. Inline pronunciation is `pronunciation_dictionary: [{items: [{key, value, case_sensitive}]}]`. Local JSON requests are bounded at 160 KB to accommodate 100 pronunciation rules and a 3,000-character script.

The [voice creation endpoint](https://docs.fish.audio/api-reference/endpoint/model/create-model) receives multipart uploads through POST `/api/custom-voices`. The proxy forces `type=tts`, `train_mode=fast`, `visibility=private`, and `generate_sample=false`, avoiding implicit sample generation on another model. Uploads are capped at 30 MB total and 20 samples; supplied transcripts must match every sample. PATCH and DELETE `/api/custom-voices/{id}` proxy metadata editing and deletion with the server's API credentials. Provider account permissions determine ownership; errors are sanitized. Mutations retain the studio's authentication, origin checks, and request limits.

Owned catalog results retain created/training/failed states so users can track new clones; other catalog sources remain trained-only. A manual refresh and successful mutations invalidate the 60-second catalog cache. PCM downloads preserve raw samples; browser previews wrap the 16-bit mono samples in a WAV header.

Optional timestamp generation calls `/v1/tts/stream/with-timestamp` with the same free model header and validated settings. Audio chunks concatenate in arrival order; alignment snapshots replace earlier values for each `chunk_seq`. Each segment receives its chunk's absolute offset. The parser handles SSE framing and UTF-8 fragments, bounds the stream/audio, and excludes arbitrary provider fields. Recordings retain the word timeline, with SRT and JSON exports available in their details.

No transcription, voice-design, or voice-agent endpoints are exposed. No fallback to a paid TTS model is permitted. Free-tier availability remains subject to the [official developer promotion](https://fish.audio/blog/s2-1-pro-free-api/).
