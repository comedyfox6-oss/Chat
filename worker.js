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

  // Fair/LLM7 sends an OpenAI-compatible request.
  // Clone the request before reading the body so the original
  // Request stream never gets disturbed/locked.
  let data;
  try {
    const body = await request.clone().json();
    data = body && typeof body === "object" ? body : {};
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const messages = Array.isArray(data.messages) ? data.messages : [];

  if (!messages.length) {
    return json({ error: "messages_required" }, 400);
  }

  const payload = {
    model: String(data.model || "openai/gpt-oss-120b"),
    messages,
    temperature:
      typeof data.temperature === "number"
        ? data.temperature
        : 0.8,
    max_completion_tokens:
      typeof data.max_completion_tokens === "number"
        ? data.max_completion_tokens
        : typeof data.max_tokens === "number"
          ? data.max_tokens
          : 700
  };

  if (Array.isArray(data.tools)) payload.tools = data.tools;
  if (data.tool_choice !== undefined) payload.tool_choice = data.tool_choice;
  if (data.response_format !== undefined) payload.response_format = data.response_format;
  if (data.top_p !== undefined) payload.top_p = data.top_p;
  if (data.stop !== undefined) payload.stop = data.stop;
  if (data.seed !== undefined) payload.seed = data.seed;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GROQ_API_KEY}`
      },
      body: JSON.stringify(payload)
    }
  );

  const text = await response.text();

  // Return Groq's OpenAI-compatible response unchanged.
  return new Response(text, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") ||
        "application/json; charset=utf-8",
      ...CORS
    }
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
