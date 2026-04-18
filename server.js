require("dotenv").config();
const express = require("express");
const path = require("path");
const OpenAI = require("openai");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const port = Number(process.env.PORT || 3000);

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
const supabaseServiceRole = (process.env.SUPABASE_SERVICE_ROLE || "").trim();

const missingSupabase =
  !supabaseUrl || !supabaseAnonKey || !supabaseServiceRole;

if (missingSupabase) {
  console.error("Variaveis de ambiente do Supabase nao definidas.");
  if (require.main === module) {
    process.exit(1);
  }
}

const supabaseAdmin = missingSupabase
  ? null
  : createClient(supabaseUrl, supabaseServiceRole, {
      auth: { persistSession: false },
    });

app.use(express.json({ limit: "1mb" }));

// CORS aberto apenas para rotas publicas do widget.
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/public/") ||
    req.path === "/widget.js"
  ) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const fallbackPrompt =
  "Voce e um assistente util e direto. Responda em portugues do Brasil.";

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function sanitizePhone(remoteJid) {
  if (!remoteJid || typeof remoteJid !== "string") return "";
  const [phone] = remoteJid.split("@");
  return phone.replace(/\D/g, "");
}

function extractIncomingMessage(payload) {
  return (
    payload?.data?.message?.conversation ||
    payload?.data?.message?.extendedTextMessage?.text ||
    payload?.data?.message?.imageMessage?.caption ||
    payload?.data?.body ||
    payload?.message ||
    ""
  );
}

function extractPushName(payload) {
  return payload?.data?.pushName || payload?.pushName || null;
}

function buildSystemPrompt(bot) {
  const basePrompt = bot?.system_prompt || fallbackPrompt;
  const knowledge = (bot?.knowledge_base || "").trim();
  if (!knowledge) return basePrompt;
  return `${basePrompt}\n\nBase de conhecimento do chatbot:\n${knowledge}`;
}

function isBotConfigured(bot) {
  return Boolean(
    bot?.openai_api_key &&
      bot?.evolution_base_url &&
      bot?.evolution_api_key &&
      bot?.evolution_instance,
  );
}

function buildBotWebhookUrl(req, botId) {
  return `${req.protocol}://${req.get("host")}/webhook/evolution/${botId}`;
}

function serializeBot(req, bot) {
  return {
    id: bot.id,
    name: bot.name,
    systemPrompt: bot.system_prompt,
    knowledgeBase: bot.knowledge_base,
    evolutionBaseUrl: bot.evolution_base_url,
    evolutionInstance: bot.evolution_instance,
    hasOpenAiKey: Boolean(bot.openai_api_key),
    hasEvolutionKey: Boolean(bot.evolution_api_key),
    configured: isBotConfigured(bot),
    webhookUrl: buildBotWebhookUrl(req, bot.id),
    createdAt: bot.created_at,
  };
}

async function generateAiReply(bot, userMessage, history = []) {
  const client = new OpenAI({ apiKey: bot.openai_api_key });
  const messages = [
    { role: "system", content: buildSystemPrompt(bot) },
    ...history,
    { role: "user", content: userMessage },
  ];

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages,
    });

    return response.choices?.[0]?.message?.content?.trim() || "Sem resposta da IA.";
  } catch (err) {
    const msg = `[OPENAI] falhou | status=${err.status || "?"} | code=${err.code || "?"} | err=${err.message}`;
    const wrapped = new Error(msg);
    wrapped.source = "openai";
    wrapped.openaiStatus = err.status;
    wrapped.openaiCode = err.code;
    throw wrapped;
  }
}

async function sendEvolutionMessage(bot, number, text) {
  const baseUrl = bot.evolution_base_url.replace(/\/$/, "");
  const url = `${baseUrl}/message/sendText/${bot.evolution_instance}`;

  try {
    await axios.post(
      url,
      { number, text },
      {
        headers: {
          apikey: bot.evolution_api_key,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    const detail = typeof body === "string" ? body : JSON.stringify(body || {});
    const msg = `[EVOLUTION] POST ${url} falhou | status=${status || "timeout"} | body=${detail.slice(0, 500)} | err=${err.message}`;
    const wrapped = new Error(msg);
    wrapped.source = "evolution";
    wrapped.httpStatus = status;
    wrapped.httpBody = body;
    throw wrapped;
  }
}

// ---------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------
async function requireUser(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: "Servidor sem configuracao do Supabase." });
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Nao autenticado." });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: "Sessao invalida." });
  }

  req.user = data.user;
  next();
}

async function findUserBot(userId, botId) {
  const { data, error } = await supabaseAdmin
    .from("chatbots")
    .select("*")
    .eq("id", botId)
    .eq("user_id", userId)
    .single();

  if (error) return null;
  return data;
}

// ---------------------------------------------------------------
// Public config
// ---------------------------------------------------------------
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl,
    supabaseAnonKey,
  });
});

// ---------------------------------------------------------------
// Chatbots CRUD
// ---------------------------------------------------------------
function readBotFields(body) {
  return {
    name: String(body?.name || "").trim(),
    openai_api_key: String(body?.openaiApiKey || "").trim(),
    evolution_base_url: String(body?.evolutionBaseUrl || "").trim(),
    evolution_api_key: String(body?.evolutionApiKey || "").trim(),
    evolution_instance: String(body?.evolutionInstance || "").trim(),
    system_prompt: String(body?.systemPrompt || "").trim(),
    knowledge_base: String(body?.knowledgeBase || "").trim(),
  };
}

app.get("/api/chatbots", requireUser, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("chatbots")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: (data || []).map((bot) => serializeBot(req, bot)) });
});

app.post("/api/chatbots", requireUser, async (req, res) => {
  const fields = readBotFields(req.body);
  if (!fields.name) {
    return res.status(400).json({ error: "Nome do chatbot e obrigatorio." });
  }

  const { data, error } = await supabaseAdmin
    .from("chatbots")
    .insert({
      user_id: req.user.id,
      name: fields.name,
      openai_api_key: fields.openai_api_key,
      evolution_base_url: fields.evolution_base_url,
      evolution_api_key: fields.evolution_api_key,
      evolution_instance: fields.evolution_instance,
      system_prompt: fields.system_prompt || fallbackPrompt,
      knowledge_base: fields.knowledge_base,
    })
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, item: serializeBot(req, data) });
});

app.put("/api/chatbots/:id", requireUser, async (req, res) => {
  const existing = await findUserBot(req.user.id, req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Chatbot nao encontrado." });
  }

  const fields = readBotFields(req.body);
  if (!fields.name) {
    return res.status(400).json({ error: "Nome do chatbot e obrigatorio." });
  }

  const update = {
    name: fields.name,
    evolution_base_url: fields.evolution_base_url,
    evolution_instance: fields.evolution_instance,
    system_prompt: fields.system_prompt || fallbackPrompt,
    knowledge_base: fields.knowledge_base,
  };

  if (fields.openai_api_key) update.openai_api_key = fields.openai_api_key;
  if (fields.evolution_api_key) update.evolution_api_key = fields.evolution_api_key;

  const { data, error } = await supabaseAdmin
    .from("chatbots")
    .update(update)
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, item: serializeBot(req, data) });
});

app.delete("/api/chatbots/:id", requireUser, async (req, res) => {
  const existing = await findUserBot(req.user.id, req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Chatbot nao encontrado." });
  }

  const { error } = await supabaseAdmin
    .from("chatbots")
    .delete()
    .eq("id", existing.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post("/api/chatbots/:id/test", requireUser, async (req, res) => {
  try {
    const bot = await findUserBot(req.user.id, req.params.id);
    if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });
    if (!bot.openai_api_key) {
      return res.status(400).json({ error: "Chatbot sem chave da OpenAI." });
    }

    const question = req.body?.question || "Diga oi em uma frase curta.";
    const answer = await generateAiReply(bot, question);
    res.json({ answer });
  } catch (error) {
    res.status(500).json({
      error: "Falha no teste.",
      detail: error?.response?.data || error.message,
    });
  }
});

// ---------------------------------------------------------------
// Leads + Messages
// ---------------------------------------------------------------
app.get("/api/chatbots/:id/leads", requireUser, async (req, res) => {
  const bot = await findUserBot(req.user.id, req.params.id);
  if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });

  const { data, error } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("chatbot_id", bot.id)
    .order("last_message_at", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [] });
});

app.get("/api/leads/:id/messages", requireUser, async (req, res) => {
  const { data: lead, error: leadError } = await supabaseAdmin
    .from("leads")
    .select("*, chatbots!inner(user_id)")
    .eq("id", req.params.id)
    .single();

  if (leadError || !lead || lead.chatbots.user_id !== req.user.id) {
    return res.status(404).json({ error: "Lead nao encontrado." });
  }

  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ lead, items: data || [] });
});

// ---------------------------------------------------------------
// Widget publico (embed em sites)
// ---------------------------------------------------------------
app.get("/api/public/chatbots/:id", async (req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: "Sem Supabase." });

  const { data: bot } = await supabaseAdmin
    .from("chatbots")
    .select("id, name")
    .eq("id", req.params.id)
    .single();

  if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });
  res.json({ id: bot.id, name: bot.name });
});

app.post("/api/public/chat/:id", async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: "Sem Supabase." });

    const { data: bot } = await supabaseAdmin
      .from("chatbots")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });
    if (!bot.openai_api_key) {
      return res.status(400).json({ error: "Chatbot sem chave OpenAI." });
    }

    const sessionId = String(req.body?.sessionId || "").trim().slice(0, 80);
    const message = String(req.body?.message || "").trim().slice(0, 4000);
    const visitorName = String(req.body?.name || "").trim().slice(0, 120) || null;

    if (!sessionId || !message) {
      return res.status(400).json({ error: "sessionId e message sao obrigatorios." });
    }

    const phone = `web-${sessionId}`;
    const lead = await upsertLead(bot.id, phone, visitorName, "web");

    await saveMessage(lead.id, "user", message);
    const history = await getRecentHistory(lead.id, 12);
    const historyWithoutLast = history.slice(0, -1);
    const reply = await generateAiReply(bot, message, historyWithoutLast);
    await saveMessage(lead.id, "assistant", reply);

    res.json({ reply });
  } catch (error) {
    const src = error.source || "unknown";
    const detail = error.message || String(error);
    console.error(`[WIDGET ${src}] ${detail} | code=${error.code || "?"}`);
    res.status(500).json({
      error: "Erro ao processar mensagem.",
      source: src,
      detail,
    });
  }
});

// ---------------------------------------------------------------
// Webhook da Evolution
// ---------------------------------------------------------------
async function upsertLead(chatbotId, phone, pushName, source = "whatsapp") {
  const { data: existing } = await supabaseAdmin
    .from("leads")
    .select("*")
    .eq("chatbot_id", chatbotId)
    .eq("phone", phone)
    .maybeSingle();

  if (existing) {
    const update = { last_message_at: new Date().toISOString() };
    if (pushName && !existing.name) update.name = pushName;

    const { data, error } = await supabaseAdmin
      .from("leads")
      .update(update)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  const payload = {
    chatbot_id: chatbotId,
    phone,
    name: pushName || null,
    source,
  };

  let { data, error } = await supabaseAdmin
    .from("leads")
    .insert(payload)
    .select("*")
    .single();

  // Fallback: banco ainda sem a coluna `source` (migracao pendente)
  const msgMissingSource =
    error &&
    (error.code === "42703" ||
      error.code === "PGRST204" ||
      /'source'|"source"|column .*source/i.test(error.message || ""));

  if (msgMissingSource) {
    console.warn(
      "[LEADS] coluna `source` nao existe ainda. Rode o ALTER TABLE no Supabase. Continuando sem source.",
    );
    delete payload.source;
    const retry = await supabaseAdmin
      .from("leads")
      .insert(payload)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  return data;
}

async function getRecentHistory(leadId, limit = 10) {
  const { data } = await supabaseAdmin
    .from("messages")
    .select("role, content")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data || [])
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }));
}

async function saveMessage(leadId, role, content) {
  await supabaseAdmin
    .from("messages")
    .insert({ lead_id: leadId, role, content });
}

app.post("/webhook/evolution/:botId", async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Servidor sem configuracao do Supabase." });
    }

    const { data: bot } = await supabaseAdmin
      .from("chatbots")
      .select("*")
      .eq("id", req.params.botId)
      .single();

    if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });
    if (!isBotConfigured(bot)) {
      return res.status(400).json({ error: "Chatbot sem configuracao completa." });
    }

    const remoteJid = req.body?.data?.key?.remoteJid || req.body?.remoteJid;
    const fromMe = req.body?.data?.key?.fromMe || false;
    const number = sanitizePhone(remoteJid);
    const text = extractIncomingMessage(req.body);
    const pushName = extractPushName(req.body);

    if (!number || !text || fromMe) {
      return res.status(200).json({ ignored: true });
    }

    const lead = await upsertLead(bot.id, number, pushName);
    await saveMessage(lead.id, "user", text);

    const history = await getRecentHistory(lead.id, 12);
    const historyWithoutLast = history.slice(0, -1);
    const reply = await generateAiReply(bot, text, historyWithoutLast);

    await saveMessage(lead.id, "assistant", reply);
    await sendEvolutionMessage(bot, number, reply);

    res.status(200).json({ ok: true });
  } catch (error) {
    const src = error.source || "unknown";
    const line = `[WEBHOOK ${src}] ${error.message}`;
    console.error(line);
    res.status(500).json({
      error: "Erro ao processar webhook.",
      source: src,
      detail: error.message,
    });
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
  });
}
