require("dotenv").config();
const crypto = require("crypto");
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
const apiKeyPepper = (process.env.API_KEY_PEPPER || "").trim();
const evolutionBaseUrl = (process.env.EVOLUTION_BASE_URL || "")
  .trim()
  .replace(/\/$/, "");
const evolutionGlobalKey = (process.env.EVOLUTION_GLOBAL_API_KEY || "").trim();

function hasEvolutionConfig() {
  return Boolean(evolutionBaseUrl && evolutionGlobalKey);
}

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

// CORS aberto para widget e API externa v1 (consultas server-to-server ou browser).
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/public/") ||
    req.path.startsWith("/api/v1/") ||
    req.path === "/widget.js"
  ) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Api-Key",
    );
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

// Normaliza telefone BR para a forma canonica 55DDDNUMERO (so digitos).
// Aceita entradas do usuario como "(19) 98194-0463", "+55 19 98194-0463",
// "019 98194-0463" etc. e do webhook (ex.: "5519981940463").
function normalizeBrPhone(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  while (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10 || digits.length === 11) {
    digits = "55" + digits;
  }
  return digits;
}

// Compara um telefone recebido pelo webhook com o whitelist do chatbot.
// Permite match exato OU suffix dos ultimos 10 digitos (tolerancia ao 9o
// digito variavel no Brasil).
function phoneMatches(incoming, stored) {
  const a = normalizeBrPhone(incoming);
  const b = normalizeBrPhone(stored);
  if (!a || !b) return false;
  if (a === b) return true;
  const suffixLen = 10;
  if (a.length < suffixLen || b.length < suffixLen) return false;
  return a.slice(-suffixLen) === b.slice(-suffixLen);
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
      bot?.evolution_instance &&
      bot?.whatsapp_connection_status === "open",
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
    hasOpenAiKey: Boolean(bot.openai_api_key),
    whatsappTestFilterEnabled: Boolean(bot.whatsapp_test_filter_enabled),
    whatsappTestPhone: bot.whatsapp_test_phone || "",
    whatsappConnectionStatus: bot.whatsapp_connection_status || "disconnected",
    whatsappConnectedAt: bot.whatsapp_connected_at || null,
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
  if (!evolutionBaseUrl) {
    const wrapped = new Error("[EVOLUTION] EVOLUTION_BASE_URL nao configurado no servidor.");
    wrapped.source = "evolution";
    throw wrapped;
  }
  if (!bot.evolution_instance) {
    const wrapped = new Error("[EVOLUTION] Chatbot sem instancia; conecte o WhatsApp antes.");
    wrapped.source = "evolution";
    throw wrapped;
  }

  const url = `${evolutionBaseUrl}/message/sendText/${bot.evolution_instance}`;
  const apiKey = bot.evolution_api_key || evolutionGlobalKey;

  try {
    await axios.post(
      url,
      { number, text },
      {
        headers: {
          apikey: apiKey,
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
// Evolution: orquestracao de instancia (gerenciada pelo backend)
// ---------------------------------------------------------------
function buildInstanceName(botId) {
  return "bot_" + String(botId || "").replace(/-/g, "").slice(0, 20);
}

function normalizeEvolutionState(raw) {
  const s = String(
    raw?.instance?.state ||
      raw?.state ||
      raw?.status ||
      raw?.instance?.status ||
      "",
  ).toLowerCase();
  if (s === "open" || s === "connected") return "open";
  if (s === "connecting" || s === "syncing") return "connecting";
  if (s === "qr" || s === "qrcode" || s === "pairing") return "qr";
  if (s === "close" || s === "closed" || s === "disconnected") return "disconnected";
  return s || "disconnected";
}

function extractQrBase64(raw) {
  const candidate =
    raw?.qrcode?.base64 ||
    raw?.base64 ||
    raw?.qr?.base64 ||
    raw?.instance?.qrcode?.base64 ||
    raw?.qrcode ||
    raw?.qr ||
    raw?.instance?.qrcode ||
    null;
  if (!candidate) return null;
  if (typeof candidate !== "string") return null;
  // Ignora se nao parece base64/url (ex.: objeto virou string "[object Object]")
  if (candidate.startsWith("[object")) return null;
  return candidate;
}

async function evoRequest(method, path, { body, instanceKey } = {}) {
  if (!hasEvolutionConfig()) {
    const e = new Error("[EVO] EVOLUTION_BASE_URL ou EVOLUTION_GLOBAL_API_KEY nao configurados.");
    e.source = "evolution";
    throw e;
  }
  const url = `${evolutionBaseUrl}${path}`;
  try {
    const res = await axios({
      method,
      url,
      data: body,
      headers: {
        apikey: instanceKey || evolutionGlobalKey,
        "Content-Type": "application/json",
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data || {});
      const e = new Error(
        `[EVO] ${method} ${path} falhou | status=${res.status} | body=${body.slice(0, 500)}`,
      );
      e.source = "evolution";
      e.httpStatus = res.status;
      e.httpBody = res.data;
      throw e;
    }
    return res.data;
  } catch (err) {
    if (err.source === "evolution") throw err;
    const e = new Error(`[EVO] ${method} ${url} falhou | err=${err.message}`);
    e.source = "evolution";
    throw e;
  }
}

async function evoCreateInstance(instanceName, webhookUrl) {
  // Formato compativel com Evolution API v2 (aceita os dois formatos de webhook)
  const payload = {
    instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    webhook: {
      url: webhookUrl,
      byEvents: false,
      base64: false,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      // mantem campos v1 por retrocompatibilidade
      enabled: true,
      webhook_by_events: false,
      webhook_base64: false,
    },
  };
  const res = await evoRequest("POST", "/instance/create", { body: payload });
  console.log(`[EVO create] instance=${instanceName} ok`);
  return res;
}

async function evoGetQr(instanceName) {
  const res = await evoRequest(
    "GET",
    `/instance/connect/${encodeURIComponent(instanceName)}`,
  );
  const hasQr = Boolean(extractQrBase64(res));
  console.log(`[EVO qr] instance=${instanceName} hasQr=${hasQr}`);
  return res;
}

async function evoGetState(instanceName) {
  return evoRequest(
    "GET",
    `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  );
}

async function evoSetWebhook(instanceName, webhookUrl) {
  // Evolution v2 usa POST /webhook/set/:name com payload {url, events, byEvents, base64}
  return evoRequest("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
    body: {
      url: webhookUrl,
      enabled: true,
      byEvents: false,
      base64: false,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      webhook_by_events: false,
      webhook_base64: false,
      webhook: {
        url: webhookUrl,
        enabled: true,
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
        webhook_by_events: false,
        webhook_base64: false,
      },
    },
  });
}

async function evoLogout(instanceName) {
  return evoRequest("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
}

async function evoDeleteInstance(instanceName) {
  return evoRequest("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
}

async function updateBotConnectionStatus(botId, status, extra = {}) {
  const update = { whatsapp_connection_status: status, ...extra };
  if (status === "open" && !extra.whatsapp_connected_at) {
    update.whatsapp_connected_at = new Date().toISOString();
  }
  await supabaseAdmin.from("chatbots").update(update).eq("id", botId);
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
// API keys (integrações externas)
// ---------------------------------------------------------------
const API_KEY_PREFIX = "gc_live_";

function hashApiKey(plain) {
  return crypto
    .createHash("sha256")
    .update(`${apiKeyPepper}\n${plain}`)
    .digest("hex");
}

function generateApiKeySecret() {
  return API_KEY_PREFIX + crypto.randomBytes(24).toString("hex");
}

function extractApiKeyFromRequest(req) {
  const x = req.headers["x-api-key"];
  if (x && typeof x === "string" && x.startsWith(API_KEY_PREFIX)) {
    return x.trim();
  }
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token.startsWith(API_KEY_PREFIX)) return token;
  }
  return null;
}

async function requireApiKey(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: "Servidor sem configuracao do Supabase." });
  }
  if (!apiKeyPepper) {
    console.warn("API_KEY_PEPPER nao definido — defina no Vercel para usar a API externa.");
    return res.status(503).json({
      error: "API externa desabilitada. Configure API_KEY_PEPPER no servidor.",
    });
  }

  const raw = extractApiKeyFromRequest(req);
  if (!raw) {
    return res.status(401).json({
      error: "Chave de API obrigatoria.",
      hint: 'Use Authorization: Bearer gc_live_... ou header X-Api-Key.',
    });
  }

  const keyHash = hashApiKey(raw);
  const { data: row, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !row) {
    return res.status(401).json({ error: "Chave de API invalida ou revogada." });
  }

  req.apiKeyId = row.id;
  req.externalUserId = row.user_id;

  supabaseAdmin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => {})
    .catch(() => {});

  next();
}

function serializeBotV1(req, bot) {
  return {
    id: bot.id,
    name: bot.name,
    createdAt: bot.created_at,
    configured: isBotConfigured(bot),
    whatsappTestFilterEnabled: Boolean(bot.whatsapp_test_filter_enabled),
    webhookUrl: buildBotWebhookUrl(req, bot.id),
  };
}

async function findLeadForExternalUser(userId, leadId) {
  const { data: lead, error } = await supabaseAdmin
    .from("leads")
    .select("id, chatbot_id, phone, name, source, last_message_at, created_at")
    .eq("id", leadId)
    .single();

  if (error || !lead) return null;
  const bot = await findUserBot(userId, lead.chatbot_id);
  if (!bot) return null;
  return lead;
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
    system_prompt: String(body?.systemPrompt || "").trim(),
    knowledge_base: String(body?.knowledgeBase || "").trim(),
    whatsapp_test_filter_enabled: Boolean(body?.whatsappTestFilterEnabled),
    whatsapp_test_phone: normalizeBrPhone(body?.whatsappTestPhone || ""),
  };
}

function validateTestFilter(fields) {
  if (!fields.whatsapp_test_filter_enabled) return null;
  if (!fields.whatsapp_test_phone) {
    return "Com o filtro de teste ligado, informe o numero permitido.";
  }
  if (fields.whatsapp_test_phone.replace(/\D/g, "").length < 10) {
    return "Numero do filtro de teste parece invalido. Use DDD + numero (ex.: (19) 98194-0463).";
  }
  return null;
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
  const filterError = validateTestFilter(fields);
  if (filterError) return res.status(400).json({ error: filterError });

  const { data, error } = await supabaseAdmin
    .from("chatbots")
    .insert({
      user_id: req.user.id,
      name: fields.name,
      openai_api_key: fields.openai_api_key,
      system_prompt: fields.system_prompt || fallbackPrompt,
      knowledge_base: fields.knowledge_base,
      whatsapp_test_filter_enabled: fields.whatsapp_test_filter_enabled,
      whatsapp_test_phone: fields.whatsapp_test_phone,
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
  const filterError = validateTestFilter(fields);
  if (filterError) return res.status(400).json({ error: filterError });

  const update = {
    name: fields.name,
    system_prompt: fields.system_prompt || fallbackPrompt,
    knowledge_base: fields.knowledge_base,
    whatsapp_test_filter_enabled: fields.whatsapp_test_filter_enabled,
    whatsapp_test_phone: fields.whatsapp_test_phone,
  };

  if (fields.openai_api_key) update.openai_api_key = fields.openai_api_key;

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

// ---------------------------------------------------------------
// Evolution: conexao gerenciada (QR code in-app, webhook auto)
// ---------------------------------------------------------------
app.post("/api/chatbots/:id/connect", requireUser, async (req, res) => {
  try {
    if (!hasEvolutionConfig()) {
      return res.status(503).json({
        error:
          "Servidor sem EVOLUTION_BASE_URL ou EVOLUTION_GLOBAL_API_KEY configurados.",
      });
    }
    const bot = await findUserBot(req.user.id, req.params.id);
    if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });

    const instanceName = bot.evolution_instance || buildInstanceName(bot.id);
    const webhookUrl = buildBotWebhookUrl(req, bot.id);

    console.log(
      `[EVO connect] bot=${bot.id} instance=${instanceName} webhook=${webhookUrl}`,
    );

    // 1) Se ja existe instancia: checar estado primeiro
    if (bot.evolution_instance) {
      try {
        const state = await evoGetState(instanceName);
        const status = normalizeEvolutionState(state);
        console.log(`[EVO connect] estado atual=${status}`);
        if (status === "open") {
          await updateBotConnectionStatus(bot.id, "open");
          return res.json({ status: "open" });
        }
      } catch (err) {
        console.warn(`[EVO connect] state falhou (${err.message}), vou tentar criar.`);
      }
    }

    // 2) Garantir que a instancia existe (cria se necessario; ignora "ja existe")
    try {
      await evoCreateInstance(instanceName, webhookUrl);
    } catch (err) {
      if (err.httpStatus === 409 || err.httpStatus === 403 || err.httpStatus === 400) {
        console.log(`[EVO connect] instancia ja existe (status=${err.httpStatus}), reusando.`);
      } else {
        throw err;
      }
    }

    // 3) Garantir webhook atualizado (idempotente, se falhar nao trava o fluxo)
    try {
      await evoSetWebhook(instanceName, webhookUrl);
    } catch (err) {
      console.warn(`[EVO connect] setWebhook falhou: ${err.message}`);
    }

    // 4) SEMPRE buscar QR fresh via GET /instance/connect/:name
    //    O QR retornado no /instance/create fica obsoleto rapido, por isso pedimos novo.
    const qrData = await evoGetQr(instanceName);
    const qrcode = extractQrBase64(qrData);
    const pairingCode = qrData?.pairingCode || qrData?.code || null;

    if (!qrcode) {
      console.error(`[EVO connect] QR vazio no retorno: ${JSON.stringify(qrData).slice(0, 400)}`);
    }

    await updateBotConnectionStatus(bot.id, "qr", {
      evolution_base_url: evolutionBaseUrl,
      evolution_instance: instanceName,
    });

    res.json({ status: "qr", qrcode, pairingCode, instance: instanceName });
  } catch (error) {
    console.error(`[EVO connect] ${error.message}`);
    res.status(500).json({
      error: "Falha ao iniciar conexao.",
      detail: error.message,
    });
  }
});

app.get("/api/chatbots/:id/connection-state", requireUser, async (req, res) => {
  try {
    if (!hasEvolutionConfig()) {
      return res.status(503).json({
        error: "Servidor sem EVOLUTION_BASE_URL ou EVOLUTION_GLOBAL_API_KEY configurados.",
      });
    }
    const bot = await findUserBot(req.user.id, req.params.id);
    if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });
    if (!bot.evolution_instance) {
      return res.json({ status: bot.whatsapp_connection_status || "disconnected" });
    }

    let status = bot.whatsapp_connection_status || "disconnected";
    try {
      const raw = await evoGetState(bot.evolution_instance);
      status = normalizeEvolutionState(raw);
    } catch (err) {
      console.warn(`[EVO state] ${err.message}`);
    }

    if (status !== bot.whatsapp_connection_status) {
      await updateBotConnectionStatus(bot.id, status);
    }

    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: "Falha ao consultar estado.", detail: error.message });
  }
});

app.post("/api/chatbots/:id/disconnect", requireUser, async (req, res) => {
  try {
    if (!hasEvolutionConfig()) {
      return res.status(503).json({ error: "Servidor sem EVOLUTION_BASE_URL ou EVOLUTION_GLOBAL_API_KEY configurados." });
    }
    const bot = await findUserBot(req.user.id, req.params.id);
    if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });
    if (!bot.evolution_instance) {
      await updateBotConnectionStatus(bot.id, "disconnected");
      return res.json({ ok: true, status: "disconnected" });
    }
    try {
      await evoLogout(bot.evolution_instance);
    } catch (err) {
      console.warn(`[EVO logout] ${err.message}`);
    }
    await updateBotConnectionStatus(bot.id, "disconnected", {
      whatsapp_connected_at: null,
    });
    res.json({ ok: true, status: "disconnected" });
  } catch (error) {
    res.status(500).json({ error: "Falha ao desconectar.", detail: error.message });
  }
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
// API externa v1 (somente leitura, chave de API)
// ---------------------------------------------------------------
app.get("/api/v1/chatbots", requireApiKey, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("chatbots")
      .select("*")
      .eq("user_id", req.externalUserId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: (data || []).map((bot) => serializeBotV1(req, bot)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/chatbots/:chatbotId/leads", requireApiKey, async (req, res) => {
  try {
    const bot = await findUserBot(req.externalUserId, req.params.chatbotId);
    if (!bot) return res.status(404).json({ error: "Chatbot nao encontrado." });

    const rawLimit = parseInt(String(req.query.limit || "50"), 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 100);
    const before = String(req.query.before || "").trim();

    let q = supabaseAdmin
      .from("leads")
      .select("*")
      .eq("chatbot_id", bot.id)
      .order("last_message_at", { ascending: false })
      .limit(limit + 1);

    if (before) {
      q = q.lt("last_message_at", before);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextBefore = hasMore && last ? last.last_message_at : null;

    res.json({
      items: page,
      nextBefore,
      hasMore: Boolean(nextBefore),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/v1/leads/:leadId/messages", requireApiKey, async (req, res) => {
  try {
    const leadRow = await findLeadForExternalUser(req.externalUserId, req.params.leadId);
    if (!leadRow) return res.status(404).json({ error: "Lead nao encontrado." });

    const lead = {
      id: leadRow.id,
      chatbot_id: leadRow.chatbot_id,
      phone: leadRow.phone,
      name: leadRow.name,
      source: leadRow.source,
      last_message_at: leadRow.last_message_at,
      created_at: leadRow.created_at,
    };

    const { data, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ lead, items: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// Gerenciamento de chaves de API (JWT do painel)
// ---------------------------------------------------------------
app.get("/api/api-keys", requireUser, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("id, name, key_hint, created_at, last_used_at, revoked_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [] });
});

app.post("/api/api-keys", requireUser, async (req, res) => {
  if (!apiKeyPepper) {
    return res.status(503).json({
      error: "Configure API_KEY_PEPPER no servidor para gerar chaves.",
    });
  }

  const name = String(req.body?.name || "").trim() || "Integração";
  const secret = generateApiKeySecret();
  const keyHint = secret.slice(-4);
  const keyHash = hashApiKey(secret);

  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .insert({
      user_id: req.user.id,
      name,
      key_hash: keyHash,
      key_hint: keyHint,
    })
    .select("id, name, created_at, key_hint")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({
    ok: true,
    key: secret,
    item: data,
  });
});

app.delete("/api/api-keys/:id", requireUser, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Chave nao encontrada ou ja revogada." });
  res.json({ ok: true });
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
    if (!bot.openai_api_key || !bot.evolution_instance) {
      return res.status(400).json({ error: "Chatbot sem configuracao completa." });
    }

    // Mensagem chegando = conexao aberta; atualizar status de forma oportunistica
    if (bot.whatsapp_connection_status !== "open") {
      updateBotConnectionStatus(bot.id, "open").catch(() => {});
    }

    const remoteJid = req.body?.data?.key?.remoteJid || req.body?.remoteJid;
    const fromMe = req.body?.data?.key?.fromMe || false;
    const isGroup =
      typeof remoteJid === "string" && remoteJid.includes("@g.us");
    const number = sanitizePhone(remoteJid);
    const text = extractIncomingMessage(req.body);
    const pushName = extractPushName(req.body);

    if (!number || !text || fromMe || isGroup) {
      return res.status(200).json({ ignored: true });
    }

    if (
      bot.whatsapp_test_filter_enabled &&
      !phoneMatches(number, bot.whatsapp_test_phone)
    ) {
      console.log(
        `[WEBHOOK filter] bot=${bot.id} bloqueou ${number} (whitelist=${bot.whatsapp_test_phone})`,
      );
      return res.status(200).json({ ignored: true, reason: "test_filter" });
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
