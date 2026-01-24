export default async function handler(req, res) {
  // 1) Verification (GET)
  if (req.method === "GET") {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    }
    console.log("❌ Verify failed", { mode, token });
    return res.sendStatus(403);
  }

  // 2) Incoming events (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("🔥 WEBHOOK HIT: POST /api/webhook");
      console.log("📦 BODY:", JSON.stringify(body));

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // A) Status updates (sent/delivered/read)
      const status = value?.statuses?.[0];
      if (status) {
        console.log(
          "📮 STATUS:",
          status.status,
          "to:",
          status.recipient_id,
          "id:",
          status.id
        );
      }

      // B) Incoming messages
      const msg = value?.messages?.[0];
      if (msg) {
        const from = msg.from;
        const text = msg.text?.body || "";
        const type = msg.type;

        console.log("✅ INCOMING:", { from, type, text });

        // Only auto-reply for text messages
        if (type === "text" && text) {
          const replyText =
            "Hi 👋 Atlas Taxi Cabs here.\n\nPlease reply with:\n1️⃣ Pickup\n2️⃣ Destination\n3️⃣ Date & time\n4️⃣ Passengers\n\n(Prices shown in WhatsApp apply only for Airports & Central London.)\nFor anything else please call 01920 282828.";

          const resp = await fetch(
            `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
            {
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
            }
          );

          const data = await resp.json();
          console.log("➡️ Send message response:", data);
        }
      }

      return res.sendStatus(200);
    } catch (err) {
      console.error("❌ Error:", err);
      return res.sendStatus(500);
    }
  }

  return res.sendStatus(405);
}
