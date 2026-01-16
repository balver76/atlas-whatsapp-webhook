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
  console.log("✅ Incoming POST webhook!");
  console.log("Headers:", req.headers);
  console.log("Body:", JSON.stringify(req.body));
  return res.status(200).json({ received: true });
}

  return res.status(405).send("Method Not Allowed");
};
