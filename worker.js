const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS
    }
  });
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function handleAI(request, env) {
  if (!env.GROQ_API_KEY) {
    return json({ error: "GROQ_API_KEY_not_configured" }, 500);
  }

  const data = await readJson(request);
  const messages = Array.isArray(data.messages) ? data.messages : [];

  if (!messages.length) {
    return json({ error: "messages_required" }, 400);
  }

  const model = String(data.model || "openai/gpt-oss-120b");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: typeof data.temperature === "number" ? data.temperature : 0.8,
      max_completion_tokens: typeof data.max_tokens === "number" ? data.max_tokens : 700
    })
  });

  const result = await response.json();

  if (!response.ok) {
    return json({
      error: "groq_error",
      status: response.status,
      details: result
    }, response.status);
  }

  return json({
    ok: true,
    model,
    response: result
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // AI API — совместимый формат с Fair/LLM7, но запрос уходит в Groq.
    if (url.pathname === "/api/ai" && request.method === "POST") {
      try {
        return await handleAI(request, env);
      } catch (error) {
        return json({
          error: "worker_error",
          message: error?.message || String(error)
        }, 500);
      }
    }

    if (url.pathname === "/health") {
      return new Response("ok", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...CORS
        }
      });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "Chat API" });
    }

    if (url.pathname !== "/ws") {
      return new Response("Два дебила: WebSocket worker работает.", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...CORS
        }
      });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426, headers: CORS });
    }

    const room = (url.searchParams.get("room") || "default")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 64) || "default";

    const id = env.CHAT_ROOM.idFromName(room);
    return env.CHAT_ROOM.get(id).fetch(request);
  }
};

export class ChatRoom {
  constructor(state) {
    this.state = state;
    this.clients = new Set();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    this.clients.add(server);

    server.addEventListener("message", event => {
      for (const peer of this.clients) {
        if (peer !== server) {
          try { peer.send(event.data); } catch {}
        }
      }
    });

    const close = () => this.clients.delete(server);
    server.addEventListener("close", close);
    server.addEventListener("error", close);

    return new Response(null, { status: 101, webSocket: client });
  }
}
