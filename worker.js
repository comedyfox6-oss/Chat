const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"Content-Type":"application/json; charset=utf-8",...CORS}});
async function readJson(r){try{return await r.json()}catch{return {}}}
const cleanUser=u=>String(u||"").replace(/^@/,"").trim().toLowerCase().replace(/[^a-z0-9_а-яё-]/gi,"").slice(0,32);
const pairRoom=(a,b)=>[cleanUser(a),cleanUser(b)].sort().join("__")||"default";

const b64u=(v)=>{const a=typeof v==="string"?new TextEncoder().encode(v):new Uint8Array(v);let s="";for(let n=0;n<a.length;n+=0x8000)s+=String.fromCharCode(...a.subarray(n,n+0x8000));return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")};
const b64uJson=(o)=>b64u(JSON.stringify(o));
const rawPublicKey=(j)=>{const x=Uint8Array.from(atob(j.x.replace(/-/g,"+").replace(/_/g,"/")+"=="),c=>c.charCodeAt(0));const y=Uint8Array.from(atob(j.y.replace(/-/g,"+").replace(/_/g,"/")+"=="),c=>c.charCodeAt(0));const out=new Uint8Array(65);out[0]=4;out.set(x,1);out.set(y,33);return out};
async function vapid(env){
  const reg=registry(env),key="vapid:keys";let k=await reg.fetch(new Request("https://internal/registry/vapid",{method:"GET"}));let d=await k.json();
  if(d&&d.keys)return d.keys;
  const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const privateJwk=await crypto.subtle.exportKey("jwk",pair.privateKey),publicJwk=await crypto.subtle.exportKey("jwk",pair.publicKey);
  const keys={privateJwk,publicJwk,publicKey:b64u(rawPublicKey(publicJwk))};
  const saved=await reg.fetch(new Request("https://internal/registry/vapid",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(keys)}));
  return (await saved.json()).keys||keys;
}
async function vapidAuth(env,endpoint){
  const keys=await vapid(env),aud=new URL(endpoint).origin;
  const header={typ:"JWT",alg:"ES256"},payload={aud,exp:Math.floor(Date.now()/1000)+3600,sub:"mailto:chat@comedyfox6.workers.dev"};
  const input=b64uJson(header)+"."+b64uJson(payload);
  const privateKey=await crypto.subtle.importKey("jwk",keys.privateJwk,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,new TextEncoder().encode(input)));
  return "vapid t="+input+"."+b64u(sig)+", k="+keys.publicKey;
}
async function pushToUser(env,username){
  const reg=registry(env),r=await reg.fetch("https://internal/registry/push?username="+encodeURIComponent(cleanUser(username)));
  const d=await r.json();if(!Array.isArray(d.subscriptions))return;
  for(const s of d.subscriptions){
    try{
      const auth=await vapidAuth(env,s.endpoint);
      const resp=await fetch(s.endpoint,{method:"POST",headers:{"TTL":"60","Authorization":auth}});
      if(resp.status===404||resp.status===410)await reg.fetch(new Request("https://internal/registry/push-delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:cleanUser(username),id:s.id})}));
    }catch{}
  }
}


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
  if(url.pathname==="/api/push/config"&&request.method==="GET"){const keys=await vapid(env);return json({publicKey:keys.publicKey});}
  if(url.pathname==="/api/push/subscribe"&&request.method==="POST"){const d=await readJson(request),username=cleanUser(d.username),subscription=d.subscription;if(!username||!subscription?.endpoint)return json({error:"subscription_required"},400);return proxy(await registry(env).fetch(new Request("https://internal/registry/push-subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,subscription})})));}
  if(url.pathname==="/api/friends/request"&&request.method==="POST"){
    const d=await readJson(request),from=cleanUser(d.from),to=cleanUser(d.to);
    if(!from||!to)return json({error:"users_required"},400);
    return proxy(await registry(env).fetch(new Request("https://internal/registry/friend-request",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from,to})})));
  }
  if(url.pathname==="/api/friends"&&request.method==="GET"){
    return proxy(await registry(env).fetch("https://internal/registry/friends?username="+encodeURIComponent(cleanUser(url.searchParams.get("username")))));
  }
  if(url.pathname==="/api/friends/respond"&&request.method==="POST"){
    const d=await readJson(request),from=cleanUser(d.from),user=cleanUser(d.user),action=String(d.action||"");
    return proxy(await registry(env).fetch(new Request("https://internal/registry/friend-respond",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from,user,action})})));
  }

  const chatMatch=url.pathname.match(/^\/api\/chats\/([^/]+)$/);
  if(chatMatch&&(request.method==="GET"||request.method==="POST")){
    const other=cleanUser(decodeURIComponent(chatMatch[1])),d=request.method==="POST"?await readJson(request):{};
    const me=cleanUser(request.method==="POST"?d.sender:url.searchParams.get("username"));
    if(!me||!other)return json({error:"username_required"},400);
    const id=env.CHAT_ROOM.idFromName(pairRoom(me,other));
    const target=new URL("https://internal/chat");
    if(request.method==="GET")target.searchParams.set("username",me);
    const init=request.method==="POST"?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:me,...d})}:{method:"GET"};
    const chatResponse=await env.CHAT_ROOM.get(id).fetch(new Request(target.toString(),init));
    if(request.method==="POST"&&chatResponse.ok)pushToUser(env,other).catch(()=>{});
    return proxy(chatResponse);
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
    if(url.pathname==="/registry/vapid"&&request.method==="GET"){const keys=await this.state.storage.get("vapid");return json({keys:keys||null});}
    if(url.pathname==="/registry/vapid"&&request.method==="POST"){const d=await readJson(request);await this.state.storage.put("vapid",d);return json({keys:d});}
    if(url.pathname==="/registry/push-subscribe"&&request.method==="POST"){const d=await readJson(request),u=cleanUser(d.username),s=d.subscription;if(!u||!s?.endpoint)return json({error:"invalid_subscription"},400);const id=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s.endpoint));const idb=Array.from(new Uint8Array(id)).map(x=>x.toString(16).padStart(2,"0")).join("");await this.state.storage.put("push:"+u+":"+idb,{id:idb,endpoint:s.endpoint,expirationTime:s.expirationTime||null,keys:s.keys||{}});return json({ok:true});}
    if(url.pathname==="/registry/push"&&request.method==="GET"){const u=cleanUser(url.searchParams.get("username")),list=await this.state.storage.list({prefix:"push:"+u+":"}),subscriptions=[];for(const [,s] of list)subscriptions.push(s);return json({subscriptions});}
    if(url.pathname==="/registry/push-delete"&&request.method==="POST"){const d=await readJson(request),u=cleanUser(d.username),id=String(d.id||"");if(u&&id)await this.state.storage.delete("push:"+u+":"+id);return json({ok:true});}
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
    if(url.pathname==="/registry/friend-respond"&&request.method==="POST"){
      const d=await readJson(request),to=cleanUser(d.user),from=cleanUser(d.from),action=String(d.action||"");
      if(!to||!from||!["accept","reject"].includes(action))return json({error:"invalid_request"},400);
      const key="friend:"+[from,to].sort().join(":");
      const item=await this.state.storage.get(key);
      if(!item||item.status!=="pending"||item.to!==to)return json({error:"request_not_found"},404);
      if(action==="reject"){await this.state.storage.delete(key);return json({ok:true,status:"rejected"})}
      item.status="accepted";item.acceptedAt=Date.now();await this.state.storage.put(key,item);
      return json({ok:true,status:"accepted"});
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