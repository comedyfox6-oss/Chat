const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8", ...CORS}
  });
}
async function readJson(request){try{return await request.json()}catch{return {}}}

async function handleAI(request, env){
  if(!env.GROQ_API_KEY)return json({error:"GROQ_API_KEY_not_configured"},500);
  const data=await readJson(request),messages=Array.isArray(data.messages)?data.messages:[];
  if(!messages.length)return json({error:"messages_required"},400);
  const model=String(data.model||"openai/gpt-oss-120b");
  const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${env.GROQ_API_KEY}`},
    body:JSON.stringify({model,messages,temperature:typeof data.temperature==="number"?data.temperature:.8,max_completion_tokens:typeof data.max_tokens==="number"?data.max_tokens:700})
  });
  const result=await response.json();
  if(!response.ok)return json({error:"groq_error",status:response.status,details:result},response.status);
  return json({ok:true,model,response:result});
}

const cleanUser=u=>String(u||"").replace(/^@/,"").trim().toLowerCase().replace(/[^a-z0-9_а-яё-]/gi,"").slice(0,32);
function pairRoom(a,b){return [cleanUser(a),cleanUser(b)].sort().join("__")||"default";}

async function registry(env){
  const id=env.CHAT_ROOM.idFromName("__registry__");
  return env.CHAT_ROOM.get(id);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==="OPTIONS")return new Response(null,{headers:CORS});

    if(url.pathname==="/api/ai"&&request.method==="POST"){
      try{return await handleAI(request,env)}catch(error){return json({error:"worker_error",message:error?.message||String(error)},500)}
    }

    if(url.pathname==="/api/users"&&request.method==="POST"){
      const d=await readJson(request),username=cleanUser(d.username);
      if(!username)return json({error:"username_required"},400);
      const r=await registry(env).fetch(new Request("https://internal/users",{method:"POST",body:JSON.stringify({...d,username})}));
      return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...CORS}});
    }

    if(url.pathname==="/api/search"&&request.method==="GET"){
      const q=cleanUser(url.searchParams.get("q"));
      const r=await registry(env).fetch("https://internal/search?q="+encodeURIComponent(q));
      return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...CORS}});
    }

    if(url.pathname==="/api/friends/request"&&request.method==="POST"){
      const d=await readJson(request),from=cleanUser(d.from),to=cleanUser(d.to);
      if(!from||!to)return json({error:"users_required"},400);
      const r=await registry(env).fetch(new Request("https://internal/friends/request",{method:"POST",body:JSON.stringify({from,to})}));
      return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...CORS}});
    }

    if(url.pathname==="/api/friends"&&request.method==="GET"){
      const u=cleanUser(url.searchParams.get("username"));
      const r=await registry(env).fetch("https://internal/friends?username="+encodeURIComponent(u));
      return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...CORS}});
    }

    const chatMatch=url.pathname.match(/^\/api\/chats\/([^/]+)$/);
    if(chatMatch&&(request.method==="GET"||request.method==="POST")){
      const other=cleanUser(decodeURIComponent(chatMatch[1]));
      const d=request.method==="POST"?await readJson(request):{};
      const me=cleanUser(request.method==="POST"?d.sender:url.searchParams.get("username"));
      if(!me||!other)return json({error:"username_required"},400);
      const room=pairRoom(me,other);
      const id=env.CHAT_ROOM.idFromName(room);
      const r=await env.CHAT_ROOM.get(id).fetch(new Request("https://internal/chat",{
        method:request.method,
        headers:{"Content-Type":"application/json"},
        body:request.method==="POST"?JSON.stringify({...d,sender:me}):JSON.stringify({username:me})
      }));
      return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...CORS}});
    }

    if(url.pathname==="/health"||url.pathname==="/api/health")return json({ok:true,service:"Chat API"});

    if(url.pathname!=="/ws")return new Response("Два дебила: Chat worker работает.",{headers:{"content-type":"text/plain; charset=utf-8",...CORS}});
    if(request.headers.get("Upgrade")!=="websocket")return new Response("WebSocket required",{status:426,headers:CORS});

    const room=(url.searchParams.get("room")||"default").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,64)||"default";
    return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(room)).fetch(request);
  }
};

export class ChatRoom{
  constructor(state){this.state=state;this.clients=new Set()}
  async fetch(request){
    if(request.headers.get("Upgrade")==="websocket"){
      const pair=new WebSocketPair(),[client,server]=Object.values(pair);
      server.accept();this.clients.add(server);
      server.addEventListener("message",event=>{for(const peer of this.clients){if(peer!==server)try{peer.send(event.data)}catch{}}});
      const close=()=>this.clients.delete(server);
      server.addEventListener("close",close);server.addEventListener("error",close);
      return new Response(null,{status:101,webSocket:client});
    }

    if(request.method==="GET"){
      const data=await this.state.storage.get("messages")||[];
      return json({messages:data});
    }

    if(request.method==="POST"){
      const d=await readJson(request);
      const sender=cleanUser(d.sender),text=String(d.text||"").trim();
      if(!sender||!text)return json({error:"message_required"},400);
      const message={id:crypto.randomUUID(),sender,text,createdAt:Date.now()};
      const data=await this.state.storage.get("messages")||[];
      data.push(message);
      if(data.length>500)data.splice(0,data.length-500);
      await this.state.storage.put("messages",data);
      const payload=JSON.stringify({type:"message",message});
      for(const peer of this.clients)try{peer.send(payload)}catch{}
      return json({ok:true,message});
    }

    return new Response("Method not allowed",{status:405});
  }
}