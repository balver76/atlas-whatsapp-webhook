export default async function handler(req, res) {
  // Helper: end response safely (no Express methods)
  const end = (statusCode, body = "OK", headers = {}) => {
    res.statusCode = statusCode;
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(body);
  };

  // GET: webhook verification
  if (req.method === "GET") {
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

      // Log status updates (sent/delivered/read)
      const status = value?.statuses?.[0];
      if (status) {
        console.log("📮 STATUS:", {
          status: status.status,
          to: status.recipient_id,
          id: status.id,
        });
      }

      // Handle incoming text messages
      const msg = value?.messages?.[0];
      if (msg) {
        const from = msg.from;
        const type = msg.type;
        const text = msg.text?.body || "";

        console.log("✅ INCOMING:", { from, type, text });

        if (type === "text" && text && from) {
          const replyText =
            "Hi 👋 Atlas Taxi Cabs here.\n\nPlease reply with:\n1️⃣ Pickup\n2️⃣ Destination\n3️⃣ Date & time\n4️⃣ Passengers\n\n(Prices shown in WhatsApp apply only for Airports & Central London.)\nFor anything else please call 01920 282828.";

          const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;

          const resp = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.WA_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: from,
              text: { body: replyText },
            }),
          });

          const data = await resp.json();
          console.log("➡️ Send message response:", data);
        }
      }

      return end(200, "OK");
    } catch (err) {
      console.error("❌ Error:", err);
      return end(500, "Internal Server Error");
    }
  }

  // Other methods
  return end(405, "Method Not Allowed", { Allow: "GET, POST" });
}
