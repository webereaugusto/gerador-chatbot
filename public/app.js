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

    document.body.classList.toggle("inbox-mode", target === "leads");

    if (target === "leads") loadLeadsView();
    if (target === "apikeys") loadApiKeysView();
  });
});

// ---------------------------------------------------------------
// Modais
// ---------------------------------------------------------------
const botModal = document.getElementById("botModal");
const testModal = document.getElementById("testModal");

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === "checkbox") el.checked = Boolean(value);
  else el.value = value === undefined || value === null ? "" : value;
}

function getFieldValue(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  if (el.type === "checkbox") return el.checked;
  return el.value;
}

function setFieldText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function clampTemp(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  if (Number.isNaN(n)) return 0.6;
  return Math.min(1.5, Math.max(0, n));
}

function syncTemperatureUIFromValue(raw) {
  const v = clampTemp(raw);
  const hidden = document.getElementById("botTemperature");
  const range = document.getElementById("botTemperatureRange");
  const disp = document.getElementById("botTemperatureDisplay");
  if (hidden) hidden.value = String(v);
  if (range) {
    range.value = String(v);
    range.setAttribute("aria-valuenow", String(v));
  }
  if (disp) disp.textContent = v.toFixed(1);
}

function updateBotModalSubtitle() {
  const name = String(getFieldValue("botName", "") || "").trim();
  const el = document.getElementById("botModalSubtitleText");
  if (el) el.textContent = name ? `AGENTE: ${name}` : "AGENTE: —";
}

function updatePromptCharCount() {
  const ta = document.getElementById("botSystemPrompt");
  const cnt = document.getElementById("botSystemPromptCount");
  if (!ta || !cnt) return;
  const n = (ta.value || "").length;
  cnt.textContent = `${n} / 4000`;
}

function openBotModal(bot) {
  setFieldText("botModalTitle", bot ? "Configurar chatbot" : "Novo chatbot");
  setFieldValue("botId", bot?.id || "");
  setFieldValue("botName", bot?.name || "");
  setFieldValue("botOpenAiKey", "");
  setFieldValue("botSystemPrompt", bot?.systemPrompt || "");
  setFieldValue("botKnowledgeBase", bot?.knowledgeBase || "");
  setFieldValue(
    "botWhatsappTestFilterEnabled",
    Boolean(bot?.whatsappTestFilterEnabled),
  );
  setFieldValue("botWhatsappTestPhone", bot?.whatsappTestPhone || "");

  setFieldValue("botOpenAiModel", bot?.openaiModel || "gpt-4o-mini");
  const temp = bot?.temperature ?? 0.6;
  setFieldValue("botTemperature", temp);
  syncTemperatureUIFromValue(temp);
  setFieldValue("botMaxTokens", bot?.maxTokens ?? 400);
  setFieldValue(
    "botHumanizeEnabled",
    bot ? Boolean(bot.humanizeEnabled) : true,
  );

  setFieldText(
    "botOpenAiKeyHint",
    bot?.hasOpenAiKey ? "Chave salva. Preencha apenas para substituir." : "",
  );

  const keyIn = document.getElementById("botOpenAiKey");
  const keyTog = document.getElementById("botOpenAiKeyToggle");
  if (keyIn) keyIn.type = "password";
  if (keyTog) {
    keyTog.classList.remove("is-visible");
    keyTog.setAttribute("aria-label", "Mostrar chave");
  }

  updateBotModalSubtitle();
  updatePromptCharCount();

  // carrega integracoes Google do chatbot (async, nao bloqueia abertura do modal)
  loadBotIntegrations(bot?.id || "");
  // reset do form de adicionar
  ["intUrl", "intName", "intDescription", "intRange"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const rangeRow = document.getElementById("intRangeRow");
  if (rangeRow) rangeRow.hidden = true;
  const intStatus = document.getElementById("intAddStatus");
  if (intStatus) { intStatus.textContent = ""; intStatus.className = "status-text"; }

  const statusEl = document.getElementById("botStatus");
  if (statusEl) {
    statusEl.innerText = "";
    statusEl.className = "status-text config-bot-status";
  }
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

function initBotConfigModal() {
  if (!botModal) return;

  const cancel = document.getElementById("cancelBotBtn");
  if (cancel) cancel.addEventListener("click", closeBotModal);

  const range = document.getElementById("botTemperatureRange");
  if (range) {
    range.addEventListener("input", () => {
      syncTemperatureUIFromValue(range.value);
    });
  }

  const toggle = document.getElementById("botOpenAiKeyToggle");
  const keyInput = document.getElementById("botOpenAiKey");
  if (toggle && keyInput) {
    toggle.addEventListener("click", () => {
      const showPlain = keyInput.type === "password";
      keyInput.type = showPlain ? "text" : "password";
      toggle.classList.toggle("is-visible", showPlain);
      toggle.setAttribute("aria-label", showPlain ? "Ocultar chave" : "Mostrar chave");
    });
  }

  const prompt = document.getElementById("botSystemPrompt");
  if (prompt) prompt.addEventListener("input", updatePromptCharCount);

  const nameInput = document.getElementById("botName");
  if (nameInput) nameInput.addEventListener("input", updateBotModalSubtitle);

  botModal.querySelectorAll(".config-capsule-trigger").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const section = trigger.closest(".config-capsule");
      const panelId = trigger.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!section || !panel) return;
      section.classList.toggle("is-open");
      const open = section.classList.contains("is-open");
      trigger.setAttribute("aria-expanded", open);
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    });
  });
}

initBotConfigModal();

// ---------------------------------------------------------------
// Editor grande (prompt / base de conhecimento)
// ---------------------------------------------------------------
const largeTextEditorState = {
  targetId: null,
  maxLength: null,
};

function updateLargeTextEditorCount() {
  const ta = document.getElementById("largeTextEditorField");
  const cnt = document.getElementById("largeTextEditorCount");
  const wrap = document.getElementById("largeTextEditorCountWrap");
  if (!ta || !cnt || !wrap) return;
  if (largeTextEditorState.maxLength != null) {
    wrap.hidden = false;
    cnt.textContent = `${ta.value.length} / ${largeTextEditorState.maxLength}`;
  } else {
    wrap.hidden = true;
  }
}

function openLargeTextEditor(opts) {
  const { targetId, title, maxLength, hintText } = opts;
  const backdrop = document.getElementById("largeTextEditorBackdrop");
  const ta = document.getElementById("largeTextEditorField");
  const target = document.getElementById(targetId);
  const titleEl = document.getElementById("largeTextEditorTitle");
  const hint = document.getElementById("largeTextEditorHint");
  if (!backdrop || !ta || !target || !titleEl) return;

  largeTextEditorState.targetId = targetId;
  largeTextEditorState.maxLength = maxLength != null ? maxLength : null;

  titleEl.textContent = title;
  ta.value = target.value || "";
  if (maxLength != null) ta.maxLength = maxLength;
  else ta.removeAttribute("maxLength");

  if (hint) {
    if (hintText) {
      hint.hidden = false;
      hint.textContent = hintText;
    } else {
      hint.hidden = true;
      hint.textContent = "";
    }
  }

  updateLargeTextEditorCount();
  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");
  ta.focus();
  const len = ta.value.length;
  ta.setSelectionRange(len, len);
}

function closeLargeTextEditor() {
  const backdrop = document.getElementById("largeTextEditorBackdrop");
  if (backdrop) {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
  }
  largeTextEditorState.targetId = null;
  largeTextEditorState.maxLength = null;
}

function applyLargeTextEditor() {
  const ta = document.getElementById("largeTextEditorField");
  const targetId = largeTextEditorState.targetId;
  if (!ta || !targetId) {
    closeLargeTextEditor();
    return;
  }
  const target = document.getElementById(targetId);
  if (target) {
    target.value = ta.value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }
  closeLargeTextEditor();
}

function initLargeTextEditor() {
  const backdrop = document.getElementById("largeTextEditorBackdrop");
  const field = document.getElementById("largeTextEditorField");

  document.getElementById("expandBotSystemPromptBtn")?.addEventListener("click", () => {
    openLargeTextEditor({
      targetId: "botSystemPrompt",
      title: "Editar: comportamento (prompt)",
      maxLength: 4000,
      hintText:
        "Dica: use colchetes como {{nome}} para variáveis dinâmicas (quando aplicável).",
    });
  });

  document.getElementById("expandBotKnowledgeBaseBtn")?.addEventListener("click", () => {
    openLargeTextEditor({
      targetId: "botKnowledgeBase",
      title: "Editar: base de conhecimento",
      maxLength: null,
      hintText: "",
    });
  });

  document.getElementById("applyLargeTextEditorBtn")?.addEventListener("click", applyLargeTextEditor);
  document.getElementById("cancelLargeTextEditorBtn")?.addEventListener("click", closeLargeTextEditor);
  document.getElementById("closeLargeTextEditorBtn")?.addEventListener("click", closeLargeTextEditor);

  backdrop?.addEventListener("click", (e) => {
    if (e.target === backdrop) closeLargeTextEditor();
  });

  field?.addEventListener("input", updateLargeTextEditorCount);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!backdrop?.classList.contains("open")) return;
    closeLargeTextEditor();
  });
}

initLargeTextEditor();

// ---------------------------------------------------------------
// Integrações Google por chatbot
// ---------------------------------------------------------------
let currentBotIntegrations = [];

function renderIntegrationsList() {
  const container = document.getElementById("integrationsList");
  if (!container) return;
  if (!currentBotIntegrations.length) {
    container.innerHTML = '<div class="integrations-empty muted">Nenhuma integração configurada.</div>';
    return;
  }
  container.innerHTML = currentBotIntegrations
    .map((item) => {
      const typeLabel = item.type === "google_sheet" ? "Sheet" : "Doc";
      const typeClass = item.type === "google_sheet" ? "sheet" : "doc";
      const desc = escapeHtml(item.description || item.name || "");
      const range = item.sheet_range ? ` · ${escapeHtml(item.sheet_range)}` : "";
      return `
        <div class="integration-item" data-int-id="${escapeHtml(item.id)}">
          <span class="integration-item-badge ${typeClass}">${typeLabel}</span>
          <div class="integration-item-info">
            <div class="integration-item-name">${escapeHtml(item.name)}</div>
            <div class="integration-item-desc">${desc}${range}</div>
          </div>
          <div class="integration-item-actions">
            <button
              class="icon-only-btn danger"
              data-action="delete-int"
              data-int-id="${escapeHtml(item.id)}"
              title="Remover"
            >${ICONS.trash}</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function loadBotIntegrations(botId) {
  if (!botId) {
    currentBotIntegrations = [];
    renderIntegrationsList();
    return;
  }
  try {
    const res = await authFetch(`/api/chatbots/${botId}/integrations`);
    if (!res.ok) { currentBotIntegrations = []; }
    else {
      const data = await res.json().catch(() => ({}));
      currentBotIntegrations = data.items || [];
    }
  } catch {
    currentBotIntegrations = [];
  }
  renderIntegrationsList();
}

function detectIntType(url) {
  if (/spreadsheets/.test(url)) return "google_sheet";
  if (/document/.test(url)) return "google_doc";
  return null;
}

function initIntegrationsCapsule() {
  const urlInput = document.getElementById("intUrl");
  const rangeRow = document.getElementById("intRangeRow");
  if (urlInput && rangeRow) {
    urlInput.addEventListener("input", () => {
      const type = detectIntType(urlInput.value);
      rangeRow.hidden = type !== "google_sheet";
    });
  }

  const addBtn = document.getElementById("intAddBtn");
  const statusEl = document.getElementById("intAddStatus");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const botId = getFieldValue("botId", "");
      if (!botId) {
        if (statusEl) { statusEl.className = "status-text error"; statusEl.textContent = "Salve o chatbot primeiro."; }
        return;
      }
      const url = (document.getElementById("intUrl")?.value || "").trim();
      const name = (document.getElementById("intName")?.value || "").trim();
      const description = (document.getElementById("intDescription")?.value || "").trim();
      const sheetRange = (document.getElementById("intRange")?.value || "").trim();

      if (!url || !name) {
        if (statusEl) { statusEl.className = "status-text error"; statusEl.textContent = "Nome e URL são obrigatórios."; }
        return;
      }

      addBtn.disabled = true;
      if (statusEl) { statusEl.className = "status-text"; statusEl.textContent = "Adicionando..."; }

      try {
        const res = await authFetch(`/api/chatbots/${botId}/integrations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, name, description, sheetRange }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Falha ao adicionar.");

        currentBotIntegrations.push(data.item);
        renderIntegrationsList();

        document.getElementById("intUrl").value = "";
        document.getElementById("intName").value = "";
        document.getElementById("intDescription").value = "";
        if (document.getElementById("intRange")) document.getElementById("intRange").value = "";
        if (rangeRow) rangeRow.hidden = true;

        if (statusEl) { statusEl.className = "status-text ok"; statusEl.textContent = "Adicionado."; }
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 2500);
      } catch (err) {
        if (statusEl) { statusEl.className = "status-text error"; statusEl.textContent = err.message || "Erro."; }
      } finally {
        addBtn.disabled = false;
      }
    });
  }

  document.getElementById("integrationsList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='delete-int']");
    if (!btn) return;
    const intId = btn.dataset.intId;
    const botId = getFieldValue("botId", "");
    if (!botId || !intId) return;
    if (!confirm("Remover esta integração?")) return;
    btn.disabled = true;
    try {
      const res = await authFetch(`/api/chatbots/${botId}/integrations/${intId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Falha."); }
      currentBotIntegrations = currentBotIntegrations.filter((i) => i.id !== intId);
      renderIntegrationsList();
    } catch (err) {
      alert("Não foi possível remover: " + err.message);
      btn.disabled = false;
    }
  });
}

initIntegrationsCapsule();

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

function formatRelativeTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `há ${diffD} d`;
  return date.toLocaleDateString("pt-BR");
}

/** Exibe número do chip (apenas dígitos) com máscara BR quando possível */
function formatWhatsappPhoneDisplay(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length >= 12 && d.startsWith("55")) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 9) return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return d;
}

const ICONS = {
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 2v6"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M8 18h8"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  test: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2h8M10 2v7L5 21h14L14 9V2"/></svg>',
  widget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>',
  qrcode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M20 17v4M17 20h4"/></svg>',
};

function renderBots() {
  const list = document.getElementById("botList");

  if (cachedBots.length === 0) {
    list.innerHTML =
      '<div class="empty-state">Nenhum chatbot criado. Clique em <strong>Novo chatbot</strong> para começar.</div>';
    return;
  }

  list.innerHTML = cachedBots
    .map((bot) => {
      const status = bot.whatsappConnectionStatus || "disconnected";

      const statusMap = {
        open: { label: "CONECTADO", tone: "ok", avatarIcon: ICONS.bot },
        qr: { label: "AGUARDANDO QR", tone: "warn", avatarIcon: ICONS.qrcode },
        connecting: { label: "CONECTANDO...", tone: "warn", avatarIcon: ICONS.qrcode },
        disconnected: { label: "WHATSAPP DESCONECTADO", tone: "off", avatarIcon: ICONS.alert },
      };
      const s = statusMap[status] || statusMap.disconnected;

      const relTime = formatRelativeTime(bot.whatsappConnectedAt);
      const subtitleParts = [];
      if (bot.whatsappTestFilterEnabled) subtitleParts.push("FILTRO DE TESTE");
      if (bot.humanizeEnabled === false) subtitleParts.push("SEM HUMANIZACAO");
      const subtitle = subtitleParts.join(" · ");

      const modelLabel = bot.openaiModel || "gpt-4o-mini";

      const primaryAction =
        status === "open"
          ? `<button class="bot-primary-action danger" data-action="disconnect" data-id="${bot.id}">${ICONS.power}<span>DESCONECTAR WHATSAPP</span></button>`
          : status === "qr" || status === "connecting"
            ? `<button class="bot-primary-action warn" data-action="connect" data-id="${bot.id}">${ICONS.refresh}<span>VER QR NOVAMENTE</span></button>`
            : `<button class="bot-primary-action" data-action="connect" data-id="${bot.id}">${ICONS.link}<span>CONECTAR WHATSAPP</span></button>`;

      const hint = bot.hasOpenAiKey ? "Chave OpenAI salva" : "Chave OpenAI pendente";
      const lastInfo = relTime
        ? `Última conexão ${relTime}`
        : status === "disconnected"
          ? "Nunca conectado"
          : "Aguardando pareamento";

      return `
        <div class="bot-card bot-card-${s.tone}">
          <div class="bot-card-top">
            <div class="bot-card-heading">
              <div class="bot-card-name">${escapeHtml(bot.name)}</div>
              <div class="bot-card-status">
                <span class="status-dot status-dot-${s.tone}"></span>
                <span class="status-label">${s.label}</span>
                ${subtitle ? `<span class="status-sep">·</span><span class="status-sub">${escapeHtml(subtitle)}</span>` : ""}
              </div>
              ${
                status === "open"
                  ? `<div class="bot-card-wa-phone">${
                      bot.whatsappSharePhone
                        ? `<span class="bot-card-wa-phone-label">Chip</span><span class="bot-card-wa-phone-num">${escapeHtml(formatWhatsappPhoneDisplay(bot.whatsappSharePhone))}</span>`
                        : '<span class="bot-card-wa-phone-pending">Sincronizando número do WhatsApp…</span>'
                    }</div>`
                  : ""
              }
            </div>
            <div class="bot-avatar bot-avatar-${s.tone}">${s.avatarIcon}</div>
          </div>

          <div class="bot-info-grid">
            <div class="bot-info-tile">
              <span class="info-icon">${ICONS.clock}</span>
              <div class="info-text">
                <div class="info-label">${status === "open" ? "Ativo" : "Status"}</div>
                <div class="info-value">${escapeHtml(lastInfo)}</div>
              </div>
            </div>
            <div class="bot-info-tile">
              <span class="info-icon">${ICONS.cpu}</span>
              <div class="info-text">
                <div class="info-label">Modelo</div>
                <div class="info-value" title="${escapeHtml(hint)}">${escapeHtml(modelLabel)}</div>
              </div>
            </div>
          </div>

          ${primaryAction}

          <div class="bot-action-row">
            <button class="bot-action-btn" data-action="widget" data-id="${bot.id}">${ICONS.widget}<span>WIDGET</span></button>
            <button class="bot-action-btn" data-action="share" data-id="${bot.id}">${ICONS.share}<span>COMPARTILHAR</span></button>
            <button class="bot-action-btn" data-action="leads" data-id="${bot.id}">${ICONS.leads}<span>LEADS</span></button>
          </div>

          <div class="bot-card-footer">
            <div class="bot-footer-icons">
              <button class="icon-only-btn" data-action="test" data-id="${bot.id}" title="Testar">${ICONS.test}</button>
              <button class="icon-only-btn danger" data-action="delete" data-id="${bot.id}" title="Excluir">${ICONS.trash}</button>
            </div>
            <button class="bot-footer-cta" data-action="edit" data-id="${bot.id}">CONFIGURAR</button>
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
  } else if (action === "share") {
    openShareModal(bot);
  } else if (action === "leads") {
    document.querySelector('.nav-item[data-view="leads"]').click();
    document.getElementById("leadsBotSelect").value = bot.id;
    await loadLeads(bot.id);
  } else if (action === "connect") {
    await openQrModal(bot);
  } else if (action === "disconnect") {
    if (!confirm(`Desconectar WhatsApp de "${bot.name}"?`)) return;
    const res = await authFetch(`/api/chatbots/${id}/disconnect`, { method: "POST" });
    if (res.ok) await loadChatbots();
    else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Falha ao desconectar.");
    }
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
  const id = getFieldValue("botId", "");
  const temperatureRaw = getFieldValue("botTemperature", "0.6");
  const maxTokensRaw = getFieldValue("botMaxTokens", "400");
  const payload = {
    name: getFieldValue("botName", ""),
    openaiApiKey: getFieldValue("botOpenAiKey", ""),
    systemPrompt: getFieldValue("botSystemPrompt", ""),
    knowledgeBase: getFieldValue("botKnowledgeBase", ""),
    whatsappTestFilterEnabled: Boolean(
      getFieldValue("botWhatsappTestFilterEnabled", false),
    ),
    whatsappTestPhone: getFieldValue("botWhatsappTestPhone", ""),
    openaiModel: getFieldValue("botOpenAiModel", "gpt-4o-mini"),
    temperature: parseFloat(temperatureRaw) || 0.6,
    maxTokens: parseInt(maxTokensRaw, 10) || 400,
    humanizeEnabled: Boolean(getFieldValue("botHumanizeEnabled", true)),
  };

  const statusEl = document.getElementById("botStatus");
  if (statusEl) {
    statusEl.className = "status-text config-bot-status";
    statusEl.innerText = "Salvando...";
  }

  const url = id ? `/api/chatbots/${id}` : "/api/chatbots";
  const method = id ? "PUT" : "POST";

  const res = await authFetch(url, { method, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (statusEl) {
      statusEl.className = "status-text error config-bot-status";
      statusEl.innerText = data.error || "Falha ao salvar.";
    } else {
      alert(data.error || "Falha ao salvar.");
    }
    return;
  }

  if (statusEl) {
    statusEl.className = "status-text ok config-bot-status";
    statusEl.innerText = "Salvo.";
  }
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
  widgetModal.dataset.botId = bot?.id || "";
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
  widgetModal.dataset.botId = "";
});
widgetModal.addEventListener("click", (e) => {
  if (e.target === widgetModal) {
    widgetModal.classList.remove("open");
    widgetModal.dataset.botId = "";
  }
});

// ---------------------------------------------------------------
// Modal Compartilhar
// ---------------------------------------------------------------
let currentShareBot = null;
const shareModal = document.getElementById("shareModal");

function buildWaLink(phone, msg) {
  const p = phone.replace(/\D/g, "");
  if (!p) return "";
  const m = encodeURIComponent(msg || "");
  return `https://wa.me/${p}${m ? "?text=" + m : ""}`;
}

function buildWaSnippet(bot, phone, msg) {
  const link = buildWaLink(phone, msg);
  const safeLink = link.replace(/"/g, "&quot;");
  const safeName = (bot?.name || "Chatbot").replace(/</g, "&lt;");
  return `<!-- WhatsApp: ${safeName} -->
<a id="_wachat" href="${safeLink}"
   target="_blank" rel="noopener"
   style="position:fixed;bottom:24px;right:24px;z-index:9999;
background:#25d366;width:60px;height:60px;border-radius:50%;
display:flex;align-items:center;justify-content:center;
box-shadow:0 4px 16px rgba(37,211,102,.45);text-decoration:none;
transition:transform .2s">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="#fff">
    <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.668 4.61 1.824 6.5L4 29l7.703-1.797A11.933 11.933 0 0 0 16 28c6.627 0 12-5.373 12-12S22.627 3 16 3zm0 2c5.522 0 10 4.477 10 10s-4.478 10-10 10a9.94 9.94 0 0 1-5.016-1.352l-.36-.213-4.572 1.066 1.1-4.453-.234-.375A9.944 9.944 0 0 1 6 15c0-5.523 4.478-10 10-10zm-3.5 5.5c-.28 0-.735.105-1.12.525-.384.42-1.469 1.435-1.469 3.5s1.503 4.063 1.713 4.344c.21.28 2.918 4.656 7.156 6.344 3.54 1.396 4.256 1.12 5.02 1.05.763-.07 2.45-.999 2.796-1.964.348-.966.348-1.793.244-1.965-.104-.174-.384-.279-.804-.49-.42-.21-2.448-1.207-2.828-1.347-.384-.14-.663-.21-.943.21-.28.418-1.085 1.348-1.329 1.628-.244.28-.488.315-.908.105-.42-.21-1.773-.654-3.379-2.086-1.248-1.115-2.092-2.492-2.338-2.912-.244-.42-.026-.647.184-.857.187-.188.42-.49.628-.735.21-.244.28-.42.42-.699.14-.28.07-.525-.036-.735-.104-.21-.924-2.275-1.294-3.104C13.416 11.063 13.053 11 12.803 11a3.32 3.32 0 0 0-.303.003z"/>
  </svg>
</a>
<script>
  var _b=document.getElementById('_wachat');
  _b.onmouseenter=function(){this.style.transform='scale(1.12)'};
  _b.onmouseleave=function(){this.style.transform='scale(1)'};
<\/script>`;
}

function refreshShareContent() {
  const phone = document.getElementById("sharePhone").value.trim().replace(/\D/g, "");
  const msg = document.getElementById("shareMessage").value.trim();
  document.getElementById("shareWaLink").value = buildWaLink(phone, msg);
  document.getElementById("shareSnippet").value = buildWaSnippet(currentShareBot, phone, msg);
}

function openShareModal(bot) {
  currentShareBot = bot;
  document.getElementById("sharePhone").value = bot.whatsappSharePhone || "";
  document.getElementById("shareMessage").value = "Olá! Gostaria de saber mais.";
  document.getElementById("sharePhoneStatus").innerText = "";
  document.getElementById("sharePhoneStatus").className = "status-text";
  document.getElementById("shareSnippetStatus").innerText = "";
  document.getElementById("shareSnippetStatus").className = "status-text";
  refreshShareContent();
  shareModal.classList.add("open");
}

function closeShareModal() {
  shareModal.classList.remove("open");
}

document.getElementById("closeShareModalBtn").addEventListener("click", closeShareModal);
document.getElementById("closeShareModalFooterBtn").addEventListener("click", closeShareModal);
shareModal.addEventListener("click", (e) => {
  if (e.target === shareModal) closeShareModal();
});

document.getElementById("openShareWaBtn").addEventListener("click", () => {
  const url = document.getElementById("shareWaLink").value.trim();
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
});

["sharePhone", "shareMessage"].forEach((id) => {
  document.getElementById(id).addEventListener("input", refreshShareContent);
});

document.getElementById("saveSharePhoneBtn").addEventListener("click", async () => {
  const phone  = document.getElementById("sharePhone").value.trim().replace(/\D/g, "");
  const statusEl = document.getElementById("sharePhoneStatus");
  if (!phone) {
    statusEl.innerText = "Informe o número antes de salvar.";
    statusEl.className = "status-text error";
    return;
  }
  statusEl.innerText = "Salvando...";
  statusEl.className = "status-text";
  const res = await authFetch(`/api/chatbots/${currentShareBot.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: currentShareBot.name,
      openaiApiKey: currentShareBot.openaiApiKey,
      systemPrompt: currentShareBot.systemPrompt,
      knowledgeBase: currentShareBot.knowledgeBase,
      whatsappTestFilterEnabled: currentShareBot.whatsappTestFilterEnabled,
      whatsappTestPhone: currentShareBot.whatsappTestPhone,
      whatsappSharePhone: phone,
      openaiModel: currentShareBot.openaiModel,
      temperature: currentShareBot.temperature,
      maxTokens: currentShareBot.maxTokens,
      humanizeEnabled: currentShareBot.humanizeEnabled,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    currentShareBot = data.item || currentShareBot;
    currentShareBot.whatsappSharePhone = phone;
    statusEl.innerText = "Salvo!";
    statusEl.className = "status-text ok";
    await loadChatbots();
  } else {
    statusEl.innerText = data.error || "Erro ao salvar.";
    statusEl.className = "status-text error";
  }
});

function setShareCopyLabel(btnId, text) {
  const btn = document.getElementById(btnId);
  const lab = btn?.querySelector(".btn-share-copy-label");
  if (lab) lab.textContent = text;
  else if (btn) btn.textContent = text;
}

document.getElementById("copyShareLinkBtn").addEventListener("click", async () => {
  const link = document.getElementById("shareWaLink").value;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    setShareCopyLabel("copyShareLinkBtn", "Copiado!");
    setTimeout(() => setShareCopyLabel("copyShareLinkBtn", "Copiar link"), 2000);
  } catch { /* silently fail */ }
});

document.getElementById("copyShareSnippetBtn").addEventListener("click", async () => {
  const code = document.getElementById("shareSnippet").value;
  const statusEl = document.getElementById("shareSnippetStatus");
  try {
    await navigator.clipboard.writeText(code);
    setShareCopyLabel("copyShareSnippetBtn", "Copiado!");
    statusEl.innerText = "Snippet copiado para a área de transferência.";
    statusEl.className = "status-text ok share-snippet-status";
    setTimeout(() => {
      setShareCopyLabel("copyShareSnippetBtn", "Copiar");
      statusEl.innerText = "";
      statusEl.className = "status-text share-snippet-status";
    }, 2200);
  } catch {
    statusEl.innerText = "Erro ao copiar.";
    statusEl.className = "status-text error share-snippet-status";
  }
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
  const botId = currentWidgetBot?.id || widgetModal.dataset.botId;
  if (!botId) {
    const statusEl = document.getElementById("widgetStatus");
    statusEl.className = "status-text error";
    statusEl.innerText =
      "Abra o widget pelo botão WIDGET no card do chatbot e tente de novo.";
    return;
  }
  const params = new URLSearchParams({
    botId,
    title: document.getElementById("widgetTitle").value,
    subtitle: document.getElementById("widgetSubtitle").value,
    greeting: document.getElementById("widgetGreeting").value,
    color: document.getElementById("widgetColor").value,
    position: document.getElementById("widgetPosition").value,
  });
  const url = `${window.location.origin}/widget-demo.html?${params.toString()}`;
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    const statusEl = document.getElementById("widgetStatus");
    statusEl.className = "status-text error";
    statusEl.innerText =
      "O navegador bloqueou a nova aba. Permita pop-ups para este site ou copie o link manualmente.";
  }
});

// ---------------------------------------------------------------
// Leads e conversas (Inbox)
// ---------------------------------------------------------------
let cachedLeads = [];
let currentLead = null;
let inboxSearchTerm = "";
let inboxRefreshTimer = null;

const INBOX_ICONS = {
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
  smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  attach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
};

function populateLeadsBotSelect() {
  const select = document.getElementById("leadsBotSelect");
  if (!select) return;
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
  stopInboxRefresh();
  currentLead = null;
  renderConversationPlaceholder();
  if (botId) {
    loadLeads(botId);
    startInboxRefresh(botId);
  } else {
    cachedLeads = [];
    renderLeadsList();
    updateInboxCount();
  }
});

const inboxSearchEl = document.getElementById("inboxSearch");
if (inboxSearchEl) {
  inboxSearchEl.addEventListener("input", (e) => {
    inboxSearchTerm = e.target.value.toLowerCase().trim();
    renderLeadsList();
  });
}

function loadLeadsView() {
  populateLeadsBotSelect();
  const botId = document.getElementById("leadsBotSelect").value;
  if (botId) {
    loadLeads(botId);
    startInboxRefresh(botId);
  }
}

function startInboxRefresh(botId) {
  stopInboxRefresh();
  inboxRefreshTimer = setInterval(() => {
    loadLeads(botId, { silent: true });
    if (currentLead) loadConversation(currentLead.id, { silent: true });
  }, 15000);
}

function stopInboxRefresh() {
  if (inboxRefreshTimer) {
    clearInterval(inboxRefreshTimer);
    inboxRefreshTimer = null;
  }
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR");
}

function formatInboxTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const diffMs = now - d;
  if (diffMs < 7 * 24 * 3600 * 1000) {
    return d.toLocaleDateString("pt-BR", { weekday: "short" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatMessageTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startNow - startDay) / 86400000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function updateInboxCount() {
  const el = document.getElementById("inboxCount");
  if (!el) return;
  const visible = getVisibleLeads();
  el.textContent = String(visible.length);
}

function getVisibleLeads() {
  if (!inboxSearchTerm) return cachedLeads;
  return cachedLeads.filter((lead) => {
    const hay = `${lead.name || ""} ${lead.phone || ""} ${lead.last_message_preview || ""}`.toLowerCase();
    return hay.includes(inboxSearchTerm);
  });
}

function getInitials(str) {
  if (!str) return "?";
  const parts = String(str).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

async function loadLeads(botId, options = {}) {
  const listEl = document.getElementById("leadsList");
  if (!listEl) return;
  if (!options.silent) {
    listEl.innerHTML = '<div class="empty-state">Carregando...</div>';
  }

  const res = await authFetch(`/api/chatbots/${botId}/leads`);
  if (!res.ok) {
    if (!options.silent) {
      listEl.innerHTML = '<div class="empty-state error">Erro ao carregar leads.</div>';
    }
    return;
  }
  const data = await res.json();
  cachedLeads = data.items || [];
  renderLeadsList();
  updateInboxCount();
}

function renderLeadsList() {
  const listEl = document.getElementById("leadsList");
  if (!listEl) return;

  const visible = getVisibleLeads();

  if (visible.length === 0) {
    const msg = inboxSearchTerm
      ? "Nada encontrado para essa busca."
      : "Nenhum lead ainda.";
    listEl.innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  listEl.innerHTML = visible
    .map((lead) => {
      const isActive = currentLead && currentLead.id === lead.id;
      const display = lead.name || lead.phone || "Sem nome";
      const source = lead.source === "whatsapp" ? "wa" : "web";
      const preview = lead.last_message_preview
        ? (lead.last_message_role === "assistant" ? '<span class="preview-from-bot">Voce:</span>' : "") +
          escapeHtml(lead.last_message_preview)
        : '<span style="opacity:0.5;">Sem mensagens ainda</span>';
      const tags = [];
      if (lead.source === "web") tags.push('<span class="lead-tag">WEB</span>');
      if (lead.source === "whatsapp") tags.push('<span class="lead-tag green">WHATSAPP</span>');
      if (lead.human_takeover) tags.push('<span class="lead-tag human">HUMANO</span>');

      return `
        <div class="lead-item ${isActive ? "active" : ""}" data-lead-id="${lead.id}">
          <div class="lead-avatar">
            ${escapeHtml(getInitials(display))}
            <span class="source-badge ${source}" title="${source === "wa" ? "WhatsApp" : "Web"}">${source === "wa" ? "W" : "●"}</span>
          </div>
          <div class="lead-main">
            <div class="lead-row">
              <span class="lead-name">${escapeHtml(display)}</span>
              <span class="lead-time">${escapeHtml(formatInboxTime(lead.last_message_at))}</span>
            </div>
            <div class="lead-preview">${preview}</div>
            <div class="lead-tags">${tags.join("")}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

document.getElementById("leadsList").addEventListener("click", async (e) => {
  const item = e.target.closest(".lead-item");
  if (!item) return;
  const leadId = item.dataset.leadId;
  const lead = cachedLeads.find((l) => l.id === leadId);
  if (!lead) return;
  currentLead = lead;
  renderLeadsList();
  await loadConversation(leadId);
});

function renderConversationPlaceholder() {
  const panel = document.getElementById("conversationPanel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="inbox-placeholder">
      <div class="placeholder-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div class="placeholder-title">Escolha uma conversa</div>
      <div class="placeholder-sub">Selecione um lead na lista para ver e responder mensagens.</div>
    </div>
  `;
}

async function loadConversation(leadId, options = {}) {
  const panel = document.getElementById("conversationPanel");
  if (!panel) return;

  if (!options.silent) {
    panel.innerHTML = '<div class="inbox-placeholder"><div class="placeholder-sub">Carregando conversa...</div></div>';
  }

  const res = await authFetch(`/api/leads/${leadId}/messages`);
  if (!res.ok) {
    panel.innerHTML = '<div class="inbox-placeholder"><div class="placeholder-sub" style="color:#f87171">Erro ao carregar conversa.</div></div>';
    return;
  }

  const data = await res.json();
  const lead = data.lead;
  currentLead = { ...currentLead, ...lead };

  const bot = cachedBots.find((b) => b.id === lead.chatbot_id);
  const whatsappOk = bot?.whatsappConnectionStatus === "open";
  const isWhatsapp = lead.source === "whatsapp";
  const isHuman = !!lead.human_takeover;

  // Web: sempre pode enviar (vai por polling do widget)
  // WhatsApp: so com conexao aberta
  const canSend = isWhatsapp ? whatsappOk : true;

  const display = lead.name || lead.phone;
  const statusTxt = isWhatsapp
    ? whatsappOk
      ? '<span class="chat-header-status">WhatsApp conectado</span>'
      : '<span class="chat-header-status off">WhatsApp desconectado</span>'
    : '<span class="chat-header-status off">Canal: Web widget</span>';

  const header = `
    <div class="chat-header">
      <div class="chat-header-avatar">${escapeHtml(getInitials(display))}</div>
      <div class="chat-header-main">
        <div class="chat-header-name">
          <span>${escapeHtml(display)}</span>
          <span class="chat-header-sep">·</span>
          ${statusTxt}
        </div>
        <div class="chat-header-sub">${escapeHtml(lead.phone)} · criado em ${formatDate(lead.created_at)}</div>
      </div>
      <div class="chat-header-actions">
        <button class="icon-only-btn" id="chatRefreshBtn" title="Atualizar">${INBOX_ICONS.refresh}</button>
      </div>
    </div>
    <div class="takeover-bar">
      <div class="takeover-toggle" role="group" aria-label="Modo de resposta">
        <button class="takeover-btn ${!isHuman ? "active" : ""}" data-mode="ai" ${!isHuman ? "disabled" : ""}>IA</button>
        <button class="takeover-btn ${isHuman ? "active human" : ""}" data-mode="human" ${isHuman ? "disabled" : ""}>HUMANO</button>
      </div>
      <div class="takeover-hint ${isHuman ? "active" : ""}">
        ${isHuman ? "IA pausada · voce esta respondendo este lead" : "IA responde automaticamente"}
      </div>
    </div>
  `;

  const items = data.items || [];
  let bodyHtml = "";
  let lastDay = "";
  if (items.length === 0) {
    bodyHtml = `<div class="inbox-placeholder" style="height:100%;"><div class="placeholder-sub">Sem mensagens ainda.</div></div>`;
  } else {
    bodyHtml = items
      .map((m) => {
        const day = formatDayLabel(m.created_at);
        const sep = day !== lastDay ? `<div class="msg-day-sep">${escapeHtml(day)}</div>` : "";
        lastDay = day;
        const avatarLabel = m.role === "assistant" ? "AI" : getInitials(display);
        return `
          ${sep}
          <div class="msg-wrap ${m.role}">
            <div class="msg-avatar">${escapeHtml(avatarLabel)}</div>
            <div class="msg-content">
              <div class="msg-bubble">${escapeHtml(m.content)}</div>
              <div class="msg-time">${escapeHtml(formatMessageTime(m.created_at))}</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  let footerHint = "";
  let placeholder = "Digite sua resposta...";
  if (!isWhatsapp) {
    footerHint = '<span class="status-ok">Envio direto ao widget (entregue no proximo polling)</span>';
  } else if (!whatsappOk) {
    footerHint = '<span class="status-error">WhatsApp do chatbot desconectado — conecte para enviar.</span>';
    placeholder = "Conecte o WhatsApp do chatbot para enviar.";
  } else {
    footerHint = '<span class="status-ok">Pronto para enviar via WhatsApp</span>';
  }

  const composer = `
    <div class="chat-composer">
      <div class="chat-composer-inner">
        <button class="composer-tool" title="Adicionar" tabindex="-1" disabled>${INBOX_ICONS.plus}</button>
        <textarea id="chatComposerInput" class="chat-composer-input" rows="1" placeholder="${escapeHtml(placeholder)}" ${canSend ? "" : "disabled"}></textarea>
        <button class="composer-tool" title="Emoji" tabindex="-1" disabled>${INBOX_ICONS.smile}</button>
        <button class="composer-tool" title="Anexo" tabindex="-1" disabled>${INBOX_ICONS.attach}</button>
        <button id="chatSendBtn" class="chat-send" ${canSend ? "" : "disabled"} title="Enviar">${INBOX_ICONS.send}</button>
      </div>
      <div class="chat-composer-footer">
        ${footerHint}
        <span>Enter para enviar · Shift+Enter para nova linha</span>
      </div>
    </div>
  `;

  panel.innerHTML = `${header}<div class="chat-body" id="chatBody">${bodyHtml}</div>${composer}`;

  const body = panel.querySelector("#chatBody");
  if (body) body.scrollTop = body.scrollHeight;

  const refreshBtn = panel.querySelector("#chatRefreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadConversation(leadId));

  panel.querySelectorAll(".takeover-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.mode;
      const enabled = mode === "human";
      if (enabled === isHuman) return;
      btn.disabled = true;
      try {
        const r = await authFetch(`/api/leads/${leadId}/takeover`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Falha ao alterar modo");
        if (currentLead) currentLead.human_takeover = !!j.human_takeover;
        const idx = cachedLeads.findIndex((l) => l.id === leadId);
        if (idx >= 0) cachedLeads[idx].human_takeover = !!j.human_takeover;
        renderLeadsList();
        await loadConversation(leadId, { silent: true });
      } catch (err) {
        alert("Nao foi possivel alterar o modo: " + (err.message || err));
        btn.disabled = false;
      }
    });
  });

  const input = panel.querySelector("#chatComposerInput");
  const sendBtn = panel.querySelector("#chatSendBtn");
  if (input && sendBtn) {
    const autoResize = () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 160) + "px";
    };
    input.addEventListener("input", autoResize);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendBtn.click();
      }
    });
    sendBtn.addEventListener("click", async () => {
      const text = input.value.trim();
      if (!text || sendBtn.disabled) return;
      sendBtn.disabled = true;
      input.disabled = true;
      const prevPlaceholder = input.placeholder;
      input.placeholder = "Enviando...";
      try {
        const resp = await authFetch(`/api/leads/${leadId}/send-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(result.error || "Falha ao enviar");
        }
        input.value = "";
        autoResize();
        await loadConversation(leadId, { silent: true });
        if (currentLead) {
          const botId = currentLead.chatbot_id;
          if (botId) await loadLeads(botId, { silent: true });
        }
      } catch (err) {
        alert("Nao foi possivel enviar: " + (err.message || err));
      } finally {
        input.placeholder = prevPlaceholder;
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      }
    });
  }
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

// ---------------------------------------------------------------
// QR modal (conexão WhatsApp gerenciada pelo Evolution)
// ---------------------------------------------------------------
const qrModal = document.getElementById("qrModal");
let qrCurrentBotId = null;
let qrPollTimer = null;
let qrPollStart = 0;
const QR_POLL_TIMEOUT_MS = 120000;

function setQrImage(base64) {
  const img = document.getElementById("qrImage");
  const loading = document.getElementById("qrLoading");
  if (base64) {
    const src = base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
    img.src = src;
    img.style.display = "block";
    loading.style.display = "none";
  } else {
    img.style.display = "none";
    loading.style.display = "block";
  }
}

function setQrStatus(cls, text) {
  const el = document.getElementById("qrStatus");
  el.className = "status-text" + (cls ? " " + cls : "");
  el.innerText = text || "";
}

async function openQrModal(bot) {
  qrCurrentBotId = bot.id;
  document.getElementById("qrBotName").innerText = bot.name;
  setQrImage(null);
  setQrStatus("", "Gerando QR code...");
  qrModal.classList.add("open");
  await requestQr(bot.id);
}

async function requestQr(botId) {
  setQrImage(null);
  setQrStatus("", "Solicitando instância ao Evolution...");
  const res = await authFetch(`/api/chatbots/${botId}/connect`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setQrStatus("error", data.error || "Falha ao iniciar conexão.");
    return;
  }
  if (data.status === "open") {
    setQrStatus("ok", "WhatsApp já está conectado.");
    setTimeout(closeQrModal, 1200);
    await loadChatbots();
    return;
  }
  if (data.qrcode) {
    setQrImage(data.qrcode);
    setQrStatus("", "Escaneie o QR com o WhatsApp no seu celular.");
  } else {
    setQrStatus("", "Aguardando QR...");
  }
  startQrPolling(botId);
}

function startQrPolling(botId) {
  stopQrPolling();
  qrPollStart = Date.now();
  const tick = async () => {
    if (qrCurrentBotId !== botId) return;
    if (Date.now() - qrPollStart > QR_POLL_TIMEOUT_MS) {
      setQrStatus("error", "QR expirou. Clique em 'Gerar novo QR'.");
      return;
    }
    try {
      const res = await authFetch(`/api/chatbots/${botId}/connection-state`);
      const data = await res.json().catch(() => ({}));
      if (data.status === "open") {
        setQrStatus("ok", "Conectado ✓");
        stopQrPolling();
        await loadChatbots();
        setTimeout(closeQrModal, 1200);
        return;
      }
      if (data.status === "connecting") setQrStatus("", "Pareando...");
      if (data.status === "qr") setQrStatus("", "Escaneie o QR no celular.");
      if (data.status === "disconnected") setQrStatus("", "Aguardando leitura do QR...");
    } catch (_) {}
    qrPollTimer = setTimeout(tick, 3000);
  };
  qrPollTimer = setTimeout(tick, 3000);
}

function stopQrPolling() {
  if (qrPollTimer) {
    clearTimeout(qrPollTimer);
    qrPollTimer = null;
  }
}

function closeQrModal() {
  qrModal.classList.remove("open");
  qrCurrentBotId = null;
  stopQrPolling();
}

document.getElementById("closeQrModalBtn").addEventListener("click", closeQrModal);
document.getElementById("qrCancelBtn").addEventListener("click", closeQrModal);
qrModal.addEventListener("click", (e) => {
  if (e.target === qrModal) closeQrModal();
});
document.getElementById("qrRefreshBtn").addEventListener("click", async () => {
  if (!qrCurrentBotId) return;
  await requestQr(qrCurrentBotId);
});

bootstrap();
