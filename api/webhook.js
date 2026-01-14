// Vercel Serverless Function: /api/webhook
module.exports = async (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  // Meta webhook verify
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send("Forbidden");
    return;
  }

  // Incoming webhook events
  if (req.method === "POST") {
    res.status(200).json({ received: true });
    return;
  }

  res.status(405).send("Method Not Allowed");
};
