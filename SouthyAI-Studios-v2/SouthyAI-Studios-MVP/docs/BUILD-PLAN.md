# Build sequence

1. Deploy this foundation and verify `/api/health`.
2. Add authentication and customer accounts before storing real customer recordings.
3. Connect one low-cost script/creative-planning model behind a server-side adapter.
4. Connect image generation and a small number of short motion clips.
5. Connect TTS / customer-authorized voice cloning.
6. Render and assemble an MP4 using a dedicated rendering service (Workers are not an FFmpeg rendering environment).
7. Add provider cost ledger, usage limits, retries, moderation, watermarking and download unlock.
8. Add payment gateway and subscription/credit ledger after per-video unit economics are tested.
9. Complete POPIA review, consent withdrawal, retention/deletion, access controls and audit logs before public voice-data collection.

## Non-negotiable safeguards

- Never expose provider API keys in browser JavaScript.
- Do not use customer voice recordings for SouthyAI research/training unless the separate optional consent is affirmative.
- Do not clone another person's voice without verifiable authorization.
- Do not store voice samples in a public R2 bucket.
- Do not describe queued placeholder jobs as generated videos.
