export default async function handler(req, res) {
  // ---- safe response helper (no Express methods)
  const end = (statusCode, body = "OK", headers = {}) => {
    res.statusCode = statusCode;
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(body);
  };

  // ---- ENV
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "";
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
  const WA_TOKEN = process.env.WA_TOKEN || "";
  const KV_REST_API_URL = process.env.KV_REST_API_URL || "";
  const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || "";
  const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
  const EMAIL_FROM = process.env.EMAIL_FROM || "";
  const EMAIL_TO = process.env.EMAIL_TO || "";

  // ---- simple env diagnostics endpoint (optional)
  if (req.method === "GET" && req.query?.debug === "env") {
    return end(
      200,
      JSON.stringify({
        ok: true,
        PHONE_NUMBER_ID_len: PHONE_NUMBER_ID.length,
        WA_TOKEN_len: WA_TOKEN.length,
        VERIFY_TOKEN_len: VERIFY_TOKEN.length,
        KV_REST_API_URL_len: KV_REST_API_URL.length,
        KV_REST_API_TOKEN_len: KV_REST_API_TOKEN.length,
        RESEND_API_KEY_len: RESEND_API_KEY.length,
        EMAIL_FROM: EMAIL_FROM ? "set" : "missing",
        EMAIL_TO: EMAIL_TO ? "set" : "missing",
      }),
      { "Content-Type": "application/json" }
    );
  }

  // ---- GET: webhook verification
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

  // ---- helpers: WhatsApp send
  const sendWhatsAppText = async (to, text) => {
    if (!PHONE_NUMBER_ID || !WA_TOKEN) {
      console.log("❌ Missing env vars. Ensure PHONE_NUMBER_ID and WA_TOKEN are set.");
      return { ok: false, error: "missing_env" };
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
        to,
        text: { body: text },
      }),
    });

    const raw = await resp.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      json = { raw };
    }

    console.log("➡️ Send message response (status):", resp.status);
    console.log("➡️ Send message response (json):", json);

    if (!resp.ok) {
      console.log("❌ WHATSAPP ERROR FULL:", raw);
      return { ok: false, status: resp.status, json };
    }

    return { ok: true, status: resp.status, json };
  };

  // ---- helpers: Upstash Redis REST (KV)
  const kvCmd = async (commandArr) => {
    if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
      throw new Error("Missing KV_REST_API_URL / KV_REST_API_TOKEN");
    }

    const resp = await fetch(KV_REST_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: commandArr }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(`KV error ${resp.status}: ${JSON.stringify(data)}`);
    }
    return data?.result;
  };

  const kvGetJson = async (key) => {
    const v = await kvCmd(["GET", key]);
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };

  const kvSetJson = async (key, obj, ttlSeconds = 0) => {
    const value = JSON.stringify(obj);
    if (ttlSeconds && ttlSeconds > 0) {
      // SET key value EX ttl
      await kvCmd(["SET", key, value, "EX", String(ttlSeconds)]);
    } else {
      await kvCmd(["SET", key, value]);
    }
  };

  const kvDel = async (key) => kvCmd(["DEL", key]);

  // store bookings as list entries (latest first)
  const kvPushBooking = async (bookingObj) => {
    // keep last 200 bookings to limit size
    await kvCmd(["LPUSH", "bookings", JSON.stringify(bookingObj)]);
    await kvCmd(["LTRIM", "bookings", "0", "199"]);
  };

  const sendEmailViaResend = async ({ subject, text }) => {
    if (!RESEND_API_KEY || !EMAIL_FROM || !EMAIL_TO) {
      console.log("❌ Email env missing. Need RESEND_API_KEY, EMAIL_FROM, EMAIL_TO");
      return { ok: false, error: "missing_email_env" };
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [EMAIL_TO],
        subject,
        text,
      }),
    });

    const raw = await resp.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      json = { raw };
    }

    console.log("📧 Email send status:", resp.status);
    console.log("📧 Email response:", json);

    if (!resp.ok) return { ok: false, status: resp.status, json };
    return { ok: true, status: resp.status, json };
  };

  // ---- POST: incoming events
  if (req.method === "POST") {
    try {
      const body = req.body || {};
      console.log("🔥 WEBHOOK HIT: POST /api/webhook");
      console.log("📦 BODY:", JSON.stringify(body));

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Status updates (sent/delivered/read)
      const status = value?.statuses?.[0];
      if (status) {
        console.log("📮 STATUS:", {
          status: status.status,
          to: status.recipient_id,
          id: status.id,
          timestamp: status.timestamp,
        });
      }

      // Incoming messages
      const msg = value?.messages?.[0];
      if (!msg) return end(200, "OK");

      const from = msg.from; // user wa_id
      const type = msg.type;
      const text = (msg.text?.body || "").trim();

      console.log("✅ INCOMING:", { from, type, text });

      // ignore non-text
      if (type !== "text" || !from) return end(200, "OK");

      // --- booking flow stored in KV as draft:<from>
      const draftKey = `draft:${from}`;
      let draft = (await kvGetJson(draftKey)) || {
        step: "menu",
        pickup: "",
        destination: "",
        datetime: "",
        passengers: "",
        startedAt: Date.now(),
      };

      const lower = text.toLowerCase();

      // quick commands
      if (lower === "0" || lower === "restart" || lower === "start") {
        draft = {
          step: "menu",
          pickup: "",
          destination: "",
          datetime: "",
          passengers: "",
          startedAt: Date.now(),
        };
        await kvSetJson(draftKey, draft, 60 * 60);
        await sendWhatsAppText(
          from,
          "Hi 👋 Atlas Taxi Cabs here.\n\nPlease reply with:\n1️⃣ Pickup\n2️⃣ Destination\n3️⃣ Date & time\n4️⃣ Passengers\n\n(Prices shown in WhatsApp apply only for Airports & Central London.)\nFor anything else please call 01920 282828.\n\nType 0 to restart anytime."
        );
        return end(200, "OK");
      }

      // If user says Hi / Hello and no progress yet => show menu
      const isGreeting = ["hi", "hello", "hey", "selam", "merhaba"].includes(lower);
      if (isGreeting && (draft.step === "menu" || !draft.step)) {
        await kvSetJson(draftKey, draft, 60 * 60);
        await sendWhatsAppText(
          from,
          "Hi 👋 Atlas Taxi Cabs here.\n\nPlease reply with:\n1️⃣ Pickup\n2️⃣ Destination\n3️⃣ Date & time\n4️⃣ Passengers\n\nType 0 to restart anytime."
        );
        return end(200, "OK");
      }

      // step machine
      if (draft.step === "menu") {
        if (text === "1") {
          draft.step = "pickup";
          await kvSetJson(draftKey, draft, 60 * 60);
          await sendWhatsAppText(from, "Please enter your pickup address:");
          return end(200, "OK");
        }
        if (text === "2") {
          draft.step = "destination";
          await kvSetJson(draftKey, draft, 60 * 60);
          await sendWhatsAppText(from, "Please enter your destination:");
          return end(200, "OK");
        }
        if (text === "3") {
          draft.step = "datetime";
          await kvSetJson(draftKey, draft, 60 * 60);
          await sendWhatsAppText(from, "Please enter date & time (e.g., 26/01 18:30):");
          return end(200, "OK");
        }
        if (text === "4") {
          draft.step = "passengers";
          await kvSetJson(draftKey, draft, 60 * 60);
          await sendWhatsAppText(from, "How many passengers?");
          return end(200, "OK");
        }

        await sendWhatsAppText(from, "Please reply with 1, 2, 3 or 4. (Type 0 to restart)");
        return end(200, "OK");
      }

      if (draft.step === "pickup") {
        draft.pickup = text;
        draft.step = "destination";
        await kvSetJson(draftKey, draft, 60 * 60);
        await sendWhatsAppText(from, "Thanks. Now enter your destination:");
        return end(200, "OK");
      }

      if (draft.step === "destination") {
        draft.destination = text;
        draft.step = "datetime";
        await kvSetJson(draftKey, draft, 60 * 60);
        await sendWhatsAppText(from, "Great. Now enter date & time (e.g., 26/01 18:30):");
        return end(200, "OK");
      }

      if (draft.step === "datetime") {
        draft.datetime = text;
        draft.step = "passengers";
        await kvSetJson(draftKey, draft, 60 * 60);
        await sendWhatsAppText(from, "Almost done. How many passengers?");
        return end(200, "OK");
      }

      if (draft.step === "passengers") {
        draft.passengers = text;
        draft.step = "confirm";
        await kvSetJson(draftKey, draft, 60 * 60);

        const summary =
          `Please confirm your booking:\n\n` +
          `📍 Pickup: ${draft.pickup}\n` +
          `🏁 Destination: ${draft.destination}\n` +
          `🗓️ Date & time: ${draft.datetime}\n` +
          `👥 Passengers: ${draft.passengers}\n\n` +
          `Reply YES to confirm or NO to cancel.\n(Type 0 to restart)`;

        await sendWhatsAppText(from, summary);
        return end(200, "OK");
      }

      if (draft.step === "confirm") {
        if (lower === "yes" || lower === "y") {
          const booking = {
            id: `BKG-${Date.now()}`,
            from,
            pickup: draft.pickup,
            destination: draft.destination,
            datetime: draft.datetime,
            passengers: draft.passengers,
            createdAt: new Date().toISOString(),
            source: "whatsapp",
          };

          console.log("✅ BOOKING CONFIRMED:", booking);

          // save booking list
          await kvPushBooking(booking);

          // clear draft
          await kvDel(draftKey);

          // whatsapp confirmation
          await sendWhatsAppText(
            from,
            `✅ Booking confirmed. Thank you!\n\nYour reference: ${booking.id}\n\nWe will get back to you shortly.\n(For urgent bookings please call 01920 282828.)`
          );

          // email
          const emailText =
            `New WhatsApp Booking\n\n` +
            `Ref: ${booking.id}\n` +
            `From: ${booking.from}\n` +
            `Pickup: ${booking.pickup}\n` +
            `Destination: ${booking.destination}\n` +
            `Date & time: ${booking.datetime}\n` +
            `Passengers: ${booking.passengers}\n` +
            `Created: ${booking.createdAt}\n`;

          await sendEmailViaResend({
            subject: `New WhatsApp Booking - ${booking.id}`,
            text: emailText,
          });

          return end(200, "OK");
        }

        if (lower === "no" || lower === "n") {
          await kvDel(draftKey);
          await sendWhatsAppText(from, "❌ Booking cancelled. Type HI to start again.");
          return end(200, "OK");
        }

        await sendWhatsAppText(from, "Please reply YES to confirm or NO to cancel. (Type 0 to restart)");
        return end(200, "OK");
      }

      // fallback
      draft.step = "menu";
      await kvSetJson(draftKey, draft, 60 * 60);
      await sendWhatsAppText(from, "Type HI to start. Type 0 to restart anytime.");
      return end(200, "OK");
    } catch (err) {
      console.error("❌ Error:", err);
      return end(500, "Internal Server Error");
    }
  }

  return end(405, "Method Not Allowed", { Allow: "GET, POST" });
}
