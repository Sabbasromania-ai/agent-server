const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

console.log("FUNCTION START");

// ασφαλές supabase init
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);

async function getOrCreateUser(email) {
  try {
    const { data: existing, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.log("USER SELECT ERROR:", error.message);
      throw error;
    }

    if (existing) return existing.id;

    const { data, error: insertError } = await supabase
      .from("users")
      .insert({ email })
      .select("id")
      .single();

    if (insertError) {
      console.log("USER INSERT ERROR:", insertError.message);
      throw insertError;
    }

    return data.id;
  } catch (err) {
    console.log("USER FAIL:", err.message);
    throw err;
  }
}

function parseWeight(message) {
  if (!message) return null;

  const match = message.match(/(\d+(?:\.\d+)?)\s*(kg|lbs?)/i);
  if (!match) return null;

  return {
    value: parseFloat(match[1]),
    unit: /lbs?/i.test(match[2]) ? "lbs" : "kg"
  };
}

module.exports = async (req, res) => {
  try {
    console.log("REQ START");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // safe body
    let body = {};
    try {
      body =
        typeof req.body === "string"
          ? JSON.parse(req.body)
          : req.body || {};
    } catch (e) {
      console.log("BODY PARSE ERROR:", e.message);
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const { message, email } = body;

    if (!message || !email) {
      return res.status(400).json({ error: "message and email required" });
    }

    console.log("BODY OK");

    // user
    let userId;
    try {
      userId = await getOrCreateUser(email);
      console.log("USER OK");
    } catch (err) {
      return res.status(500).json({ error: "User creation failed" });
    }

    // weight
    const weight = parseWeight(message);

    if (weight) {
      const { error } = await supabase.from("weight_logs").insert({
        user_id: userId,
        value: weight.value,
        unit: weight.unit,
        timestamp: new Date().toISOString()
      });

      if (error) {
        console.log("WEIGHT ERROR:", error.message);
      } else {
        console.log("WEIGHT OK");
      }
    }

    // Claude (SAFE)
    let reply = "";

    try {
      const ai = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-sonnet-4-6",
          max_tokens: 200,
          messages: [{ role: "user", content: message }]
        },
        {
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
          }
        }
      );

      reply = ai.data.content?.[0]?.text || "";
      console.log("CLAUDE OK");
    } catch (err) {
      console.log("CLAUDE ERROR:", err.message);
      reply = "AI προσωρινά unavailable";
    }

    return res.json({
      reply,
      user_id: userId
    });
  } catch (err) {
    console.log("FINAL ERROR:", err.message);
    return res.status(500).json({ error: err.message });
  }
};