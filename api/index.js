const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function getOrCreateUser(email) {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) return existing.id;

  const { data } = await supabase
    .from("users")
    .insert({ email })
    .select("id")
    .single();

  return data.id;
}

function parseWeight(message) {
  const match = message.match(/(\d+(?:\.\d+)?)\s*(kg|lbs?)/i);
  if (!match) return null;

  return {
    value: parseFloat(match[1]),
    unit: /lbs?/i.test(match[2]) ? "lbs" : "kg"
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const { message, email } = body;

    if (!message || !email) {
      return res.status(400).json({ error: "message and email required" });
    }

    const userId = await getOrCreateUser(email);

    const weight = parseWeight(message);

    if (weight) {
      await supabase.from("weight_logs").insert({
        user_id: userId,
        value: weight.value,
        unit: weight.unit,
        timestamp: new Date().toISOString()
      });
    }

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
    } catch (e) {
      reply = "AI προσωρινά unavailable";
    }

    return res.json({ reply, user_id: userId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};