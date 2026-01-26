const sessions = new Map();

export default async function handler(req, res) {
  const end = (code, body = "OK") => {
    res.statusCode = code;
    res.end(body);
  };

  /* VERIFY */
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return end(200, challenge);
    }
    return end(403, "Forbidden");
  }

  /* INCOMING MESSAGE */
  if (req.method === "POST") {
    try {
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const msg = value?.messages?.[0];

      if (!msg || msg.type !== "text") return end(200);

      const from = msg.from;
      const text = msg.text.body.trim();

      if (!sessions.has(from)) {
        sessions.set(from, { step: "menu", data: {} });
      }

      const session = sessions.get(from);
      let reply = "";

      /* MENU */
      if (session.step === "menu") {
        reply =
          "Hi 👋 Atlas Taxi Cabs here.\n\n" +
          "Reply with:\n" +
          "1️⃣ Pickup\n" +
          "2️⃣ Destination\n" +
          "3️⃣ Date & Time\n" +
          "4️⃣ Passengers\n\n" +
          "(Prices shown in WhatsApp apply only for Airports & Central London.)\n" +
          "For anything else please call 01920 282828.";
        session.step = "await_choice";
      }

      /* CHOICE */
      else if (session.step === "await_choice") {
        if (text === "1") {
          reply = "📍 Please enter your pickup address.";
          session.step = "pickup";
        } else {
          reply = "Please reply with 1️⃣ to start booking.";
        }
      }

      else if (session.step === "pickup") {
        session.data.pickup = text;
        reply = "🎯 Please enter your destination.";
        session.step = "destination";
      }

      else if (session.step === "destination") {
        session.data.destination = text;
        reply = "🗓 Please enter date & time (e.g. 25 Jan 10:30).";
        session.step = "datetime";
      }

      else if (session.step === "datetime") {
        session.data.datetime = text;
        reply = "👥 How many passengers?";
        session.step = "passengers";
      }

      else if (session.step === "passengers") {
        session.data.passengers = text;

        reply =
          "✅ Please confirm your booking:\n\n" +
          `📍 Pickup: ${session.data.pickup}\n` +
          `🎯 Destination: ${session.data.destination}\n` +
          `🗓 Date & Time: ${session.data.datetime}\n` +
          `👥 Passengers: ${session.data.passengers}\n\n` +
          "Reply YES to confirm or NO to cancel.";

        session.step = "confirm";
      }

      else if (session.step === "confirm") {
        if (text.toUpperCase() === "YES") {
          reply =
            "✅ Thank you! Your request has been received.\n" +
            "We will confirm your booking shortly via message or call.";
          sessions.delete(from);
        } else {
          reply = "❌ Booking cancelled. Send Hi to start again.";
          sessions.delete(from);
        }
      }

      /* SEND MESSAGE */
      await fetch(
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
            text: { body: reply },
          }),
        }
      );

      return end(200);
    } catch (e) {
      console.error(e);
      return end(500, "Error");
    }
  }

  end(405, "Method Not Allowed");
}
