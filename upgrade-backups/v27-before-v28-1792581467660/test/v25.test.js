import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {DatabaseSync,backup} from 'node:sqlite';
import {createRequire} from 'node:module';
import jsQR from 'jsqr';
const require=createRequire(import.meta.url),{PNG}=require('pngjs');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=mkdtempSync(path.join(os.tmpdir(),'eventflow-v25-test-'));let child,port=34781;
async function start(dataDir){const p=port++;child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(p),HOST:'127.0.0.1',EVENTFLOW_DATA_DIR:dataDir,SMTP_HOST:'',SMTP_FROM:''},stdio:'pipe'});let error='';child.stderr.on('data',x=>error+=x);const base='http://127.0.0.1:'+p;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(error);try{if((await fetch(base+'/api/health')).ok)return base;}catch{}await new Promise(r=>setTimeout(r,80));}throw Error('Startup timeout '+error);}
async function stop(){if(!child||child.exitCode!==null)return;const p=child;await new Promise(r=>{p.once('exit',r);p.kill();});child=null;}
test('V2.5 lifecycle, real QR decoding, atomic redemption, authorization, restart and V2.4 migration',async t=>{
 t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 let base=await start(path.join(dir,'fresh')),cookie='';
 async function request(url,body,auth=true,expected=200,method=body===undefined?'GET':'POST'){
  const r=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(auth&&cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return {r,d};
 }
 const owner={email:'owner@example.test',password:'test-password-123456'};
 await request('/api/setup',owner);let login=await request('/api/login',owner);cookie=login.r.headers.get('set-cookie').split(';')[0];
 const event={title:'測試活動',capacity:12,maxPerRegistration:4,price:0,status:'open',customFields:[],category:'體驗',allowWaitlist:true};
 const e=(await request('/api/admin/events',event)).d.id;
 const e2=(await request('/api/admin/events',{...event,title:'其他活動',reviewRequired:true})).d.id;
 const attendee={name:'測試參加者',phone:'0912345678',email:'guest@example.test',participants:2};
 const reg=(await request('/api/events/'+e+'/register',attendee,false)).d;
 await request('/api/events/'+e+'/register',attendee,false,409);
 await request('/api/registrations/ticket',{id:reg.id,code:'wrong'},false,404);
 const ticket=(await request('/api/registrations/ticket',{id:reg.id,code:reg.lookupCode},false)).d;
 assert.equal((await request('/api/admin/registrations/'+reg.id+'/ticket')).d.payload,ticket.payload);
 const fullEvent=(await request('/api/admin/events',{...event,title:'候補測試',capacity:1})).d.id;
 const waitlisted=(await request('/api/events/'+fullEvent+'/register',attendee,false)).d;assert.equal(waitlisted.status,'waitlisted');await request('/api/registrations/ticket',{id:waitlisted.id,code:waitlisted.lookupCode},false,409);
 const png=PNG.sync.read(Buffer.from(ticket.qr.split(',')[1],'base64'));const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);assert.equal(decoded.data,ticket.payload);assert.ok(!ticket.payload.includes(reg.lookupCode));
 const check={payload:decoded.data,method:'camera'};
 await request('/api/admin/events/'+e+'/checkins',check,false,401);
 await request('/api/admin/events/'+e2+'/checkins',check,true,404);
 await request('/api/admin/events/'+e+'/checkins',{payload:'bad',method:'manual'},true,400);
 const pending=(await request('/api/events/'+e2+'/register',attendee,false)).d;
 await request('/api/registrations/ticket',{id:pending.id,code:pending.lookupCode},false,409);
 await request('/api/admin/registrations/'+pending.id+'/review',{status:'confirmed'});
 const approved=(await request('/api/registrations/ticket',{id:pending.id,code:pending.lookupCode},false)).d;
 await request('/api/admin/registrations/'+pending.id+'/review',{status:'cancelled'});
 await request('/api/admin/events/'+e2+'/checkins',{payload:approved.payload,method:'manual'},true,409);
 const results=await Promise.all([fetch(base+'/api/admin/events/'+e+'/checkins',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(check)}),fetch(base+'/api/admin/events/'+e+'/checkins',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(check)})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 let history=(await request('/api/admin/events/'+e+'/checkins')).d;assert.equal(history.registrations,1);assert.equal(history.people,2);assert.equal(history.rows[0].method,'camera');

 const report=(await request('/api/admin/reports?eventId='+e)).d;
 assert.equal(report.totals.registrations,1);assert.equal(report.totals.people,2);assert.equal(report.totals.checkedIn,2);assert.equal(report.totals.attendanceRate,100);assert.equal(report.trend.length,1);
 const day=report.trend[0].day;
 assert.equal((await request('/api/admin/reports?eventId='+e+'&from='+day+'&to='+day)).d.totals.people,2);
 assert.equal((await request('/api/admin/reports?to=2000-01-01')).d.totals.people,0);
 await request('/api/admin/reports?from=2026-02-30',undefined,true,400);
 await request('/api/admin/reports?from=2026-10-20&to=2026-10-01',undefined,true,400);
 await request('/api/admin/reports',undefined,false,401);
 for(const kind of ['events','registrations','checkins']){const r=await fetch(base+'/api/admin/reports/'+kind+'.csv?eventId='+e,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/csv/);const csv=await r.text();assert.ok(csv.includes('測試活動'));assert.ok(!csv.includes(reg.lookupCode));assert.ok(!csv.includes(ticket.payload));}
 const hostile=(await request('/api/admin/events',{...event,title:'=1+1,"引號"\n第二行'})).d.id;
 const csv=await (await fetch(base+'/api/admin/reports/events.csv?eventId='+hostile,{headers:{Cookie:cookie}})).text();assert.ok(csv.includes('"\'=1+1,""引號""\n第二行"'));
 const org=(await request('/api/organizations',{name:'其他組織'})).d.id;
 await request('/api/users',{email:'staff@example.test',password:owner.password,role:'staff',organizationId:org});const ownerCookie=cookie;
 cookie=(await request('/api/login',{email:'staff@example.test',password:owner.password})).r.headers.get('set-cookie').split(';')[0];
 await request('/api/admin/events/'+e+'/checkins',check,true,403);await request('/api/admin/events/'+e+'/checkins',undefined,true,403);await request('/api/admin/registrations/'+reg.id+'/ticket',undefined,true,403);
 await request('/api/admin/reports?eventId='+e,undefined,true,400);assert.equal((await request('/api/admin/reports')).d.totals.events,0);
 cookie=ownerCookie;
 const backupData=(await request('/api/admin/backup')).d;assert.equal(backupData.appVersion,'2.7.0');assert.equal(backupData.checkins.length,1);assert.equal(backupData.version,14);
 await request('/api/admin/notifications');await request('/api/admin/stats');
 // Same-organization staff can operate check-in.
 const me=(await request('/api/me')).d;await request('/api/users',{email:'localstaff@example.test',password:owner.password,role:'staff',organizationId:me.organization_id});
 cookie=(await request('/api/login',{email:'localstaff@example.test',password:owner.password})).r.headers.get('set-cookie').split(';')[0];await request('/api/admin/events/'+e+'/checkins');cookie=ownerCookie;
 await stop();base=await start(path.join(dir,'fresh'));assert.equal((await request('/api/admin/events/'+e+'/checkins')).d.registrations,1);await request('/api/admin/events/'+e+'/checkins',check,true,409);await stop();
 // Copy the real V2.4 database consistently, then migrate only the isolated copy.
 const source=new DatabaseSync(path.join(root,'data','eventflow.sqlite'),{readOnly:true});const copied=path.join(dir,'eventflow.sqlite');await backup(source,copied);const before={};for(const table of ['events','registrations','users','notifications'])before[table]=Number(source.prepare('SELECT COUNT(*) n FROM '+table).get().n);source.close();
 base=await start(dir);assert.equal((await fetch(base+'/api/health').then(r=>r.json())).version,'2.7.0');await stop();const migrated=new DatabaseSync(copied,{readOnly:true});for(const [table,count] of Object.entries(before))assert.equal(Number(migrated.prepare('SELECT COUNT(*) n FROM '+table).get().n),count);assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE name='checkins'").get());migrated.close();
 // Parse every inline and external browser script and ensure no duplicated IDs or orphan insights.
 const vm=await import('node:vm');for(const name of ['admin','index','blueprint']){const html=readFileSync(path.join(root,'public',name+'.html'),'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);assert.ok(!/V2\.[1234]\b/.test(html));if(name==='admin')assert.ok(!html.includes('v22Insights'));}
 for(const file of ['discovery.js','ticket.js','checkin.js','governance.js','reports.js'])new vm.Script(readFileSync(path.join(root,'public',file),'utf8'));
});
