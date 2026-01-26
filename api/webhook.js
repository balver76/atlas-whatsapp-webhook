export default async function handler(req, res) {
  // --- safe response helper (no Express methods) ---
  const end = (statusCode, body = "OK", headers = {}) => {
    res.statusCode = statusCode;
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(body);
  };

  // --- ENV ---
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
  const WA_TOKEN = process.env.WA_TOKEN || "";

  // Upstash KV (Vercel integration creates these)
  const KV_URL = process.env.KV_REST_API_URL || "";
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

  // --- KV Helpers (Upstash REST) ---
  const kvCmd = async (commandArr) => {
    if (!KV_URL || !KV_TOKEN) {
      throw new Error("Missing KV env vars. Ensure KV_REST_API_URL and KV_REST_API_TOKEN are set.");
    }

    // Upstash expects JSON array: ["GET","key"] etc.
    const resp = await fetch(KV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commandArr),
    });

    const raw = await resp.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      json = { _raw: raw };
    }

    if (!resp.ok) {
      throw new Error(`KV error ${resp.status}: ${raw}`);
    }

    // Upstash returns: { result: ... }
    return json?.result;
  };

  const kvGet = async (key) => {
    if (!key) return null;
    return await kvCmd(["GET", String(key)]);
  };

  const kvSet = async (key, value) => {
    if (!key) return null;
    // store as string
    const v = typeof value === "string" ? value : JSON.stringify(value);
    return await kvCmd(["SET", String(key), v]);
  };

  const kvDel = async (key) => {
    if (!key) return null;
    return await kvCmd(["DEL", String(key)]);
  };

  const kvGetJson = async (key) => {
    const v = await kvGet(key);
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };

  // --- GET: webhook verification ---
  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return end(200, String(challenge || ""));
    }
    console.log("❌ Verify failed", { mode, token });
    return end(403, "Forbidden");
  }

  // --- POST: incoming events ---
  if (req.method === "POST") {
    try {
      const body = req.body || {};
      console.log("🔥 WEBHOOK HIT: POST /api/webhook");
      console.log("📦 BODY:", JSON.stringify(body));

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Status updates
      const status = value?.statuses?.[0];
      if (status) {
        console.log("📮 STATUS:", {
          status: status.status,
          to: status.recipient_id,
          id: status.id,
          timestamp: status.timestamp,
        });
        return end(200, "OK");
      }

      // Incoming message
      const msg = value?.messages?.[0];
      if (!msg) return end(200, "OK");

      const from = msg.from;
      const type = msg.type;
      const text = msg.text?.body?.trim() || "";

      console.log("✅ INCOMING:", { from, type, text });

      // Basic env check
      console.log("🔧 ENV CHECK:", {
        PHONE_NUMBER_ID_len: PHONE_NUMBER_ID?.length || 0,
        WA_TOKEN_len: WA_TOKEN?.length || 0,
        KV_URL_len: KV_URL?.length || 0,
        KV_TOKEN_len: KV_TOKEN?.length || 0,
      });

      if (!PHONE_NUMBER_ID || !WA_TOKEN) {
        console.log("❌ Missing env vars. Ensure PHONE_NUMBER_ID and WA_TOKEN are set.");
        return end(200, "OK");
      }

      // ---- Simple state machine using KV ----
      const stateKey = `wa:state:${from}`;
      let state = (await kvGetJson(stateKey)) || { step: 0, pickup: "", dest: "", datetime: "", pax: "" };

      const sendText = async (to, message) => {
        const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WA_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            text: { body: message },
          }),
        });

        const raw = await resp.text();
        console.log("➡️ Send message response (status):", resp.status);
        console.log("➡️ Send message response (raw):", raw);
        try {
          console.log("➡️ Send message response (json):", JSON.parse(raw));
        } catch {}
      };

      const menuText =
        "Hi 👋 Atlas Taxi Cabs here.\n\nPlease reply with:\n1️⃣ Pickup\n2️⃣ Destination\n3️⃣ Date & time\n4️⃣ Passengers\n\n(Prices shown in WhatsApp apply only for Airports & Central London.)\nFor anything else please call 01920 282828.";

      // If user says "hi"/"menu"/"start" reset
      if (type === "text" && from && text) {
        const t = text.toLowerCase();
        if (["hi", "hello", "menu", "start", "restart"].includes(t)) {
          state = { step: 0, pickup: "", dest: "", datetime: "", pax: "" };
          await kvSet(stateKey, state);
          await sendText(from, menuText);
          return end(200, "OK");
        }

        // Step selection
        if (state.step === 0) {
          if (t === "1") {
            state.step = 1;
            await kvSet(stateKey, state);
            await sendText(from, "Please enter your pickup address:");
            return end(200, "OK");
          }
          if (t === "2") {
            state.step = 2;
            await kvSet(stateKey, state);
            await sendText(from, "Please enter your destination:");
            return end(200, "OK");
          }
          if (t === "3") {
            state.step = 3;
            await kvSet(stateKey, state);
            await sendText(from, "Please enter date & time (e.g., 26/01 18:30):");
            return end(200, "OK");
          }
          if (t === "4") {
            state.step = 4;
            await kvSet(stateKey, state);
            await sendText(from, "How many passengers?");
            return end(200, "OK");
          }

          // default show menu
          await sendText(from, menuText);
          return end(200, "OK");
        }

        // Collect fields
        if (state.step === 1) {
          state.pickup = text;
          state.step = 0;
          await kvSet(stateKey, state);
          await sendText(from, "✅ Pickup saved.\n\nReply 2️⃣ to enter destination, 3️⃣ date & time, 4️⃣ passengers, or type 'start' to see menu.");
          return end(200, "OK");
        }

        if (state.step === 2) {
          state.dest = text;
          state.step = 0;
          await kvSet(stateKey, state);
          await sendText(from, "✅ Destination saved.\n\nReply 1️⃣ pickup, 3️⃣ date & time, 4️⃣ passengers, or type 'start' to see menu.");
          return end(200, "OK");
        }

        if (state.step === 3) {
          state.datetime = text;
          state.step = 0;
          await kvSet(stateKey, state);
          await sendText(from, "✅ Date & time saved.\n\nReply 1️⃣ pickup, 2️⃣ destination, 4️⃣ passengers, or type 'start' to see menu.");
          return end(200, "OK");
        }

        if (state.step === 4) {
          state.pax = text;
          state.step = 0;
          await kvSet(stateKey, state);

          // If all fields present, ask for confirm
          if (state.pickup && state.dest && state.datetime && state.pax) {
            state.step = 5;
            await kvSet(stateKey, state);
            await sendText(
              from,
              `✅ Please confirm booking:\n\nPickup: ${state.pickup}\nDestination: ${state.dest}\nDate/Time: ${state.datetime}\nPassengers: ${state.pax}\n\nReply YES to confirm or NO to cancel.`
            );
            return end(200, "OK");
          }

          await sendText(from, "✅ Passengers saved.\n\nNow reply 1️⃣ pickup, 2️⃣ destination, 3️⃣ date & time, or type 'start' to see menu.");
          return end(200, "OK");
        }

        // Confirmation
        if (state.step === 5) {
          const t2 = text.toLowerCase();
          if (t2 === "yes") {
            // TODO: send email later (we will add it next)
            await sendText(from, "✅ Thanks! Your booking request has been received. We will get back to you shortly.");
            await kvDel(stateKey);
            return end(200, "OK");
          }
          if (t2 === "no") {
            await sendText(from, "❌ Cancelled. Type 'start' to begin again.");
            await kvDel(stateKey);
            return end(200, "OK");
          }
          await sendText(from, "Please reply YES to confirm or NO to cancel.");
          return end(200, "OK");
        }
      }

      return end(200, "OK");
    } catch (err) {
      console.error("❌ Error:", err);
      return end(500, "Internal Server Error");
    }
  }

  return end(405, "Method Not Allowed", { Allow: "GET, POST" });
}
