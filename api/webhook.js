// /api/webhook.js

export default async function handler(req, res) {
  // --- GET: Meta verify (zaten çalışıyor) ---
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("🔥 WEBHOOK HIT: GET", req.url);

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  // --- POST: incoming events ---
  if (req.method === "POST") {
    console.log("🔥 WEBHOOK HIT: POST", req.url);

    try {
      const body = req.body;
      // Payload’ı logla (kısaltmadan)
      console.log("📦 BODY:", JSON.stringify(body));

      // WhatsApp message geldi mi?
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      const msg = value?.messages?.[0];
      if (!msg) {
        // status event vs olabilir; yine de 200 dön
        return res.status(200).json({ ok: true, note: "No messages in payload" });
      }

      const from = msg.from; // kullanıcı numarası (E164, country code ile)
      const text = msg?.text?.body || "";

      console.log("✅ Incoming message from:", from, "text:", text);

      // --- Auto reply gönder ---
      const token = process.env.WHATSAPP_TOKEN;
      const phoneNumberId = process.env.PHONE_NUMBER_ID;

      if (!token || !phoneNumberId) {
        console.log("❌ Missing env: WHATSAPP_TOKEN or PHONE_NUMBER_ID");
        return res.status(200).json({ ok: true, note: "Missing env vars" });
      }

      // Basit otomatik cevap (şimdilik sabit)
      const replyText =
        "Hi! Atlas Taxicabs 👋\n\nTo book, please reply with:\n1) Pickup\n2) Destination\n3) Date & time\n4) Passengers";

      const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: replyText },
        }),
      });

      const data = await resp.json();
      console.log("➡️ Send message response:", JSON.stringify(data));

      return res.status(200).json({ ok: true, sent: data });
    } catch (err) {
      console.log("💥 ERROR:", err?.message || err);
      return res.status(200).json({ ok: false, error: String(err) }); // Meta için yine 200
    }
  }

  // diğer methodlar
  return res.status(405).send("Method Not Allowed");
}
