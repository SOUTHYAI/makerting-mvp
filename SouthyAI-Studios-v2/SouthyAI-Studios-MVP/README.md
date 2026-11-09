# SouthyAI Studios MVP

A starter foundation for SouthyAI Studios: a one-prompt video creation dashboard, Cloudflare Worker API, D1 job records, and a consent-aware voice recorder.

## Important: what this first package does

- Provides the branded creator dashboard and prompt submission flow.
- Creates and tracks video jobs in Cloudflare D1.
- Includes a browser voice recorder that records a sample and uploads it to a private R2 bucket.
- Keeps optional SouthyAI research/training consent separate from permission to process a recording for the customer's own voice feature.
- Stores consent evidence (choice, timestamp, consent version, recording ID) in D1.
- Includes health and job-status endpoints.

## What is not connected yet

This is the **working platform foundation**, not a finished video-generation service. No AI image/video/voice provider is wired in yet, so submitted video jobs are recorded as `queued` and clearly labelled as awaiting a generation provider. The next integration is one affordable image/voice/render path, followed by a real end-to-end MP4 test.

Do not advertise generation as live until a provider and rendering pipeline have been connected and tested.

## 1. Create Cloudflare resources

Create:
- A D1 database named `southyai-studios-db`
- An R2 bucket named `southyai-studios-private`

Then update the database ID in `wrangler.toml`.

## 2. Apply the database schema

```bash
npx wrangler d1 execute southyai-studios-db --remote --file=./migrations/0001_init.sql
```

## 3. Configure and deploy the Worker

```bash
npm install
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Set `ADMIN_TOKEN` to a long random secret. Do not put it in frontend code or commit it.

## 4. Run locally

```bash
npm install
npm run dev
```

For local development, copy `.dev.vars.example` to `.dev.vars` and set a local `ADMIN_TOKEN`. Configure local D1/R2 resources in Wrangler if you want to test persistence locally.

## 5. GitHub upload

Upload the contents of this folder (not the outer ZIP file) into the private repository `SouthyAI-Studios-MVP`.

## API routes

- `GET /api/health`
- `POST /api/jobs` — JSON `{ "prompt": "...", "format": "vertical" }`
- `GET /api/jobs/:id`
- `POST /api/voice-recordings` — multipart form fields `audio` and `researchConsent`
- `GET /api/voice-recordings/:id` — metadata only; never returns raw audio publicly

## Voice consent model

The user's own voice feature and SouthyAI's optional research use are separate:
- The recording can be processed to provide the customer's requested voice feature under the service terms.
- Optional research/training consent is unchecked by default.
- If the customer does not opt in, the raw recording is marked `service_only` and is not approved for SouthyAI research/training.
- If the customer opts in, the recording is marked `research_opt_in`. This is not a blanket licence: the consent wording/version and withdrawal process must be reviewed before launch.

Before public launch, get South African POPIA/privacy advice, add account authentication, consent withdrawal/deletion workflows, abuse prevention, provider terms review, and payment integration.

## v2: Credits + Voice tool (new)

- Users make a studio account (email + a private key shown once), then spend **credits** on AI tools.
- Credits are added by you (admin) after you confirm payment (EFT / PayShap). Every movement is a row in `credit_ledger`, so you can always audit a balance.
- Voice tool: charges credits first (atomically, so double-clicks can't overspend), calls the voice engine, saves the MP3 privately in R2, and **refunds automatically** if the engine fails.
- Voice engine: free Cloudflare Workers AI (English) by default. Add `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` secrets to use ElevenLabs instead. Only switch on other languages (`ENABLED_LANGS`) after you've listened to the quality yourself.

### Extra setup for v2
```bash
npx wrangler d1 execute southyai-studios-db --remote --file=./migrations/0002_credits_voice_tool.sql
npx wrangler deploy
```

### Adding credits after someone pays
```bash
curl -X POST https://YOUR-WORKER-URL/api/admin/credits \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"email":"customer@example.com","amount":20,"ref":"EFT 8 Nov"}'
```

### Before public launch
Proper sign-in/recovery (the key can't be recovered if lost), rate limits per IP, an automated payment gateway, and price your credits above your provider cost.
