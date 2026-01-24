export default async function handler(req, res) {
  const end = (statusCode, body = "OK", headers = {}) => {
    res.statusCode = statusCode;
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(body);
  };

  // GET: webhook verification + DEBUG
  if (req.method === "GET") {
    // 🔍 DEBUG endpoint: /api/webhook?debug=1
    if (req.query?.debug === "1") {
      const phoneIdLen = (process.env.PHONE_NUMBER_ID || "").length;
      const tokenLen = (process.env.WA_TOKEN || "").length;
      const verifyLen = (process.env.VERIFY_TOKEN || "").length;

      return end(
        200,
        JSON.stringify(
          {
            env: "ok",
            PHONE_NUMBER_ID_len: phoneIdLen,
            WA_TOKEN_len: tokenLen,
            VERIFY_TOKEN_len: verifyLen,
          },
          null,
          2
        ),
        { "Content-Type": "application/json" }
      );
    }

    const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";

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

  // POST: incoming events
  if (req.method === "POST") {
    try {
      const body = req.body || {};
      console.log("🔥 WEBHOOK HIT: POST /api/webhook");
      console.log("📦 BODY:", JSON.stringify(body));

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Log status updates
      const status = value?.statuses?.[0];
      if (status) {
        console.log("📮 STATUS:", {
          status: status.status,
          to: status.recipient_id,
          id: status.id,
          timestamp: status.timestamp,
        });
      }

      // Incoming message
      const msg = value?.messages?.[0];
      if (msg) {
        const from = msg.from;
        const type = msg.type;
        const text = msg.text?.body || "";

        console.log("✅ INCOMING:", { from, type, text });

        if (type === "text" && text && from) {
          const replyText =
            "Hi 👋 Atlas Taxi Cabs here.\n\nPlease reply with:\n1️⃣ Pickup\n2️⃣ Destination\n3️⃣ Date & time\n4️⃣ Passengers\n\n(Prices shown in WhatsApp apply only for Airports & Central London.)\nFor anything else please call 01920 282828.";

          const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
          const WA_TOKEN = process.env.WA_TOKEN || "";

          console.log("🔧 ENV CHECK:", {
            PHONE_NUMBER_ID_len: PHONE_NUMBER_ID.length,
            WA_TOKEN_len: WA_TOKEN.length,
          });

          if (!PHONE_NUMBER_ID || !WA_TOKEN) {
            console.log("❌ Missing env vars. Ensure PHONE_NUMBER_ID and WA_TOKEN are set in Vercel (Production).");
            return end(200, "OK");
          }

          const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

          const resp = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${WA_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: from,
              text: { body: replyText },
            }),
          });

          const respClone = resp.clone();
          const data = await resp.json().catch(() => ({}));
          const raw = await respClone.text().catch(() => "");

          console.log("➡️ Send message response (status):", resp.status);
          console.log("➡️ Send message response (raw):", raw);
          console.log("➡️ Send message response (json):", data);

          if (data?.error) {
            console.log("❌ WHATSAPP ERROR FULL:", JSON.stringify(data));
          }
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
