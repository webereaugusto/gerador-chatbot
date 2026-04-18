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

  // CSS
  var side = cfg.position === "left" ? "left: 20px;" : "right: 20px;";
  var css =
    "" +
    ".gcw-launcher{position:fixed;bottom:20px;" +
    side +
    "width:60px;height:60px;border-radius:50%;background:" +
    cfg.color +
    ";color:#fff;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .2s}" +
    ".gcw-launcher:hover{transform:scale(1.06)}" +
    ".gcw-launcher svg{width:28px;height:28px}" +
    ".gcw-panel{position:fixed;bottom:94px;" +
    side +
    "width:360px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 20px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
    ".gcw-panel.open{display:flex}" +
    ".gcw-head{background:" +
    cfg.color +
    ";color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px}" +
    ".gcw-head-title{font-size:15px;font-weight:600;line-height:1.2}" +
    ".gcw-head-sub{font-size:12px;opacity:.9;margin-top:2px}" +
    ".gcw-close{background:transparent;border:none;color:#fff;cursor:pointer;padding:4px;border-radius:6px}" +
    ".gcw-close:hover{background:rgba(255,255,255,.15)}" +
    ".gcw-body{flex:1;overflow-y:auto;padding:14px;background:#f7f7f9;display:flex;flex-direction:column;gap:8px}" +
    ".gcw-msg{max-width:80%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;word-wrap:break-word;white-space:pre-wrap}" +
    ".gcw-msg.bot{background:#fff;color:#111;border:1px solid #e6e6ea;align-self:flex-start;border-bottom-left-radius:4px}" +
    ".gcw-msg.user{background:" +
    cfg.color +
    ";color:#fff;align-self:flex-end;border-bottom-right-radius:4px}" +
    ".gcw-msg.typing{color:#888;font-style:italic;background:#fff;border:1px solid #e6e6ea;align-self:flex-start}" +
    ".gcw-foot{padding:10px;border-top:1px solid #eee;background:#fff;display:flex;gap:8px}" +
    ".gcw-input{flex:1;border:1px solid #d8d8de;border-radius:20px;padding:9px 14px;font-size:14px;outline:none;font-family:inherit}" +
    ".gcw-input:focus{border-color:" +
    cfg.color +
    "}" +
    ".gcw-send{background:" +
    cfg.color +
    ";color:#fff;border:none;width:40px;height:40px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
    ".gcw-send:disabled{opacity:.5;cursor:not-allowed}" +
    ".gcw-brand{text-align:center;padding:6px;font-size:11px;color:#999;background:#fff;border-top:1px solid #f0f0f0}" +
    "@media(max-width:480px){.gcw-panel{bottom:0;right:0;left:0;width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0}}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // Launcher
  var launcher = document.createElement("button");
  launcher.className = "gcw-launcher";
  launcher.setAttribute("aria-label", "Abrir chat");
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // Panel
  var panel = document.createElement("div");
  panel.className = "gcw-panel";
  panel.innerHTML =
    '<div class="gcw-head">' +
    '<div><div class="gcw-head-title"></div><div class="gcw-head-sub"></div></div>' +
    '<button class="gcw-close" aria-label="Fechar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
    "</div>" +
    '<div class="gcw-body"></div>' +
    '<div class="gcw-foot">' +
    '<input class="gcw-input" type="text" />' +
    '<button class="gcw-send" aria-label="Enviar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
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

  function openPanel() {
    panel.classList.add("open");
    if (!body.dataset.greeted) {
      addMessage("bot", cfg.greeting);
      body.dataset.greeted = "1";
    }
    setTimeout(function () {
      input.focus();
    }, 50);
  }

  function closePanel() {
    panel.classList.remove("open");
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
      } else {
        addMessage("bot", data.reply || "Sem resposta.");
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
