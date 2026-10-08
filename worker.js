const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json; charset=utf-8",...CORS}});
async function readJson(r){try{return await r.json()}catch{return {}}}
const cleanUser=u=>String(u||"").replace(/^@/,"").trim().toLowerCase().replace(/[^a-z0-9_а-яё-]/gi,"").slice(0,32);
const pairRoom=(a,b)=>[cleanUser(a),cleanUser(b)].sort().join("__")||"default";

async function handleAI(request,env){
  if(!env.GROQ_API_KEY)return json({error:"GROQ_API_KEY_not_configured"},500);
  const d=await readJson(request),messages=Array.isArray(d.messages)?d.messages:[];
  if(!messages.length)return json({error:"messages_required"},400);
  const model=String(d.model||"openai/gpt-oss-120b");
  const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${env.GROQ_API_KEY}`},body:JSON.stringify({model,messages,temperature:typeof d.temperature==="number"?d.temperature:.8,max_completion_tokens:typeof d.max_tokens==="number"?d.max_tokens:700})});
  const result=await response.json();
  if(!response.ok)return json({error:"groq_error",status:response.status,details:result},response.status);
  return json({ok:true,model,response:result});
}
async function registry(env){return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName("__registry__"))}
async function proxy(r){return new Response(r.body,{status:r.status,headers:{...Object.fromEntries(r.headers),...CORS}})}

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(url.pathname==="/api/ai"&&request.method==="POST"){try{return await handleAI(request,env)}catch(e){return json({error:"worker_error",message:e?.message||String(e)},500)}}

  if(url.pathname==="/api/users"&&request.method==="POST"){
    const d=await readJson(request),username=cleanUser(d.username);
    if(!username)return json({error:"username_required"},400);
    return proxy(await registry(env).fetch(new Request("https://internal/registry/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...d,username})})));
  }
  if(url.pathname==="/api/search"&&request.method==="GET"){
    return proxy(await registry(env).fetch("https://internal/registry/search?q="+encodeURIComponent(cleanUser(url.searchParams.get("q")))));
  }
  if(url.pathname==="/api/friends/request"&&request.method==="POST"){
    const d=await readJson(request),from=cleanUser(d.from),to=cleanUser(d.to);
    if(!from||!to)return json({error:"users_required"},400);
    return proxy(await registry(env).fetch(new Request("https://internal/registry/friend-request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from,to})})));
  }
  if(url.pathname==="/api/friends"&&request.method==="GET"){
    return proxy(await registry(env).fetch("https://internal/registry/friends?username="+encodeURIComponent(cleanUser(url.searchParams.get("username")))));
  }

  const chatMatch=url.pathname.match(/^\/api\/chats\/([^/]+)$/);
  if(chatMatch&&(request.method==="GET"||request.method==="POST")){
    const other=cleanUser(decodeURIComponent(chatMatch[1])),d=request.method==="POST"?await readJson(request):{};
    const me=cleanUser(request.method==="POST"?d.sender:url.searchParams.get("username"));
    if(!me||!other)return json({error:"username_required"},400);
    const id=env.CHAT_ROOM.idFromName(pairRoom(me,other));
    return proxy(await env.CHAT_ROOM.get(id).fetch(new Request("https://internal/chat",{method:request.method,headers:{"Content-Type":"application/json"},body:JSON.stringify({username:me,...d})})));
  }

  if(url.pathname==="/health"||url.pathname==="/api/health")return json({ok:true,service:"Chat API"});
  if(url.pathname!=="/ws")return new Response("Два дебила: Chat worker работает.",{headers:{"content-type":"text/plain; charset=utf-8",...CORS}});
  if(request.headers.get("Upgrade")!=="websocket")return new Response("WebSocket required",{status:426,headers:CORS});
  const room=(url.searchParams.get("room")||"default").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,64)||"default";
  return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(room)).fetch(request);
}};

export class ChatRoom{
  constructor(state){this.state=state;this.clients=new Set()}
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==="/registry/users"&&request.method==="POST"){
      const d=await readJson(request),u=cleanUser(d.username);
      const existing=await this.state.storage.get("user:"+u);
      if(existing&&existing.username!==u)return json({error:"username_taken"},409);
      const user={username:u,name:String(d.name||u).slice(0,40),avatar:String(d.avatar||""),is_bot:!!d.isBot,is_assistant:!!d.isAssistant};
      await this.state.storage.put("user:"+u,user);
      return json({ok:true,user});
    }
    if(url.pathname==="/registry/search"&&request.method==="GET"){
      const q=cleanUser(url.searchParams.get("q")),list=await this.state.storage.list({prefix:"user:"}),users=[];
      for(const [,u] of list)if(!q||u.username.includes(q))users.push(u);
      return json({users:users.slice(0,50)});
    }
    if(url.pathname==="/registry/friend-request"&&request.method==="POST"){
      const d=await readJson(request),from=cleanUser(d.from),to=cleanUser(d.to);
      if(from===to)return json({error:"same_user"},400);
      if(!(await this.state.storage.get("user:"+to)))return json({error:"user_not_found"},404);
      const key="friend:"+[from,to].sort().join(":");
      const existing=await this.state.storage.get(key);
      if(existing)return json({ok:true,status:existing.status});
      const requestData={from,to,status:"pending",createdAt:Date.now()};
      await this.state.storage.put(key,requestData);
      return json({ok:true,status:"pending"});
    }
    if(url.pathname==="/registry/friends"&&request.method==="GET"){
      const u=cleanUser(url.searchParams.get("username")),list=await this.state.storage.list({prefix:"friend:"}),incoming=[],outgoing=[],friends=[];
      for(const [,r] of list){
        if(r.status==="accepted"&&(r.from===u||r.to===u))friends.push(r.from===u?r.to:r.from);
        else if(r.status==="pending"&&r.to===u)incoming.push(r);
        else if(r.status==="pending"&&r.from===u)outgoing.push(r);
      }
      return json({friends,incoming,outgoing});
    }

    if(request.headers.get("Upgrade")==="websocket"){
      const pair=new WebSocketPair(),[client,server]=Object.values(pair);
      server.accept();this.clients.add(server);
      const close=()=>this.clients.delete(server);
      server.addEventListener("close",close);server.addEventListener("error",close);
      return new Response(null,{status:101,webSocket:client});
    }
    if(request.method==="GET"){
      return json({messages:(await this.state.storage.get("messages"))||[]});
    }
    if(request.method==="POST"){
      const d=await readJson(request),sender=cleanUser(d.sender),text=String(d.text||"").trim();
      if(!sender||!text)return json({error:"message_required"},400);
      const message={id:crypto.randomUUID(),sender,text,createdAt:Date.now()};
      const data=(await this.state.storage.get("messages"))||[];data.push(message);if(data.length>500)data.splice(0,data.length-500);
      await this.state.storage.put("messages",data);
      const payload=JSON.stringify({type:"message",message});
      for(const peer of this.clients)try{peer.send(payload)}catch{}
      return json({ok:true,message});
    }
    return new Response("Method not allowed",{status:405});
  }
}