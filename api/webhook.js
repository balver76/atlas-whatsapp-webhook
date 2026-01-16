module.exports = async (req, res) => {
 console.log("🔥 WEBHOOK HIT:", req.method, req.url);
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "atlas_verify_12345";

  const url = new URL(req.url, "https://example.com");
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (req.method === "GET") {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge || "");
    }
    return res.status(403).send("Forbidden");
  }
if (req.method === "POST") {
  console.log("🔥 WEBHOOK HIT:", req.method, req.url);

  // Acknowledge fast
  res.status(200).json({ received: true });

  try {
    const WA_TOKEN = process.env.WHATSAPP_TOKEN || "";
    const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";

    const body = req.body || {};
    const change = body?.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    const text = (msg?.text?.body || "").trim().toLowerCase();

    // Only respond to greetings for now
    if (["hi", "hello", "hey", "menu", "start"].includes(text)) {
      const reply =
        `Welcome to Atlas Taxicabs 🚖\n\n` +
        `Fixed prices are available ONLY for Airports & Central London from Ware and nearby areas.\n` +
        `For any other journeys or exact quotes, please call Live Phone Booking: 01920 282828.\n\n` +
        `Reply with:\n` +
        `"Price Heathrow 2 day"\n` +
        `or\n` +
        `"Price Gatwick 6 night"\n\n` +
        `Daytime: Mon–Sat 06:30–22:00\nNight: Mon–Sat 22:00–06:30\nSunday: Night rates all day.\n\n` +
        `We will confirm your booking as soon as possible.`;

      if (!WA_TOKEN || !PHONE_NUMBER_ID) {
        console.log("Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID");
        return;
      }

      await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WA_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: reply },
        }),
      });
    }
  } catch (e) {
    console.log("POST handler error:", e);
  }
  return;
}


  return res.status(405).send("Method Not Allowed");
};
