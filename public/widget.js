(function () {
  "use strict";

  // Descobre o script atual e a base da API
  var scriptTag =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        if ((scripts[i].src || "").indexOf("/widget.js") !== -1) return scripts[i];
      }
      return null;
    })();

  if (!scriptTag) return;

  var srcUrl = new URL(scriptTag.src, window.location.href);
  var apiBase = srcUrl.origin;

  var cfg = {
    botId: scriptTag.getAttribute("data-bot-id") || "",
    title: scriptTag.getAttribute("data-title") || "Atendimento",
    subtitle:
      scriptTag.getAttribute("data-subtitle") ||
      "Estamos online. Como posso ajudar?",
    greeting:
      scriptTag.getAttribute("data-greeting") ||
      "Olá! Em que posso te ajudar hoje?",
    color: scriptTag.getAttribute("data-color") || "#6366f1",
    position: (scriptTag.getAttribute("data-position") || "right").toLowerCase(),
    placeholder:
      scriptTag.getAttribute("data-placeholder") || "Digite sua mensagem...",
  };

  if (!cfg.botId) {
    console.warn("[chatbot-widget] data-bot-id ausente.");
    return;
  }

  // SessionId persistente por navegador
  var STORAGE_KEY = "gc_widget_session_" + cfg.botId;
  var sessionId = "";
  try {
    sessionId = localStorage.getItem(STORAGE_KEY) || "";
    if (!sessionId) {
      sessionId =
        "s-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 10);
      localStorage.setItem(STORAGE_KEY, sessionId);
    }
  } catch (e) {
    sessionId =
      "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  // CSS — usa !important para resistir a CSS global do site host
  var side = cfg.position === "left" ? "left:20px!important;" : "right:20px!important;";
  var css =
    "" +
    // Launcher (botao flutuante)
    ".gcw-launcher{position:fixed!important;bottom:20px!important;" +
    side +
    "width:60px!important;height:60px!important;min-width:60px!important;min-height:60px!important;border-radius:50%!important;background:" +
    cfg.color +
    "!important;color:#fff!important;border:none!important;padding:0!important;margin:0!important;cursor:pointer!important;box-shadow:0 8px 24px rgba(0,0,0,.2)!important;display:flex!important;align-items:center!important;justify-content:center!important;z-index:2147483000!important;transition:transform .2s!important;box-sizing:border-box!important;line-height:1!important}" +
    ".gcw-launcher:hover{transform:scale(1.06)!important}" +
    ".gcw-launcher svg,.gcw-send svg,.gcw-close svg{display:block!important;stroke:currentColor!important;fill:none!important;pointer-events:none!important;opacity:1!important;visibility:visible!important}" +
    ".gcw-launcher svg{width:28px!important;height:28px!important}" +
    ".gcw-send svg{width:18px!important;height:18px!important}" +
    ".gcw-close svg{width:20px!important;height:20px!important}" +
    // Panel
    ".gcw-panel{position:fixed!important;bottom:94px!important;" +
    side +
    "width:360px!important;max-width:calc(100vw - 24px)!important;height:540px!important;max-height:calc(100vh - 120px)!important;background:#fff!important;border-radius:14px!important;box-shadow:0 20px 40px rgba(0,0,0,.25)!important;display:none;flex-direction:column!important;overflow:hidden!important;z-index:2147483000!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif!important;box-sizing:border-box!important;color:#111!important}" +
    ".gcw-panel.open{display:flex!important}" +
    ".gcw-panel *{box-sizing:border-box!important}" +
    // Header
    ".gcw-head{background:" +
    cfg.color +
    "!important;color:#fff!important;padding:14px 16px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important}" +
    ".gcw-head-title{font-size:15px!important;font-weight:600!important;line-height:1.2!important;color:#fff!important;margin:0!important}" +
    ".gcw-head-sub{font-size:12px!important;opacity:.9!important;margin-top:2px!important;color:#fff!important}" +
    ".gcw-close{background:transparent!important;border:none!important;color:#fff!important;cursor:pointer!important;padding:4px!important;border-radius:6px!important;display:flex!important;align-items:center!important;justify-content:center!important;width:28px!important;height:28px!important}" +
    ".gcw-close:hover{background:rgba(255,255,255,.15)!important}" +
    // Body
    ".gcw-body{flex:1!important;overflow-y:auto!important;padding:14px!important;background:#f7f7f9!important;display:flex!important;flex-direction:column!important;gap:8px!important}" +
    ".gcw-msg{max-width:80%!important;padding:9px 12px!important;border-radius:14px!important;font-size:14px!important;line-height:1.4!important;word-wrap:break-word!important;white-space:pre-wrap!important;margin:0!important}" +
    ".gcw-msg.bot{background:#fff!important;color:#111!important;border:1px solid #e6e6ea!important;align-self:flex-start!important;border-bottom-left-radius:4px!important}" +
    ".gcw-msg.user{background:" +
    cfg.color +
    "!important;color:#fff!important;align-self:flex-end!important;border-bottom-right-radius:4px!important}" +
    ".gcw-msg.typing{color:#888!important;font-style:italic!important;background:#fff!important;border:1px solid #e6e6ea!important;align-self:flex-start!important}" +
    // Footer / input / send
    ".gcw-foot{padding:10px!important;border-top:1px solid #eee!important;background:#fff!important;display:flex!important;gap:8px!important;align-items:center!important}" +
    ".gcw-input{flex:1!important;border:1px solid #d8d8de!important;border-radius:20px!important;padding:9px 14px!important;font-size:14px!important;outline:none!important;font-family:inherit!important;background:#fff!important;color:#111!important;height:40px!important;box-sizing:border-box!important;margin:0!important}" +
    ".gcw-input:focus{border-color:" +
    cfg.color +
    "!important}" +
    ".gcw-send{background:" +
    cfg.color +
    "!important;color:#fff!important;border:none!important;width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;border-radius:50%!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:0!important;margin:0!important;flex-shrink:0!important;line-height:1!important;box-sizing:border-box!important}" +
    ".gcw-send:disabled{opacity:.5!important;cursor:not-allowed!important}" +
    ".gcw-brand{text-align:center!important;padding:6px!important;font-size:11px!important;color:#999!important;background:#fff!important;border-top:1px solid #f0f0f0!important;margin:0!important}" +
    "@media(max-width:480px){.gcw-panel{bottom:0!important;right:0!important;left:0!important;width:100%!important;max-width:100%!important;height:100%!important;max-height:100%!important;border-radius:0!important}}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // Launcher
  var launcher = document.createElement("button");
  launcher.className = "gcw-launcher";
  launcher.setAttribute("aria-label", "Abrir chat");
  launcher.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // Panel
  var panel = document.createElement("div");
  panel.className = "gcw-panel";
  panel.innerHTML =
    '<div class="gcw-head">' +
    '<div><div class="gcw-head-title"></div><div class="gcw-head-sub"></div></div>' +
    '<button class="gcw-close" aria-label="Fechar" type="button"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
    "</div>" +
    '<div class="gcw-body"></div>' +
    '<div class="gcw-foot">' +
    '<input class="gcw-input" type="text" />' +
    '<button class="gcw-send" aria-label="Enviar" type="button"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
    "</div>" +
    '<div class="gcw-brand">Powered by Gerador de Chatbot</div>';

  panel.querySelector(".gcw-head-title").textContent = cfg.title;
  panel.querySelector(".gcw-head-sub").textContent = cfg.subtitle;
  panel.querySelector(".gcw-input").placeholder = cfg.placeholder;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var body = panel.querySelector(".gcw-body");
  var input = panel.querySelector(".gcw-input");
  var sendBtn = panel.querySelector(".gcw-send");

  function addMessage(role, text) {
    var el = document.createElement("div");
    el.className = "gcw-msg " + role;
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function showTyping() {
    var el = document.createElement("div");
    el.className = "gcw-msg typing";
    el.textContent = "digitando...";
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  var lastMsgAt = new Date().toISOString();
  var pollTimer = null;

  async function pollMessages() {
    try {
      var url =
        apiBase +
        "/api/public/messages/" +
        cfg.botId +
        "?sessionId=" +
        encodeURIComponent(sessionId) +
        "&after=" +
        encodeURIComponent(lastMsgAt);
      var res = await fetch(url, { method: "GET" });
      if (!res.ok) return;
      var data = await res.json();
      var items = (data && data.items) || [];
      for (var i = 0; i < items.length; i++) {
        var m = items[i];
        if (m.role === "assistant") {
          addMessage("bot", m.content);
        }
        if (m.created_at && m.created_at > lastMsgAt) {
          lastMsgAt = m.created_at;
        }
      }
    } catch (e) {
      // silencioso — tenta de novo no proximo intervalo
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollMessages, 4000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function openPanel() {
    panel.classList.add("open");
    if (!body.dataset.greeted) {
      addMessage("bot", cfg.greeting);
      body.dataset.greeted = "1";
    }
    setTimeout(function () {
      input.focus();
    }, 50);
    startPolling();
  }

  function closePanel() {
    panel.classList.remove("open");
    stopPolling();
  }

  launcher.addEventListener("click", function () {
    if (panel.classList.contains("open")) closePanel();
    else openPanel();
  });
  panel.querySelector(".gcw-close").addEventListener("click", closePanel);

  async function send() {
    var text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.disabled = true;
    sendBtn.disabled = true;

    addMessage("user", text);
    var typingEl = showTyping();

    try {
      var res = await fetch(apiBase + "/api/public/chat/" + cfg.botId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId, message: text }),
      });
      var data = await res.json();
      typingEl.remove();

      if (!res.ok) {
        addMessage(
          "bot",
          "Ops, não consegui responder agora. Tente novamente em instantes.",
        );
      } else if (data && data.human_takeover) {
        // operador humano assumiu — resposta chega via polling
      } else if (data && data.reply) {
        addMessage("bot", data.reply);
        lastMsgAt = new Date().toISOString();
      }
    } catch (e) {
      typingEl.remove();
      addMessage("bot", "Sem conexão. Verifique sua internet e tente novamente.");
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
})();
