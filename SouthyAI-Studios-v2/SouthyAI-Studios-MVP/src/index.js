const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type,Authorization,X-Admin-Token",
    "vary": "Origin"
  };
}


// ---------- Studio accounts, credits and tools ----------
const TOOLS = { voice: { cost: 2, maxChars: 500 } }; // cost is in credits; price your credits above what the provider charges you

function enabledLangs(env) {
  return String(env.ENABLED_LANGS || "en").split(",").map((x) => x.trim()).filter(Boolean);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAdmin(request, env) {
  return Boolean(env.ADMIN_TOKEN) && safeEqual(request.headers.get("x-admin-token") || "", env.ADMIN_TOKEN);
}

async function getUser(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  return env.DB.prepare("SELECT id, email FROM users WHERE token_hash = ?").bind(await sha256(token)).first();
}

async function balanceOf(env, userId) {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(delta), 0) AS bal FROM credit_ledger WHERE user_id = ?").bind(userId).first();
  return row ? row.bal : 0;
}

function addLedger(env, userId, delta, reason, ref) {
  return env.DB.prepare("INSERT INTO credit_ledger (id, user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(makeId("led"), userId, delta, reason, ref || null, new Date().toISOString()).run();
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// One voice engine adapter. ElevenLabs if configured, otherwise Cloudflare Workers AI (free allowance, English).
async function generateVoice(env, text, lang) {
  if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID) {
    const r = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(env.ELEVENLABS_VOICE_ID) + "?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || "eleven_multilingual_v2" })
      }
    );
    if (!r.ok) throw new Error("Voice provider error (" + r.status + ")");
    return { bytes: await r.arrayBuffer(), contentType: "audio/mpeg", provider: "elevenlabs" };
  }
  if (env.AI && lang === "en") {
    const out = await env.AI.run("@cf/myshell-ai/melotts", { prompt: text, lang: "en" });
    const b64 = typeof out === "string" ? out : out && out.audio;
    if (!b64) throw new Error("Voice engine returned no audio");
    return { bytes: fromBase64(b64), contentType: "audio/mpeg", provider: "workers-ai" };
  }
  throw new Error("No voice engine is connected for this language yet.");
}

async function handleStudio(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/register" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: "Please enter a valid email address." }, 400);
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (exists) return json({ error: "This email already has a studio key. Use that key to sign in." }, 409);
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = "studio_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const id = makeId("usr");
    await env.DB.prepare("INSERT INTO users (id, email, token_hash, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, email, await sha256(token), new Date().toISOString()).run();
    const bonus = parseInt(env.SIGNUP_CREDITS || "0", 10);
    if (bonus > 0) await addLedger(env, id, bonus, "signup_bonus", null);
    return json({ ok: true, token, email, balance: Math.max(bonus, 0), message: "Save this key somewhere safe. It is shown only once." }, 201);
  }

  if (path === "/api/admin/credits" && method === "POST") {
    if (!isAdmin(request, env)) return json({ error: "Not allowed." }, 401);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const amount = parseInt(body.amount, 10);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) return json({ error: "Amount must be a whole number." }, 400);
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (!user) return json({ error: "No studio account with that email." }, 404);
    await addLedger(env, user.id, amount, amount > 0 ? "topup" : "adjustment", String(body.ref || "").slice(0, 120));
    return json({ ok: true, balance: await balanceOf(env, user.id) });
  }

  if (path === "/api/me" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return json({ error: "Please sign in first." }, 401);
    return json({
      ok: true,
      email: user.email,
      balance: await balanceOf(env, user.id),
      tools: { voice: { cost: TOOLS.voice.cost, maxChars: TOOLS.voice.maxChars, languages: enabledLangs(env) } }
    });
  }

  if (path === "/api/tools/voice" && method === "POST") {
    const user = await getUser(request, env);
    if (!user) return json({ error: "Please sign in first." }, 401);
    const body = await request.json().catch(() => ({}));
    const text = String(body.text || "").trim();
    const lang = String(body.language || "en");
    if (text.length < 2) return json({ error: "Type what you want the voice to say." }, 400);
    if (text.length > TOOLS.voice.maxChars) return json({ error: "Keep it under " + TOOLS.voice.maxChars + " characters for now." }, 400);
    if (!enabledLangs(env).includes(lang)) return json({ error: "That language isn't switched on yet." }, 400);

    const genId = makeId("gen");
    const cost = TOOLS.voice.cost;
    const now = new Date().toISOString();
    // Charge first, and only if the balance covers it (one atomic statement, so two quick clicks can't overspend).
    const charge = await env.DB.prepare(
      "INSERT INTO credit_ledger (id, user_id, delta, reason, ref, created_at) SELECT ?, ?, ?, 'voice', ?, ? WHERE (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = ?) >= ?"
    ).bind(makeId("led"), user.id, -cost, genId, now, user.id, cost).run();
    if (!charge.meta || charge.meta.changes !== 1) {
      return json({ error: "Not enough credits. Top up to keep creating.", balance: await balanceOf(env, user.id) }, 402);
    }
    try {
      const out = await generateVoice(env, text, lang);
      const key = "voice-results/" + user.id + "/" + genId + ".mp3";
      await env.VOICE_BUCKET.put(key, out.bytes, { httpMetadata: { contentType: out.contentType } });
      await env.DB.prepare("INSERT INTO generations (id, user_id, tool, input_text, language, provider, cost, result_key, created_at) VALUES (?, ?, 'voice', ?, ?, ?, ?, ?, ?)")
        .bind(genId, user.id, text, lang, out.provider, cost, key, now).run();
      return json({ ok: true, generation: { id: genId, language: lang, createdAt: now }, balance: await balanceOf(env, user.id) }, 201);
    } catch (error) {
      await addLedger(env, user.id, cost, "refund", genId);
      return json({ error: "The voice engine couldn't make that one. Your credits were returned.", balance: await balanceOf(env, user.id) }, 502);
    }
  }

  if (path === "/api/generations" && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return json({ error: "Please sign in first." }, 401);
    const { results } = await env.DB.prepare(
      "SELECT id, tool, input_text AS text, language, created_at AS createdAt FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 20"
    ).bind(user.id).all();
    return json({ ok: true, generations: results || [] });
  }

  const audioMatch = path.match(/^\/api\/generations\/([A-Za-z0-9_-]+)\/audio$/);
  if (audioMatch && method === "GET") {
    const user = await getUser(request, env);
    if (!user) return json({ error: "Please sign in first." }, 401);
    const gen = await env.DB.prepare("SELECT result_key FROM generations WHERE id = ? AND user_id = ?").bind(audioMatch[1], user.id).first();
    if (!gen) return json({ error: "Not found." }, 404);
    const obj = await env.VOICE_BUCKET.get(gen.result_key);
    if (!obj) return json({ error: "File missing." }, 404);
    return new Response(obj.body, { headers: { "content-type": "audio/mpeg", "cache-control": "private, no-store" } });
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        let databaseConnected = false;
        try {
          await env.DB.prepare("SELECT 1").first();
          databaseConnected = true;
        } catch {}
        return json({
          ok: true,
          app: "SouthyAI Studios",
          version: "0.1.0",
          databaseConnected,
          voiceStorageConfigured: Boolean(env.VOICE_BUCKET)
        });
      }

      if (url.pathname === "/api/jobs" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const prompt = String(body.prompt || "").trim();
        const format = body.format === "landscape" ? "landscape" : "vertical";
        if (prompt.length < 8) return json({ error: "Please enter a more detailed video idea (at least 8 characters)." }, 400);
        if (prompt.length > 3000) return json({ error: "Your prompt is too long. Please keep it under 3,000 characters." }, 400);

        const id = makeId("job");
        const createdAt = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO video_jobs (id, prompt, format, status, created_at) VALUES (?, ?, ?, 'queued', ?)"
        ).bind(id, prompt, format, createdAt).run();

        return json({
          ok: true,
          job: { id, prompt, format, status: "queued", createdAt },
          message: "Your idea has been saved. Video generation will start when a generation provider is connected."
        }, 202);
      }

      const jobMatch = url.pathname.match(/^\/api\/jobs\/([A-Za-z0-9_-]+)$/);
      if (jobMatch && request.method === "GET") {
        const job = await env.DB.prepare(
          "SELECT id, prompt, format, status, created_at AS createdAt FROM video_jobs WHERE id = ?"
        ).bind(jobMatch[1]).first();
        return job ? json({ ok: true, job }) : json({ error: "Job not found." }, 404);
      }

      if (url.pathname === "/api/voice-recordings" && request.method === "POST") {
        const form = await request.formData();
        const audio = form.get("audio");
        const researchConsent = form.get("researchConsent") === "true";

        if (!(audio instanceof File)) return json({ error: "Please record or select an audio sample." }, 400);
        if (audio.size < 1000) return json({ error: "The recording is too short or empty. Please record again." }, 400);
        if (audio.size > 20 * 1024 * 1024) return json({ error: "Please keep voice samples under 20 MB." }, 400);

        const allowed = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"];
        const contentType = (audio.type || "application/octet-stream").split(";")[0].trim().toLowerCase();
        if (!allowed.includes(contentType)) return json({ error: "Unsupported audio format. Please use a browser-recorded WebM, OGG, MP4, WAV or MP3 file." }, 415);

        const id = makeId("voice");
        const createdAt = new Date().toISOString();
        const objectKey = `voice-private/${id}/${Date.now()}.audio`;

        await env.VOICE_BUCKET.put(objectKey, audio.stream(), {
          httpMetadata: { contentType },
          customMetadata: {
            recordingId: id,
            researchConsent: researchConsent ? "yes" : "no"
          }
        });

        await env.DB.prepare(
          `INSERT INTO voice_recordings
          (id, object_key, content_type, byte_size, research_consent, consent_version, consented_at, purpose, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id, objectKey, contentType, audio.size, researchConsent ? 1 : 0,
          "voice-research-consent-v1",
          researchConsent ? createdAt : null,
          researchConsent ? "personal_voice_service_and_optional_research" : "personal_voice_service_only",
          createdAt
        ).run();

        return json({
          ok: true,
          recording: {
            id,
            researchConsent,
            status: researchConsent ? "research_opt_in_recorded" : "service_only",
            createdAt
          },
          message: researchConsent
            ? "Recording stored with your optional research opt-in recorded."
            : "Recording stored for the requested voice service only; it is not approved for SouthyAI research/training."
        }, 201);
      }

      const voiceMatch = url.pathname.match(/^\/api\/voice-recordings\/([A-Za-z0-9_-]+)$/);
      if (voiceMatch && request.method === "GET") {
        const recording = await env.DB.prepare(
          `SELECT id, content_type AS contentType, byte_size AS byteSize,
          research_consent AS researchConsent, purpose, created_at AS createdAt
          FROM voice_recordings WHERE id = ?`
        ).bind(voiceMatch[1]).first();
        if (!recording) return json({ error: "Recording not found." }, 404);
        return json({ ok: true, recording });
      }

      if (url.pathname.startsWith("/api/")) {
        const studio = await handleStudio(request, env, url);
        if (studio) return studio;
        return json({ error: "API route not found." }, 404);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: "Something went wrong processing this request.", detail: String(error?.message || error) }, 500);
    }
  }
};
