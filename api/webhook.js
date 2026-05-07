export default async function handler(req, res) {
  // ---------- Helpers ----------
  const end = (statusCode, body = "OK", headers = {}) => {
    res.statusCode = statusCode;
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.end(body);
  };

  const ENV = {
    VERIFY_TOKEN: process.env.VERIFY_TOKEN || "",
    PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || "",
    WA_TOKEN: process.env.WA_TOKEN || "",

    KV_URL: process.env.KV_REST_API_URL || "",
    KV_TOKEN: process.env.KV_REST_API_TOKEN || "",

    RESEND_API_KEY: process.env.RESEND_API_KEY || "",
    EMAIL_FROM:
      process.env.EMAIL_FROM ||
      "Atlas TaxiCabs <contact@atlastaxicabs.co.uk>",
    EMAIL_TO:
      process.env.BOOKING_EMAIL_TO ||
      process.env.BOOKING_MAIL_TO ||
      process.env.EMAIL_TO ||
      "contact@atlastaxicabs.co.uk",
  };

  const menuText =
    "Hi 👋 Atlas TaxiCabs here.\n\n" +
    "Please reply with:\n" +
    "1️⃣ Pickup\n2️⃣ Destination\n3️⃣ Date & time\n4️⃣ Passengers\n\n" +
    "(Prices shown in WhatsApp apply only for Airports & Central London.)\n" +
    "For anything else please call 01920 282828.";

  // ---------- KV / Upstash REST ----------
  const kvCmd = async (arr) => {
    if (!ENV.KV_URL || !ENV.KV_TOKEN) {
      throw new Error(
        "Missing KV env vars. Ensure KV_REST_API_URL and KV_REST_API_TOKEN are set."
      );
    }

    const resp = await fetch(ENV.KV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.KV_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(arr),
    });

    const raw = await resp.text();

    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      json = { _raw: raw };
    }

    if (!resp.ok) {
      throw new Error(`KV error ${resp.status}: ${raw}`);
    }

    return json?.result;
  };

  const kvGet = async (key) => {
    if (!key) return null;
    return kvCmd(["GET", String(key)]);
  };

  const kvSet = async (key, value) => {
    if (!key) return null;
    const v = typeof value === "string" ? value : JSON.stringify(value);
    return kvCmd(["SET", String(key), v]);
  };

  const kvDel = async (key) => {
    if (!key) return null;
    return kvCmd(["DEL", String(key)]);
  };

  const kvGetJson = async (key) => {
    const v = await kvGet(key);
    if (!v) return null;

    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };

  // ---------- WhatsApp send ----------
  const sendText = async (to, message) => {
    if (!ENV.PHONE_NUMBER_ID || !ENV.WA_TOKEN) {
      console.log(
        "❌ Missing WhatsApp env vars. Ensure PHONE_NUMBER_ID and WA_TOKEN are set."
      );
      return { ok: false, error: "missing_whatsapp_env" };
    }

    const url = `https://graph.facebook.com/v20.0/${ENV.PHONE_NUMBER_ID}/messages`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body: message },
      }),
    });

    const raw = await resp.text();

    console.log("➡️ Send message response status:", resp.status);
    console.log("➡️ Send message response raw:", raw);

    let json = null;
    try {
      json = JSON.parse(raw);
      console.log("➡️ Send message response json:", json);
    } catch {}

    return {
      ok: resp.ok,
      status: resp.status,
      raw,
      json,
    };
  };

  // ---------- Resend email send ----------
  const sendBookingEmail = async ({ from, pickup, dest, datetime, pax }) => {
    if (!ENV.RESEND_API_KEY) {
      console.log("❌ Missing RESEND_API_KEY");
      return { ok: false, error: "missing_resend_api_key" };
    }

    if (!ENV.EMAIL_FROM || !ENV.EMAIL_TO) {
      console.log("❌ Missing email env vars", {
        EMAIL_FROM: ENV.EMAIL_FROM,
        EMAIL_TO: ENV.EMAIL_TO,
      });
      return { ok: false, error: "missing_email_env" };
    }

    const subject = "New WhatsApp Booking Request - Atlas TaxiCabs";

    const html = `
      <h2>New WhatsApp Booking Request</h2>
      <p><strong>Customer WhatsApp:</strong> ${from || "-"}</p>
      <p><strong>Pickup:</strong> ${pickup || "-"}</p>
      <p><strong>Destination:</strong> ${dest || "-"}</p>
      <p><strong>Date/Time:</strong> ${datetime || "-"}</p>
      <p><strong>Passengers:</strong> ${pax || "-"}</p>
    `;

    const text = [
      "New WhatsApp Booking Request",
      "",
      `Customer WhatsApp: ${from || "-"}`,
      `Pickup: ${pickup || "-"}`,
      `Destination: ${dest || "-"}`,
      `Date/Time: ${datetime || "-"}`,
      `Passengers: ${pax || "-"}`,
    ].join("\n");

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ENV.EMAIL_FROM,
        to: [ENV.EMAIL_TO],
        subject,
        html,
        text,
      }),
    });

    const raw = await resp.text();

    console.log("📧 Resend email response status:", resp.status);
    console.log("📧 Resend email response raw:", raw);

    return {
      ok: resp.ok,
      status: resp.status,
      raw,
    };
  };

  // ---------- GET: webhook verification ----------
  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];

    if (mode === "subscribe" && token === ENV.VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return end(200, String(challenge || ""));
    }

    console.log("❌ Verify failed", { mode, token });
    return end(403, "Forbidden");
  }

  // ---------- POST: incoming events ----------
  if (req.method !== "POST") {
    return end(405, "Method Not Allowed", {
      Allow: "GET, POST",
    });
  }

  try {
    const body = req.body || {};

    console.log("🔥 WEBHOOK HIT: POST /api/webhook");
    console.log("📦 BODY:", JSON.stringify(body));

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Status updates from WhatsApp: sent / delivered / read
    const status = value?.statuses?.[0];

    if (status) {
      console.log("📮 STATUS:", {
        status: status.status,
        to: status.recipient_id,
        id: status.id,
        timestamp: status.timestamp,
      });

      return end(200, "OK");
    }

    // Incoming message
    const msg = value?.messages?.[0];

    if (!msg) {
      return end(200, "OK");
    }

    const from = msg.from;
    const type = msg.type;
    const text = (msg.text?.body || "").trim();

    console.log("✅ INCOMING:", {
      from,
      type,
      text,
    });

    console.log("🔧 ENV CHECK:", {
      PHONE_NUMBER_ID_len: ENV.PHONE_NUMBER_ID?.length || 0,
      WA_TOKEN_len: ENV.WA_TOKEN?.length || 0,
      KV_URL_len: ENV.KV_URL?.length || 0,
      KV_TOKEN_len: ENV.KV_TOKEN?.length || 0,
      RESEND_API_KEY_len: ENV.RESEND_API_KEY?.length || 0,
      EMAIL_FROM: ENV.EMAIL_FROM,
      EMAIL_TO: ENV.EMAIL_TO,
    });

    if (!from) {
      return end(200, "OK");
    }

    // Only handle text messages
    if (type !== "text") {
      await sendText(
        from,
        "Please send a text message to continue. Type 'restart' to start again."
      );

      return end(200, "OK");
    }

    const t = text.toLowerCase();

    const stateKey = `wa:state:${from}`;

    let state =
      (await kvGetJson(stateKey)) || {
        step: 0,
        pickup: "",
        dest: "",
        datetime: "",
        pax: "",
      };

    // Reset / start commands
    if (["restart", "start", "menu", "hi", "hello"].includes(t)) {
      state = {
        step: 0,
        pickup: "",
        dest: "",
        datetime: "",
        pax: "",
      };

      await kvSet(stateKey, state);
      await sendText(from, menuText);

      return end(200, "OK");
    }

    // ---------- Step 0: menu or smart pickup capture ----------
    if (state.step === 0) {
      if (t === "1") {
        state.step = 1;
        await kvSet(stateKey, state);
        await sendText(from, "Please enter your pickup address:");
        return end(200, "OK");
      }

      if (t === "2") {
        state.step = 2;
        await kvSet(stateKey, state);
        await sendText(from, "Please enter your destination:");
        return end(200, "OK");
      }

      if (t === "3") {
        state.step = 3;
        await kvSet(stateKey, state);
        await sendText(
          from,
          "Please enter date & time (e.g., 26/01 18:30):"
        );
        return end(200, "OK");
      }

      if (t === "4") {
        state.step = 4;
        await kvSet(stateKey, state);
        await sendText(from, "How many passengers?");
        return end(200, "OK");
      }

      // Smart: treat any other text as pickup
      state.pickup = text;
      state.step = 2;

      await kvSet(stateKey, state);
      await sendText(from, "✅ Pickup saved. Please enter your destination:");

      return end(200, "OK");
    }

    // ---------- Step 1: pickup ----------
    if (state.step === 1) {
      state.pickup = text;
      state.step = 2;

      await kvSet(stateKey, state);
      await sendText(from, "✅ Pickup saved. Please enter your destination:");

      return end(200, "OK");
    }

    // ---------- Step 2: destination ----------
    if (state.step === 2) {
      state.dest = text;
      state.step = 3;

      await kvSet(stateKey, state);
      await sendText(
        from,
        "✅ Destination saved. Please enter date & time (e.g., 26/01 18:30):"
      );

      return end(200, "OK");
    }

    // ---------- Step 3: date/time ----------
    if (state.step === 3) {
      state.datetime = text;
      state.step = 4;

      await kvSet(stateKey, state);
      await sendText(from, "✅ Date & time saved. How many passengers?");

      return end(200, "OK");
    }

    // ---------- Step 4: passengers ----------
    if (state.step === 4) {
      state.pax = text;
      state.step = 5;

      await kvSet(stateKey, state);

      await sendText(
        from,
        `✅ Please confirm booking:\n\n` +
          `Pickup: ${state.pickup || "-"}\n` +
          `Destination: ${state.dest || "-"}\n` +
          `Date/Time: ${state.datetime || "-"}\n` +
          `Passengers: ${state.pax || "-"}\n\n` +
          `Reply YES to confirm or NO to cancel.`
      );

      return end(200, "OK");
    }

    // ---------- Step 5: confirmation ----------
    if (state.step === 5) {
      if (t === "yes") {
        const emailResult = await sendBookingEmail({
          from,
          pickup: state.pickup,
          dest: state.dest,
          datetime: state.datetime,
          pax: state.pax,
        });

        console.log("📧 Booking email result:", emailResult);

        await sendText(
          from,
          "✅ Thanks! Your booking request has been received. We will get back to you shortly."
        );

        await kvDel(stateKey);

        return end(200, "OK");
      }

      if (t === "no") {
        await sendText(from, "❌ Cancelled. Type 'restart' to start again.");
        await kvDel(stateKey);

        return end(200, "OK");
      }

      await sendText(from, "Please reply YES to confirm or NO to cancel.");

      return end(200, "OK");
    }

    // ---------- Fallback ----------
    await sendText(from, menuText);

    return end(200, "OK");
  } catch (err) {
    console.error("❌ Error:", err);
    return end(500, "Internal Server Error");
  }
}
