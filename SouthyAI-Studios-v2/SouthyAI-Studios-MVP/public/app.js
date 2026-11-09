const $ = (id) => document.getElementById(id);
const promptBox = $("prompt");
const createBtn = $("createBtn");
let mediaRecorder = null;
let recordedBlob = null;
let chunks = [];

$("year").textContent = new Date().getFullYear();
promptBox.addEventListener("input", () => $("count").textContent = `${promptBox.value.length} / 3000`);

function showMessage(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle("error", error);
}

createBtn.addEventListener("click", async () => {
  const prompt = promptBox.value.trim();
  if (prompt.length < 8) return showMessage("jobMessage", "Add a little more detail to your idea first.", true);
  createBtn.disabled = true;
  createBtn.textContent = "Saving your idea…";
  showMessage("jobMessage", "");
  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, format: $("format").value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save your idea.");
    showMessage("jobMessage", `Saved! Job ${data.job.id}. ${data.message}`);
  } catch (error) {
    showMessage("jobMessage", `${error.message} Check that the Worker is deployed and D1 is connected.`, true);
  } finally {
    createBtn.disabled = false;
    createBtn.innerHTML = 'Build my video plan <span>→</span>';
  }
});

$("recordBtn").addEventListener("click", async () => {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    $("recordBtn").textContent = "● Start new recording";
    $("recordBtn").classList.remove("recording");
    $("recordStatus").textContent = "Finishing recording…";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {};
    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    mediaRecorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
      $("audioPreview").src = URL.createObjectURL(recordedBlob);
      $("audioPreview").hidden = false;
      $("uploadVoiceBtn").disabled = false;
      $("recordStatus").textContent = `Recording ready · ${(recordedBlob.size / 1024).toFixed(0)} KB`;
      stream.getTracks().forEach(track => track.stop());
    };
    mediaRecorder.start();
    $("recordBtn").textContent = "■ Stop recording";
    $("recordBtn").classList.add("recording");
    $("recordStatus").textContent = "Recording… speak naturally and clearly.";
    showMessage("voiceMessage", "");
  } catch (error) {
    showMessage("voiceMessage", "Microphone access was blocked or is unavailable. Allow microphone access and try again.", true);
  }
});

$("uploadVoiceBtn").addEventListener("click", async () => {
  if (!recordedBlob) return;
  $("uploadVoiceBtn").disabled = true;
  $("uploadVoiceBtn").textContent = "Saving securely…";
  const form = new FormData();
  const ext = recordedBlob.type.includes("ogg") ? "ogg" : recordedBlob.type.includes("mp4") ? "m4a" : "webm";
  form.append("audio", recordedBlob, `voice-sample.${ext}`);
  form.append("researchConsent", $("researchConsent").checked ? "true" : "false");
  try {
    const response = await fetch("/api/voice-recordings", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Upload failed.");
    showMessage("voiceMessage", data.message);
  } catch (error) {
    showMessage("voiceMessage", `${error.message} Check that the Worker and private R2 bucket are configured.`, true);
  } finally {
    $("uploadVoiceBtn").disabled = false;
    $("uploadVoiceBtn").textContent = "Save voice sample";
  }
});


// ---------- Studio account, credits and voice tool ----------
let studioKey = localStorage.getItem("studioKey") || "";
let voiceCost = 2;

function authHeaders() { return { "content-type": "application/json", authorization: "Bearer " + studioKey }; }

function addAudioItem(parent, gen) {
  const row = document.createElement("div");
  row.className = "gen-item";
  const p = document.createElement("p");
  p.textContent = gen.text.length > 90 ? gen.text.slice(0, 90) + "…" : gen.text;
  const au = document.createElement("audio");
  au.controls = true;
  row.appendChild(p);
  row.appendChild(au);
  parent.appendChild(row);
  fetch("/api/generations/" + gen.id + "/audio", { headers: authHeaders() })
    .then((r) => r.blob())
    .then((b) => { au.src = URL.createObjectURL(b); });
}

async function loadHistory() {
  const box = $("history");
  box.innerHTML = "";
  const r = await fetch("/api/generations", { headers: authHeaders() });
  if (!r.ok) return;
  const d = await r.json();
  d.generations.forEach((g) => addAudioItem(box, g));
}

async function refreshAccount() {
  if (!studioKey) { $("signedOut").hidden = false; $("signedIn").hidden = true; $("voiceTool").hidden = true; return; }
  const r = await fetch("/api/me", { headers: authHeaders() });
  if (!r.ok) {
    studioKey = ""; localStorage.removeItem("studioKey");
    $("signedOut").hidden = false; $("signedIn").hidden = true; $("voiceTool").hidden = true;
    showMessage("accountMessage", "That key didn't work. Check it and try again.", true);
    return;
  }
  const d = await r.json();
  $("signedOut").hidden = true; $("signedIn").hidden = false; $("voiceTool").hidden = false;
  $("whoami").textContent = "Signed in as " + d.email;
  $("balance").textContent = d.balance;
  voiceCost = d.tools.voice.cost;
  $("voiceCost").textContent = voiceCost + " CREDITS PER VOICE";
  const sel = $("voiceLang");
  sel.innerHTML = "";
  d.tools.voice.languages.forEach((code) => {
    const names = { en: "English", af: "Afrikaans", zu: "isiZulu", xh: "isiXhosa", st: "Sesotho", tn: "Setswana" };
    const o = document.createElement("option");
    o.value = code; o.textContent = names[code] || code;
    sel.appendChild(o);
  });
  loadHistory();
}

$("regBtn").addEventListener("click", async () => {
  $("regBtn").disabled = true;
  try {
    const r = await fetch("/api/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: $("regEmail").value }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not create your account.");
    studioKey = d.token;
    localStorage.setItem("studioKey", studioKey);
    $("accountMessage").innerHTML = "";
    const box = document.createElement("div");
    box.className = "keybox";
    box.textContent = d.token;
    $("accountMessage").appendChild(document.createTextNode("Save this key now. It is shown only once:"));
    $("accountMessage").appendChild(box);
    await refreshAccount();
  } catch (e) { showMessage("accountMessage", e.message, true); }
  $("regBtn").disabled = false;
});

$("signInBtn").addEventListener("click", () => {
  studioKey = $("keyInput").value.trim();
  localStorage.setItem("studioKey", studioKey);
  showMessage("accountMessage", "");
  refreshAccount();
});

$("signOutBtn").addEventListener("click", () => {
  studioKey = ""; localStorage.removeItem("studioKey");
  refreshAccount();
});

$("voiceText").addEventListener("input", () => { $("voiceCount").textContent = $("voiceText").value.length + " / 500"; });

$("voiceGoBtn").addEventListener("click", async () => {
  $("voiceGoBtn").disabled = true;
  showMessage("voiceToolMessage", "Making your voice…");
  try {
    const r = await fetch("/api/tools/voice", { method: "POST", headers: authHeaders(), body: JSON.stringify({ text: $("voiceText").value, language: $("voiceLang").value }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Something went wrong.");
    $("balance").textContent = d.balance;
    showMessage("voiceToolMessage", "Done! Your voice is below.");
    await loadHistory();
  } catch (e) { showMessage("voiceToolMessage", e.message, true); }
  $("voiceGoBtn").disabled = false;
});

refreshAccount();
