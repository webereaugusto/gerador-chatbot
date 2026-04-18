let sb = null;
let session = null;
let cachedBots = [];
let selectedLeadId = null;
/** true somente depois que /api/config + createClient deram certo */
let authConfigReady = false;

function setAuthSubmitEnabled(on) {
  const btn = document.getElementById("authSubmitBtn");
  if (btn) btn.disabled = !on;
}

// ---------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------
async function bootstrap() {
  authConfigReady = false;
  setAuthSubmitEnabled(false);
  const statusEl = document.getElementById("authStatus");
  statusEl.className = "status-text";
  statusEl.innerText = "Carregando configuração...";

  let cfg;
  try {
    const res = await fetch("/api/config", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("application/json")) {
      throw new Error(
        `Resposta inválida (HTTP ${res.status}). ` +
          "Se o projeto usa Deployment Protection na Vercel, desative para o domínio de produção " +
          "(Settings → Deployment Protection).",
      );
    }
    cfg = await res.json();
  } catch (err) {
    statusEl.className = "status-text error";
    statusEl.innerText =
      "Não foi possível carregar a configuração do servidor. " +
      "Desative a Deployment Protection do projeto no Vercel " +
      "(Settings → Deployment Protection → Vercel Authentication: Disabled). " +
      "Confira também se SUPABASE_URL e SUPABASE_ANON_KEY estão definidas. " +
      "Detalhe: " +
      err.message;
    return;
  }

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    statusEl.className = "status-text error";
    statusEl.innerText =
      "Servidor sem configuração do Supabase. No Vercel, em Environment Variables, " +
      "defina SUPABASE_URL e SUPABASE_ANON_KEY e faça um novo deploy.";
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    statusEl.className = "status-text error";
    statusEl.innerText =
      "SDK do Supabase não carregou (rede ou bloqueio de script). Recarregue a página ou tente outro navegador.";
    return;
  }

  try {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const {
      data: { session: existing },
    } = await sb.auth.getSession();

    sb.auth.onAuthStateChange((_event, newSession) => {
      session = newSession;
      if (newSession) showApp();
      else showAuth();
    });

    authConfigReady = true;
    setAuthSubmitEnabled(true);
    statusEl.innerText = "";

    if (existing) {
      session = existing;
      showApp();
    } else {
      showAuth();
    }
  } catch (err) {
    sb = null;
    authConfigReady = false;
    setAuthSubmitEnabled(false);
    statusEl.className = "status-text error";
    statusEl.innerText =
      "Erro ao iniciar autenticação: " + (err.message || String(err));
  }
}

function showAuth() {
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("app").style.display = "none";
}

function showApp() {
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("app").style.display = "grid";
  document.getElementById("userEmail").innerText = session?.user?.email || "";
  loadChatbots();
}

async function authFetch(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return fetch(url, { ...options, headers });
}

// ---------------------------------------------------------------
// Auth UI
// ---------------------------------------------------------------
let authMode = "login";

document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    authMode = tab.dataset.mode;
    document.querySelectorAll(".auth-tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
    });
    document.getElementById("authSubmitBtn").innerText =
      authMode === "login" ? "Entrar" : "Criar conta";
    if (authConfigReady) {
      document.getElementById("authStatus").innerText = "";
    }

    const hint = document.getElementById("authHint");
    if (hint) {
      hint.innerHTML =
        authMode === "signup"
          ? "Informe e-mail e senha (mínimo 6 caracteres) e clique em <strong>Criar conta</strong>. Se a confirmação por e-mail estiver ativa no Supabase, você receberá um link para ativar a conta."
          : "Primeira vez? Clique em <strong>Criar conta</strong> acima, informe e-mail e senha (mínimo 6 caracteres) e clique em <strong>Criar conta</strong>.";
    }
  });
});

async function handleAuthSubmit() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const statusEl = document.getElementById("authStatus");
  const btn = document.getElementById("authSubmitBtn");

  if (!email || !password) {
    statusEl.className = "status-text error";
    statusEl.innerText = "Preencha e-mail e senha.";
    return;
  }
  if (password.length < 6) {
    statusEl.className = "status-text error";
    statusEl.innerText = "A senha precisa ter pelo menos 6 caracteres.";
    return;
  }

  if (!authConfigReady || !sb) {
    // Não sobrescrever o erro real já mostrado pelo bootstrap (ex.: env vazio).
    if (statusEl.classList.contains("error") && statusEl.innerText.trim().length > 0) {
      return;
    }
    statusEl.className = "status-text error";
    statusEl.innerText =
      "Ainda conectando… Se não habilitar o botão Entrar em alguns segundos, recarregue (Ctrl+F5) " +
      "e confira SUPABASE_URL e SUPABASE_ANON_KEY no projeto Vercel.";
    return;
  }

  btn.disabled = true;
  statusEl.className = "status-text";
  statusEl.innerText = "Processando...";

  try {
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) {
        statusEl.className = "status-text error";
        statusEl.innerText = error.message;
        return;
      }

      if (data?.session) {
        statusEl.className = "status-text ok";
        statusEl.innerText = "Conta criada. Entrando...";
        return;
      }

      const login = await sb.auth.signInWithPassword({ email, password });
      if (login.error) {
        statusEl.className = "status-text ok";
        statusEl.innerText =
          "Conta criada! Verifique seu e-mail para confirmar (olhe também o spam) e depois faça login.";
        return;
      }
      statusEl.className = "status-text ok";
      statusEl.innerText = "Conta criada. Entrando...";
      return;
    }

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      statusEl.className = "status-text error";
      statusEl.innerText =
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos. Se ainda não tem conta, clique em 'Criar conta'."
          : error.message;
      return;
    }
  } catch (err) {
    statusEl.className = "status-text error";
    statusEl.innerText = err.message || "Erro inesperado.";
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("authSubmitBtn").addEventListener("click", handleAuthSubmit);

["authEmail", "authPassword"].forEach((id) => {
  document.getElementById(id).addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const submitBtn = document.getElementById("authSubmitBtn");
    // Enter não deve enviar se o botão está desabilitado (config ainda carregando).
    if (submitBtn?.disabled) return;
    handleAuthSubmit();
  });
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (sb) await sb.auth.signOut();
});

// ---------------------------------------------------------------
// Navegacao
// ---------------------------------------------------------------
const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    const target = item.dataset.view;
    navItems.forEach((n) => n.classList.toggle("active", n === item));
    views.forEach((v) => v.classList.toggle("active", v.dataset.view === target));

    if (target === "leads") loadLeadsView();
    if (target === "apikeys") loadApiKeysView();
  });
});

// ---------------------------------------------------------------
// Modais
// ---------------------------------------------------------------
const botModal = document.getElementById("botModal");
const testModal = document.getElementById("testModal");

function openBotModal(bot) {
  document.getElementById("botModalTitle").innerText = bot ? "Editar chatbot" : "Novo chatbot";
  document.getElementById("botId").value = bot?.id || "";
  document.getElementById("botName").value = bot?.name || "";
  document.getElementById("botOpenAiKey").value = "";
  document.getElementById("botEvolutionBaseUrl").value = bot?.evolutionBaseUrl || "";
  document.getElementById("botEvolutionInstance").value = bot?.evolutionInstance || "";
  document.getElementById("botEvolutionApiKey").value = "";
  document.getElementById("botSystemPrompt").value = bot?.systemPrompt || "";
  document.getElementById("botKnowledgeBase").value = bot?.knowledgeBase || "";

  document.getElementById("botOpenAiKeyHint").innerText = bot?.hasOpenAiKey
    ? "Chave salva. Preencha apenas para substituir."
    : "";
  document.getElementById("botEvolutionApiKeyHint").innerText = bot?.hasEvolutionKey
    ? "Chave salva. Preencha apenas para substituir."
    : "";

  document.getElementById("botStatus").innerText = "";
  document.getElementById("botStatus").className = "status-text";
  botModal.classList.add("open");
}

function closeBotModal() {
  botModal.classList.remove("open");
}

document.getElementById("openNewBotBtn").addEventListener("click", () => openBotModal(null));
document.getElementById("closeBotModalBtn").addEventListener("click", closeBotModal);
botModal.addEventListener("click", (e) => {
  if (e.target === botModal) closeBotModal();
});

document.getElementById("closeTestModalBtn").addEventListener("click", () => {
  testModal.classList.remove("open");
});
testModal.addEventListener("click", (e) => {
  if (e.target === testModal) testModal.classList.remove("open");
});

// ---------------------------------------------------------------
// Chatbots
// ---------------------------------------------------------------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateStats() {
  document.getElementById("statBotsTotal").innerText = cachedBots.length;
  document.getElementById("statBotsConfigured").innerText = cachedBots.filter(
    (b) => b.configured,
  ).length;
}

async function loadChatbots() {
  const res = await authFetch("/api/chatbots");
  if (!res.ok) {
    document.getElementById("botList").innerHTML =
      '<div class="empty-state">Erro ao carregar chatbots.</div>';
    return;
  }
  const data = await res.json();
  cachedBots = data.items || [];
  updateStats();
  renderBots();
  populateLeadsBotSelect();
}

function renderBots() {
  const list = document.getElementById("botList");

  if (cachedBots.length === 0) {
    list.innerHTML =
      '<div class="empty-state">Nenhum chatbot criado. Clique em <strong>Novo chatbot</strong> para começar.</div>';
    return;
  }

  list.innerHTML = cachedBots
    .map((bot) => {
      const prompt = bot.systemPrompt
        ? bot.systemPrompt.slice(0, 100) + (bot.systemPrompt.length > 100 ? "..." : "")
        : "-";
      const knowledge = bot.knowledgeBase
        ? bot.knowledgeBase.slice(0, 100) + (bot.knowledgeBase.length > 100 ? "..." : "")
        : "Sem base de conhecimento.";

      return `
        <div class="bot-card">
          <div class="bot-card-header">
            <div class="bot-card-name">${escapeHtml(bot.name)}</div>
            <span class="badge ${bot.configured ? "ok" : "warn"}">
              ${bot.configured ? "configurado" : "incompleto"}
            </span>
          </div>

          <div class="bot-card-meta">
            <div class="meta-item">
              <span class="meta-label">Instância</span>
              <span class="meta-value">${escapeHtml(bot.evolutionInstance || "—")}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">OpenAI</span>
              <span class="meta-value">${bot.hasOpenAiKey ? "chave salva" : "pendente"}</span>
            </div>
          </div>

          <div class="bot-card-field"><strong>Prompt:</strong> ${escapeHtml(prompt)}</div>
          <div class="bot-card-field"><strong>Base:</strong> ${escapeHtml(knowledge)}</div>

          <div class="webhook-row">
            <span class="webhook-label">Webhook</span>
            <code class="webhook-url" title="${escapeHtml(bot.webhookUrl)}">${escapeHtml(
              bot.webhookUrl,
            )}</code>
            <button class="icon-btn" data-action="copy" data-url="${escapeHtml(
              bot.webhookUrl,
            )}" title="Copiar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>

          <div class="bot-card-footer">
            <button class="btn-ghost" data-action="test" data-id="${bot.id}">Testar</button>
            <button class="btn-ghost" data-action="widget" data-id="${bot.id}">Widget</button>
            <button class="btn-ghost" data-action="leads" data-id="${bot.id}">Leads</button>
            <button class="btn-ghost" data-action="edit" data-id="${bot.id}">Editar</button>
            <button class="btn-ghost danger" data-action="delete" data-id="${bot.id}">Excluir</button>
          </div>
        </div>
      `;
    })
    .join("");
}

document.getElementById("botList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "copy") {
    await copyToClipboard(btn.dataset.url, btn);
    return;
  }

  const bot = cachedBots.find((b) => b.id === id);
  if (!bot) return;

  if (action === "edit") {
    openBotModal(bot);
  } else if (action === "delete") {
    if (!confirm(`Excluir "${bot.name}"?`)) return;
    const res = await authFetch(`/api/chatbots/${id}`, { method: "DELETE" });
    if (res.ok) await loadChatbots();
  } else if (action === "test") {
    openTestModal(bot);
  } else if (action === "widget") {
    openWidgetModal(bot);
  } else if (action === "leads") {
    document.querySelector('.nav-item[data-view="leads"]').click();
    document.getElementById("leadsBotSelect").value = bot.id;
    await loadLeads(bot.id);
  }
});

async function copyToClipboard(url, btn) {
  try {
    await navigator.clipboard.writeText(url);
    if (btn) {
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 1200);
    }
  } catch (e) {
    alert("Não foi possível copiar.");
  }
}

async function saveBot() {
  const id = document.getElementById("botId").value;
  const payload = {
    name: document.getElementById("botName").value,
    openaiApiKey: document.getElementById("botOpenAiKey").value,
    evolutionBaseUrl: document.getElementById("botEvolutionBaseUrl").value,
    evolutionApiKey: document.getElementById("botEvolutionApiKey").value,
    evolutionInstance: document.getElementById("botEvolutionInstance").value,
    systemPrompt: document.getElementById("botSystemPrompt").value,
    knowledgeBase: document.getElementById("botKnowledgeBase").value,
  };

  const statusEl = document.getElementById("botStatus");
  statusEl.className = "status-text";
  statusEl.innerText = "Salvando...";

  const url = id ? `/api/chatbots/${id}` : "/api/chatbots";
  const method = id ? "PUT" : "POST";

  const res = await authFetch(url, { method, body: JSON.stringify(payload) });
  const data = await res.json();

  if (!res.ok) {
    statusEl.className = "status-text error";
    statusEl.innerText = data.error || "Falha ao salvar.";
    return;
  }

  statusEl.className = "status-text ok";
  statusEl.innerText = "Salvo.";
  await loadChatbots();
  setTimeout(closeBotModal, 500);
}

document.getElementById("saveBotBtn").addEventListener("click", saveBot);

// ---------------------------------------------------------------
// Teste
// ---------------------------------------------------------------
function openTestModal(bot) {
  document.getElementById("testBotId").value = bot.id;
  document.getElementById("testBotName").innerText = bot.name;
  document.getElementById("testResponse").innerText = "Nenhum teste ainda.";
  document.getElementById("testResponse").className = "chat-reply-text muted";
  testModal.classList.add("open");
}

async function runTest() {
  const id = document.getElementById("testBotId").value;
  const responseEl = document.getElementById("testResponse");
  responseEl.className = "chat-reply-text muted";
  responseEl.innerText = "Testando...";

  const question = document.getElementById("testQuestion").value;
  const res = await authFetch(`/api/chatbots/${id}/test`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
  const data = await res.json();

  if (res.ok) {
    responseEl.className = "chat-reply-text";
    responseEl.innerText = data.answer;
    return;
  }

  responseEl.className = "chat-reply-text error";
  responseEl.innerText = data.error || "Erro no teste.";
}

document.getElementById("runTestBtn").addEventListener("click", runTest);

// ---------------------------------------------------------------
// Widget embed
// ---------------------------------------------------------------
const widgetModal = document.getElementById("widgetModal");
let currentWidgetBot = null;

function widgetEmbedCode() {
  const bot = currentWidgetBot;
  if (!bot) return "";
  const base = window.location.origin;
  const title = document.getElementById("widgetTitle").value || "Atendimento";
  const subtitle = document.getElementById("widgetSubtitle").value || "";
  const greeting = document.getElementById("widgetGreeting").value || "";
  const color = document.getElementById("widgetColor").value || "#6366f1";
  const position = document.getElementById("widgetPosition").value || "right";

  return `<script
  src="${base}/widget.js"
  data-bot-id="${bot.id}"
  data-title="${escapeAttr(title)}"
  data-subtitle="${escapeAttr(subtitle)}"
  data-greeting="${escapeAttr(greeting)}"
  data-color="${escapeAttr(color)}"
  data-position="${position}"
  async><\/script>`;
}

function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function refreshWidgetCode() {
  document.getElementById("widgetEmbedCode").value = widgetEmbedCode();
}

function openWidgetModal(bot) {
  currentWidgetBot = bot;
  document.getElementById("widgetTitle").value = bot.name || "Atendimento";
  document.getElementById("widgetSubtitle").value = "Estamos online. Como posso ajudar?";
  document.getElementById("widgetGreeting").value = "Olá! Em que posso te ajudar hoje?";
  document.getElementById("widgetColor").value = "#6366f1";
  document.getElementById("widgetPosition").value = "right";
  document.getElementById("widgetStatus").innerText = "";
  document.getElementById("widgetStatus").className = "status-text";
  refreshWidgetCode();
  widgetModal.classList.add("open");
}

document.getElementById("closeWidgetModalBtn").addEventListener("click", () => {
  widgetModal.classList.remove("open");
});
widgetModal.addEventListener("click", (e) => {
  if (e.target === widgetModal) widgetModal.classList.remove("open");
});

["widgetTitle", "widgetSubtitle", "widgetGreeting", "widgetColor", "widgetPosition"].forEach(
  (id) => {
    document.getElementById(id).addEventListener("input", refreshWidgetCode);
    document.getElementById(id).addEventListener("change", refreshWidgetCode);
  },
);

document.getElementById("copyWidgetCodeBtn").addEventListener("click", async () => {
  const code = document.getElementById("widgetEmbedCode").value;
  const statusEl = document.getElementById("widgetStatus");
  try {
    await navigator.clipboard.writeText(code);
    statusEl.className = "status-text ok";
    statusEl.innerText = "Código copiado.";
  } catch (e) {
    statusEl.className = "status-text error";
    statusEl.innerText = "Não foi possível copiar.";
  }
});

document.getElementById("previewWidgetBtn").addEventListener("click", () => {
  if (!currentWidgetBot) return;
  const params = new URLSearchParams({
    botId: currentWidgetBot.id,
    title: document.getElementById("widgetTitle").value,
    subtitle: document.getElementById("widgetSubtitle").value,
    greeting: document.getElementById("widgetGreeting").value,
    color: document.getElementById("widgetColor").value,
    position: document.getElementById("widgetPosition").value,
  });
  window.open(`/widget-demo.html?${params.toString()}`, "_blank");
});

// ---------------------------------------------------------------
// Leads e conversas
// ---------------------------------------------------------------
function populateLeadsBotSelect() {
  const select = document.getElementById("leadsBotSelect");
  const current = select.value;
  select.innerHTML =
    '<option value="">— selecione um chatbot —</option>' +
    cachedBots
      .map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`)
      .join("");

  if (current) select.value = current;
}

document.getElementById("leadsBotSelect").addEventListener("change", (e) => {
  const botId = e.target.value;
  if (botId) loadLeads(botId);
  else {
    document.getElementById("leadsList").innerHTML =
      '<div class="empty-state">Selecione um chatbot.</div>';
    document.getElementById("conversationPanel").innerHTML =
      '<div class="empty-state">Escolha um lead para ver a conversa.</div>';
  }
});

function loadLeadsView() {
  populateLeadsBotSelect();
  const botId = document.getElementById("leadsBotSelect").value;
  if (botId) loadLeads(botId);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR");
}

async function loadLeads(botId) {
  const listEl = document.getElementById("leadsList");
  listEl.innerHTML = '<div class="empty-state">Carregando...</div>';

  const res = await authFetch(`/api/chatbots/${botId}/leads`);
  if (!res.ok) {
    listEl.innerHTML = '<div class="empty-state">Erro ao carregar leads.</div>';
    return;
  }
  const data = await res.json();

  if (!data.items || data.items.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Nenhum lead ainda.</div>';
    return;
  }

  listEl.innerHTML = data.items
    .map(
      (lead) => `
      <div class="lead-item" data-lead-id="${lead.id}">
        <div class="lead-avatar">${(lead.name || lead.phone || "?")
          .charAt(0)
          .toUpperCase()}</div>
        <div class="lead-main">
          <div class="lead-name">${escapeHtml(lead.name || lead.phone)}</div>
          <div class="lead-phone">${escapeHtml(lead.phone)}</div>
        </div>
        <div class="lead-time">${formatDate(lead.last_message_at)}</div>
      </div>
    `,
    )
    .join("");
}

document.getElementById("leadsList").addEventListener("click", async (e) => {
  const item = e.target.closest(".lead-item");
  if (!item) return;

  selectedLeadId = item.dataset.leadId;
  document.querySelectorAll(".lead-item").forEach((el) => {
    el.classList.toggle("active", el === item);
  });

  await loadConversation(selectedLeadId);
});

async function loadConversation(leadId) {
  const panel = document.getElementById("conversationPanel");
  panel.innerHTML = '<div class="empty-state">Carregando conversa...</div>';

  const res = await authFetch(`/api/leads/${leadId}/messages`);
  if (!res.ok) {
    panel.innerHTML = '<div class="empty-state">Erro ao carregar conversa.</div>';
    return;
  }

  const data = await res.json();
  const lead = data.lead;

  const header = `
    <div class="conversation-header">
      <div>
        <div class="conversation-title">${escapeHtml(lead.name || lead.phone)}</div>
        <div class="conversation-subtitle">${escapeHtml(lead.phone)}</div>
      </div>
    </div>
  `;

  if (!data.items || data.items.length === 0) {
    panel.innerHTML = header + '<div class="empty-state">Sem mensagens ainda.</div>';
    return;
  }

  const messages = data.items
    .map(
      (m) => `
      <div class="msg-bubble ${m.role}">
        <div class="msg-text">${escapeHtml(m.content)}</div>
        <div class="msg-time">${formatDate(m.created_at)}</div>
      </div>
    `,
    )
    .join("");

  panel.innerHTML = header + `<div class="conversation-body">${messages}</div>`;

  const body = panel.querySelector(".conversation-body");
  if (body) body.scrollTop = body.scrollHeight;
}

// ---------------------------------------------------------------
// API externa (chaves)
// ---------------------------------------------------------------
async function loadApiKeysView() {
  const listEl = document.getElementById("apiKeysList");
  const statusEl = document.getElementById("apiKeyCreateStatus");
  if (statusEl) statusEl.innerText = "";

  const res = await authFetch("/api/api-keys");
  if (!res.ok) {
    listEl.innerHTML =
      '<div class="empty-state error">Não foi possível carregar as chaves. Verifique se a tabela api_keys existe e se API_KEY_PEPPER está configurado.</div>';
    return;
  }
  const data = await res.json();
  renderApiKeysList(data.items || []);
}

function renderApiKeysList(items) {
  const listEl = document.getElementById("apiKeysList");
  if (!items.length) {
    listEl.innerHTML = '<div class="empty-state muted">Nenhuma chave ainda. Gere uma acima.</div>';
    return;
  }

  listEl.innerHTML = items
    .map((k) => {
      const revoked = Boolean(k.revoked_at);
      return `
      <div class="api-key-row${revoked ? " revoked" : ""}" data-key-id="${escapeHtml(k.id)}">
        <div>
          <strong>${escapeHtml(k.name)}</strong>
          <span class="api-key-meta"> · termina em …${escapeHtml(k.key_hint)}</span>
          <div class="api-key-meta">
            criada ${formatDate(k.created_at)}
            ${k.last_used_at ? ` · último uso ${formatDate(k.last_used_at)}` : ""}
            ${revoked ? ` · revogada ${formatDate(k.revoked_at)}` : ""}
          </div>
        </div>
        ${
          revoked
            ? ""
            : `<button type="button" class="btn-ghost" data-action="revoke-api-key">Revogar</button>`
        }
      </div>`;
    })
    .join("");
}

document.getElementById("createApiKeyBtn").addEventListener("click", async () => {
  const name = document.getElementById("newApiKeyName").value.trim() || "Integração";
  const statusEl = document.getElementById("apiKeyCreateStatus");
  const reveal = document.getElementById("apiKeyReveal");
  const revealVal = document.getElementById("apiKeyRevealValue");

  statusEl.className = "status-text";
  statusEl.innerText = "Gerando...";

  const res = await authFetch("/api/api-keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    statusEl.className = "status-text error";
    statusEl.innerText = data.error || "Erro ao gerar chave.";
    return;
  }

  statusEl.className = "status-text ok";
  statusEl.innerText = "Chave criada. Copie e guarde em local seguro.";
  reveal.style.display = "block";
  revealVal.value = data.key || "";
  document.getElementById("newApiKeyName").value = "";
  loadApiKeysView();
});

document.getElementById("copyNewApiKeyBtn").addEventListener("click", () => {
  const revealVal = document.getElementById("apiKeyRevealValue");
  revealVal.select();
  document.execCommand("copy");
});

document.getElementById("apiKeysList").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action='revoke-api-key']");
  if (!btn) return;
  const row = btn.closest("[data-key-id]");
  const id = row?.dataset?.keyId;
  if (!id || !confirm("Revogar esta chave? Integrações que a usam deixarão de funcionar.")) return;

  const res = await authFetch(`/api/api-keys/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Erro ao revogar.");
    return;
  }
  loadApiKeysView();
});

bootstrap();
