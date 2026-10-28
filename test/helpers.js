import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function server(t,extra={}){
 const dir=mkdtempSync(path.join(os.tmpdir(),'eventflow-v28-test-'));let child,base;
 const start=async()=>{
  child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,EVENTFLOW_DATA_DIR:dir,PORT:'0',HOST:'127.0.0.1',SMTP_HOST:'',SMTP_FROM:'',...extra},stdio:'pipe'});
  let error='',out='';child.stderr.on('data',b=>error+=b);child.stdout.on('data',b=>out+=b);
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){if(child.exitCode!==null)throw Error('Server exited: '+error);const match=out.match(/running on 127\.0\.0\.1:(\d+)/);if(match){base='http://127.0.0.1:'+match[1];if((await fetch(base+'/api/health')).ok)return;}await new Promise(r=>setTimeout(r,50));}
  throw Error('Server timeout: '+error);
 };
 const stop=async()=>{if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill()});child=null};
 const resources=[];t.after(async()=>{for(const db of resources)if(db.isOpen)db.close();await stop();rmSync(dir,{recursive:true,force:true})});await start();
 const csrf=new Map();
 async function login(email,password){const r=await call('/api/login',{body:{email,password}});if(r.status!==200)throw Error(JSON.stringify(r.data));const cookie=r.headers.get('set-cookie').split(';')[0];const me=await call('/api/me',{cookie});csrf.set(cookie,me.data.csrfToken);return cookie;}
 async function call(url,{cookie='',body,raw,method=body===undefined&&raw===undefined?'GET':'POST',headers={},token=true}={}){
  const response=await fetch(base+url,{method,headers:{...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(cookie&&token&&csrf.has(cookie)?{'X-CSRF-Token':csrf.get(cookie)}:{}),...headers},body:raw!==undefined?raw:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:response.status,data,headers:response.headers};
 }
 return {dir,start,stop,login,call,resources,get base(){return base},csrf};
}


