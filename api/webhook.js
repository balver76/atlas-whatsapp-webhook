module.exports = async (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";

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
    return res.status(200).json({ received: true });
  }

  return res.status(405).send("Method Not Allowed");
};
