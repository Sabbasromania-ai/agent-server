
const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔹 Create or get user
async function getOrCreateUser(email) {
  const { data: existing, error } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error) throw error;
  if (existing) return existing.id;

  const { data, error: insertError } = await supabase
    .from("users")
    .insert({ email })
    .select("id")
    .single();

  if (insertError) throw insertError;

  return data.id;
}

// 🔹 Parse weight (STRICT)
function parseWeight(message) {
  const match = message.match(/(\d+(?:\.\d+)?)\s*(kg|lbs?|κιλά)/i);
  if (!match) return null;

  return {
    value: parseFloat(match[1]),
    unit: /lbs?/i.test(match[2]) ? "lbs" : "kg"
  };
}

// 🔹 Blood markers
const BLOOD_MARKERS = [
  "glucose",
  "hba1c",
  "cholesterol",
  "triglycerides",
  "hdl",
  "ldl"
];

// 🔹 Parse blood test
function parseBloodTest(message) {
  const lower = message.toLowerCase();

  for (const marker of BLOOD_MARKERS) {
    if (lower.includes(marker)) {
      const valueMatch = message.match(/(\d+(?:\.\d+)?)/);
      const unitMatch = message.match(/(mg\/dl|mmol\/l|%)/i);

      if (valueMatch) {
        return {
          test_name: marker,
          value: parseFloat(valueMatch[1]),
          unit: unitMatch ? unitMatch[1] : null
        };
      }
    }
  }

  return null;
}

app.post("/agent", async (req, res) => {
  const { message, email } = req.body;

  if (!message || !email) {
    return res.status(400).json({ error: "message and email required" });
  }

  let userId;

  try {
    userId = await getOrCreateUser(email);
  } catch (err) {
    console.log("USER ERROR:", err);
    return res.status(500).json({ error: "User error" });
  }

  // 🔥 1. BLOOD TEST FIRST
  const blood = parseBloodTest(message);

  if (blood) {
    console.log("BLOOD DETECTED:", blood);

    const { error } = await supabase.from("blood_tests").insert({
      user_id: userId,
      test_name: blood.test_name,
      value: blood.value,
      unit: blood.unit,
      timestamp: new Date().toISOString()
    });

    if (error) {
      console.log("BLOOD ERROR:", error);
    } else {
      console.log("BLOOD SUCCESS");
    }
  }

  // 🔥 2. WEIGHT AFTER
  const weight = parseWeight(message);

  if (weight && !blood) {
    console.log("WEIGHT DETECTED:", weight);

    const now = new Date().toISOString();

    const { error } = await supabase.from("weight_logs").insert({
      user_id: userId,
      value: weight.value,
      unit: weight.unit,
      timestamp: now,
      updated_at: now
    });

    if (error) {
      console.log("WEIGHT ERROR:", error);
    } else {
      console.log("WEIGHT SUCCESS");
    }
  }

  // 🔹 Claude call
  let reply = "";

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: message }]
          }
        ]
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }
      }
    );

    reply = response.data.content?.[0]?.text || "";
  } catch (err) {
    console.log("CLAUDE ERROR:", err.response?.data || err.message);
    return res.status(500).json({ error: "Claude API failed" });
  }

  res.json({ reply, user_id: userId });
});

module.exports = app;