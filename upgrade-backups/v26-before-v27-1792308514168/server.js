import express from 'express';
import QRCode from 'qrcode';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.EVENTFLOW_DATA_DIR||path.join(root,'data');
fs.mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'eventflow.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT DEFAULT '',phone TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,passhash TEXT NOT NULL,role TEXT NOT NULL,organization_id TEXT REFERENCES organizations(id));
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',date TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',price INTEGER NOT NULL DEFAULT 0,capacity INTEGER NOT NULL, max_per_registration INTEGER NOT NULL DEFAULT 4,status TEXT NOT NULL DEFAULT 'open',archived INTEGER NOT NULL DEFAULT 0,review_required INTEGER NOT NULL DEFAULT 0,custom_fields TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL,participants INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,custom_answers TEXT NOT NULL DEFAULT '{}',field_snapshot TEXT NOT NULL DEFAULT '[]',review_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,user_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL);`);

// V1.8 additive migrations: existing V1.7 data remains intact.
for(const [table,column,definition] of [
  ['organizations','logo_url',"TEXT NOT NULL DEFAULT ''"],
  ['organizations','brand_color',"TEXT NOT NULL DEFAULT '#4658ba'"],
  ['organizations','hero_url',"TEXT NOT NULL DEFAULT ''"],
  ['organizations','tagline',"TEXT NOT NULL DEFAULT ''"],
  ['events','cover_url',"TEXT NOT NULL DEFAULT ''"],
  ['events','category',"TEXT NOT NULL DEFAULT '體驗'"]
]) {if(!db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name===column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
for(const [table,column,definition] of [['events','allow_waitlist','INTEGER NOT NULL DEFAULT 0'],['registrations','lookup_code',"TEXT NOT NULL DEFAULT ''"]]){if(!db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
db.exec(`CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,registration_id TEXT NOT NULL REFERENCES registrations(id),kind TEXT NOT NULL,email TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,sent_at TEXT,UNIQUE(registration_id,kind));`);
// V2.5: additive migration; one credential and at most one check-in per registration.
db.exec(`CREATE TABLE IF NOT EXISTS tickets(registration_id TEXT PRIMARY KEY REFERENCES registrations(id),token TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkins(id TEXT PRIMARY KEY,registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id),checkin_time TEXT NOT NULL,method TEXT NOT NULL,operator_id TEXT NOT NULL REFERENCES users(id));`);
function ticketFor(r){
 let t=db.prepare('SELECT token FROM tickets WHERE registration_id=?').get(r.id);
 if(!t){db.prepare('INSERT INTO tickets VALUES(?,?,?)').run(r.id,randomBytes(32).toString('hex'),new Date().toISOString());t=db.prepare('SELECT token FROM tickets WHERE registration_id=?').get(r.id);}
 return {payload:'EF25:'+t.token,checkedIn:!!db.prepare('SELECT id FROM checkins WHERE registration_id=?').get(r.id)};
}
const mailEnabled=!!(process.env.SMTP_HOST&&process.env.SMTP_FROM);
const mailTransport=mailEnabled?nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='1',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS||''}:undefined}):null;
function queueMail(regId,kind){const r=db.prepare('SELECT r.*,e.title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=?').get(regId);if(!r)return;const names={registered:'報名已收到',confirmed:'報名審核通過',cancelled:'報名已取消',rejected:'報名未通過'};const subject=`[EventFlow] ${names[kind]||'報名狀態更新'}：${r.title}`;const body=`${r.name} 您好：\n活動：${r.title}\n報名編號：${r.id}\n目前狀態：${r.status}\n此信為系統通知，請勿直接回覆。`;db.prepare('INSERT OR IGNORE INTO notifications(id,registration_id,kind,email,subject,body,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),r.id,kind,r.email,subject,body,new Date().toISOString());}
let mailBusy=false;async function processMail(){if(mailBusy)return;mailBusy=true;try{const rows=db.prepare("SELECT * FROM notifications WHERE status IN ('queued','retry') AND next_attempt_at<=? AND attempts<5 ORDER BY created_at LIMIT 10").all(Date.now());for(const r of rows){if(!mailEnabled){db.prepare("UPDATE notifications SET status='preview' WHERE id=?").run(r.id);continue;}try{await mailTransport.sendMail({from:process.env.SMTP_FROM,to:r.email,subject:r.subject,text:r.body});db.prepare("UPDATE notifications SET status='sent',sent_at=?,attempts=attempts+1,last_error='' WHERE id=?").run(new Date().toISOString(),r.id);}catch(err){const attempts=r.attempts+1;db.prepare('UPDATE notifications SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=?').run(attempts>=5?'failed':'retry',attempts,Date.now()+Math.min(3600000,60000*2**attempts),String(err.message||err).slice(0,300),r.id);}}}finally{mailBusy=false;}}
setInterval(()=>processMail().catch(console.error),30000).unref();
const uploads=path.join(root,'public','uploads');fs.mkdirSync(uploads,{recursive:true});
const publicOrg=o=>({id:o.id,name:o.name,logoUrl:o.logo_url,brandColor:o.brand_color,heroUrl:o.hero_url,tagline:o.tagline});
const validColor=s=>/^#[0-9a-fA-F]{6}$/.test(s);
const validCategory=s=>['旅遊','講座','營隊','體驗'].includes(s);
const app=express();app.disable('x-powered-by');
// V2.0: reject cross-site browser writes; same-origin frontends continue working on LAN and HTTPS tunnels.
app.use((req,res,next)=>{
 if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   const origin=req.get('origin');
   if(origin){try{const u=new URL(origin);const host=req.get('host');if(u.host!==host)return res.status(403).json({error:'禁止跨來源操作'});}catch{return res.status(403).json({error:'來源驗證失敗'});}}
 }
 next();
});
app.use('/admin.html',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.use(express.json({limit:'1mb'}));app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');next();});
const sha=x=>createHash('sha256').update(x).digest('hex');
const hashPass=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const verifyPass=(p,h)=>{try{const [salt,hash]=h.split(':');return timingSafeEqual(scryptSync(p,salt,64),Buffer.from(hash,'hex'));}catch{return false;}};
const bad=(res,msg,code=400)=>res.status(code).json({error:msg});
const log=(u,action,detail)=>db.prepare('INSERT INTO audit(at,user_id,action,detail) VALUES(?,?,?,?)').run(new Date().toISOString(),u?.id||null,action,String(detail||''));
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=').slice(0,2)).filter(p=>p.length===2));
function auth(req,res,next){const token=cookies(req).ef_session;if(!token)return bad(res,'請先登入',401);const user=db.prepare('SELECT u.id,u.email,u.role,u.organization_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(sha(token),Date.now());if(!user)return bad(res,'登入已失效',401);req.user=user;next();}
function canManage(u,org){return u.role==='owner'||(u.role==='admin'&&u.organization_id===org);}
function canView(u,org){return canManage(u,org)||(u.role==='staff'&&u.organization_id===org);}
const eventRow=id=>db.prepare('SELECT * FROM events WHERE id=?').get(id);
const eventJSON=e=>({...e,archived:!!e.archived,reviewRequired:!!e.review_required,allowWaitlist:!!e.allow_waitlist,customFields:JSON.parse(e.custom_fields),organizationId:e.organization_id,maxPerRegistration:e.max_per_registration,coverUrl:e.cover_url,category:e.category});
const regJSON=r=>({...r,eventId:r.event_id,participants:r.participants,customAnswers:JSON.parse(r.custom_answers),fieldSnapshot:JSON.parse(r.field_snapshot),createdAt:r.created_at,reviewNote:r.review_note});
const limit=new Map();function throttle(req,res,next){const ip=req.ip;const now=Date.now();const v=limit.get(ip)||{at:now,n:0};if(now-v.at>60000){v.at=now;v.n=0;}v.n++;limit.set(ip,v);if(v.n>45)return bad(res,'請稍後再試',429);next();}
app.post('/api/setup',throttle,(req,res)=>{
 // Initial owner creation is local-only unless explicitly opted in for classroom deployment.
 const remote=req.socket.remoteAddress||'';
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote) && process.env.ALLOW_REMOTE_SETUP!=='1')return bad(res,'請在伺服器本機完成初始管理員設定',403);
if(db.prepare('SELECT count(*) n FROM users').get().n)return bad(res,'系統已初始化',403);const {email,password}=req.body||{};if(!/^\S+@\S+\.\S+$/.test(email||'')||typeof password!=='string'||password.length<12)return bad(res,'請使用有效 Email 與至少 12 字元密碼');const org='org-default';db.prepare('INSERT OR IGNORE INTO organizations(id,name) VALUES(?,?)').run(org,'預設主辦單位');db.prepare('INSERT INTO users(id,email,passhash,role,organization_id) VALUES(?,?,?,?,?)').run(randomUUID(),email.toLowerCase(),hashPass(password),'owner',org);log(null,'setup','initial owner');res.json({ok:true});});
app.post('/api/login',throttle,(req,res)=>{const {email,password}=req.body||{};const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(email||'').toLowerCase());if(!u||typeof password!=='string'||!verifyPass(password,u.passhash))return bad(res,'帳號或密碼錯誤',401);const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(sha(token),u.id,Date.now()+8*3600000);res.setHeader('Set-Cookie',`ef_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);res.json({email:u.email,role:u.role});});
app.post('/api/logout',auth,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(cookies(req).ef_session));res.setHeader('Set-Cookie','ef_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.get('/api/events',(req,res)=>res.json(db.prepare("SELECT * FROM events WHERE archived=0 AND status='open'").all().map(e=>({id:e.id,title:e.title,date:e.date,location:e.location,capacity:e.capacity,coverUrl:e.cover_url,category:e.category,organizationId:e.organization_id}))));
app.get('/api/events/:id',(req,res)=>{const e=eventRow(req.params.id);if(!e||e.archived)return bad(res,'找不到活動',404);const occupied=db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(e.id).n;res.json({...eventJSON(e),remaining:Math.max(0,e.capacity-occupied)});});
app.get('/api/admin/events',auth,(req,res)=>{const rows=req.user.role==='owner'?db.prepare('SELECT * FROM events').all():db.prepare('SELECT * FROM events WHERE organization_id=?').all(req.user.organization_id);res.json(rows.map(eventJSON));});
app.get('/api/organizations',auth,(req,res)=>res.json(req.user.role==='owner'?db.prepare('SELECT * FROM organizations').all():db.prepare('SELECT * FROM organizations WHERE id=?').all(req.user.organization_id)));

app.get('/api/public/organizations/:id',(req,res)=>{const o=db.prepare('SELECT * FROM organizations WHERE id=?').get(req.params.id);if(!o)return bad(res,'找不到主辦單位',404);res.json(publicOrg(o));});
app.get('/api/admin/branding',auth,(req,res)=>{const o=db.prepare('SELECT * FROM organizations WHERE id=?').get(req.user.organization_id);if(!o)return bad(res,'找不到主辦單位',404);res.json(publicOrg(o));});
app.put('/api/admin/branding',auth,(req,res)=>{if(!canManage(req.user,req.user.organization_id))return bad(res,'無權限',403);const v=req.body||{};const name=String(v.name||'').trim(),tagline=String(v.tagline||'').trim(),color=String(v.brandColor||'');if(!name||name.length>100||tagline.length>160||!validColor(color))return bad(res,'品牌資料不正確');db.prepare('UPDATE organizations SET name=?,tagline=?,brand_color=? WHERE id=?').run(name,tagline,color,req.user.organization_id);log(req.user,'branding.update',req.user.organization_id);res.json({ok:true});});
app.post('/api/admin/upload',auth,express.raw({type:['image/png','image/jpeg','image/webp'],limit:'3mb'}),(req,res)=>{
 if(!canManage(req.user,req.user.organization_id))return bad(res,'無權限',403);
 const kind=String(req.query.kind||''),eventId=String(req.query.eventId||'');if(!['logo','hero','cover'].includes(kind))return bad(res,'圖片用途錯誤');
 if(kind==='cover'){const e=eventRow(eventId);if(!e||!canManage(req.user,e.organization_id))return bad(res,'無權限',403);}
 const b=req.body;if(!Buffer.isBuffer(b)||b.length<16||b.length>3*1024*1024)return bad(res,'請上傳 3MB 內的 PNG、JPEG 或 WebP 圖片');
 const png=b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
 const jpg=b[0]===255&&b[1]===216&&b[2]===255;
 const webp=b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
 if(!png&&!jpg&&!webp)return bad(res,'圖片格式不支援');
 const ext=png?'png':jpg?'jpg':'webp';const filename=randomUUID()+'.'+ext;fs.writeFileSync(path.join(uploads,filename),b,{flag:'wx'});const url='/uploads/'+filename;
 if(kind==='cover')db.prepare('UPDATE events SET cover_url=? WHERE id=?').run(url,eventId);
 else db.prepare(`UPDATE organizations SET ${kind==='logo'?'logo_url':'hero_url'}=? WHERE id=?`).run(url,req.user.organization_id);
 log(req.user,'image.upload',kind);res.json({url});
});
app.post('/api/organizations',auth,(req,res)=>{if(req.user.role!=='owner')return bad(res,'無權限',403);const name=String(req.body?.name||'').trim();if(!name||name.length>100)return bad(res,'主辦單位名稱不正確');const id=randomUUID();db.prepare('INSERT INTO organizations(id,name,email,phone) VALUES(?,?,?,?)').run(id,name,String(req.body.email||''),String(req.body.phone||''));log(req.user,'organization.create',id);res.json({id});});
app.post('/api/users',auth,(req,res)=>{if(req.user.role!=='owner')return bad(res,'無權限',403);const {email,password,role,organizationId}=req.body||{};if(!['admin','staff'].includes(role)||!db.prepare('SELECT id FROM organizations WHERE id=?').get(organizationId)||!/^\S+@\S+\.\S+$/.test(email||'')||typeof password!=='string'||password.length<12)return bad(res,'使用者資料不正確');try{const id=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,email.toLowerCase(),hashPass(password),role,organizationId);log(req.user,'user.create',id);res.json({id});}catch{return bad(res,'帳號已存在');}});
function validateEvent(v){return v&&typeof v.title==='string'&&v.title.trim().length>0&&v.title.length<=100&&Number.isInteger(v.capacity)&&v.capacity>0&&v.capacity<=1000000&&Number.isInteger(v.maxPerRegistration)&&v.maxPerRegistration>0&&v.maxPerRegistration<=100&&Number.isInteger(v.price)&&v.price>=0&&['open','closed','draft','cancelled'].includes(v.status)&&Array.isArray(v.customFields)&&v.customFields.length<=30;}
app.post('/api/admin/events',auth,(req,res)=>{const v=req.body||{};if(!validateEvent(v))return bad(res,'活動資料格式不正確');const org=v.organizationId||req.user.organization_id;if(!canManage(req.user,org)||!db.prepare('SELECT id FROM organizations WHERE id=?').get(org))return bad(res,'無權限',403);const id=randomUUID();db.prepare('INSERT INTO events(id,organization_id,title,description,date,location,price,capacity,max_per_registration,status,archived,review_required,custom_fields) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,org,v.title.trim(),v.description||'',v.date||'',v.location||'',v.price,v.capacity,v.maxPerRegistration,v.status,0,v.reviewRequired?1:0,JSON.stringify(v.customFields));db.prepare('UPDATE events SET category=? WHERE id=?').run(validCategory(v.category)?v.category:'體驗',id);db.prepare('UPDATE events SET allow_waitlist=? WHERE id=?').run(v.allowWaitlist?1:0,id);log(req.user,'event.create',id);res.json({id});});
app.put('/api/admin/events/:id',auth,(req,res)=>{const old=eventRow(req.params.id);if(!old)return bad(res,'活動不存在',404);if(!canManage(req.user,old.organization_id))return bad(res,'無權限',403);const v=req.body||{};if(!validateEvent(v))return bad(res,'活動資料格式不正確');const occupied=db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(old.id).n;if(v.capacity<occupied)return bad(res,'名額不可小於已占用名額');db.prepare('UPDATE events SET title=?,description=?,date=?,location=?,price=?,capacity=?,max_per_registration=?,status=?,archived=?,review_required=?,custom_fields=? WHERE id=?').run(v.title.trim(),v.description||'',v.date||'',v.location||'',v.price,v.capacity,v.maxPerRegistration,v.status,v.archived?1:0,v.reviewRequired?1:0,JSON.stringify(v.customFields),old.id);db.prepare('UPDATE events SET category=? WHERE id=?').run(validCategory(v.category)?v.category:old.category,old.id);db.prepare('UPDATE events SET allow_waitlist=? WHERE id=?').run(v.allowWaitlist?1:0,old.id);log(req.user,'event.update',old.id);res.json({ok:true});});
app.post('/api/events/:id/register',throttle,(req,res)=>{const v=req.body||{};const e=eventRow(req.params.id);if(!e||e.archived||e.status!=='open')return bad(res,'活動未開放',404);const name=String(v.name||'').trim(),phone=String(v.phone||'').replace(/[\s()-]/g,''),email=String(v.email||'').trim().toLowerCase();const n=Number(v.participants);if(!name||name.length>60||!/^09\d{8}$/.test(phone)||!/^\S+@\S+\.\S+$/.test(email)||!Number.isInteger(n)||n<1||n>e.max_per_registration||String(v.notes||'').length>1000)return bad(res,'報名資料格式不正確');const fields=JSON.parse(e.custom_fields).filter(f=>f.visible!==false),answers=v.customAnswers||{};if(typeof answers!=='object'||Array.isArray(answers))return bad(res,'自訂欄位格式不正確');for(const f of fields){const value=String(answers[f.id]??'').trim();if((f.required&&!value)||value.length>500||(f.type==='select'&&value&&!f.options?.includes(value))||(f.type==='number'&&value&&!Number.isFinite(Number(value)))||(f.type==='date'&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(value)))return bad(res,'自訂欄位驗證失敗：'+f.label);}
try{db.exec('BEGIN IMMEDIATE');const dup=db.prepare("SELECT id FROM registrations WHERE event_id=? AND status IN ('confirmed','pending','waitlisted') AND (phone=? OR email=?)").get(e.id,phone,email);const occupied=db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(e.id).n;if(dup){db.exec('ROLLBACK');return bad(res,'手機或 Email 已報名',409);}const full=occupied+n>e.capacity;if(full&&!e.allow_waitlist){db.exec('ROLLBACK');return bad(res,'剩餘名額不足',409);}const id=randomUUID(),status=full?'waitlisted':e.review_required?'pending':'confirmed';const code=randomBytes(12).toString('hex');db.prepare('INSERT INTO registrations(id,event_id,name,phone,email,participants,notes,status,custom_answers,field_snapshot,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,e.id,name,phone,email,n,String(v.notes||''),status,JSON.stringify(answers),JSON.stringify(fields),new Date().toISOString());db.prepare('UPDATE registrations SET lookup_code=? WHERE id=?').run(code,id);db.exec('COMMIT');queueMail(id,'registered');res.json({id,status,lookupCode:code});}catch(err){try{db.exec('ROLLBACK');}catch{}return bad(res,'報名失敗',500);}});
app.post('/api/registrations/lookup',throttle,(req,res)=>{const id=String(req.body?.id||''),code=String(req.body?.code||'');const r=db.prepare('SELECT id,event_id,status,participants,created_at FROM registrations WHERE id=? AND lookup_code=? AND lookup_code<>?').get(id,code,'');if(!r)return bad(res,'查無資料或查詢碼錯誤',404);const e=eventRow(r.event_id);res.setHeader('Cache-Control','no-store');res.json({id:r.id,eventId:r.event_id,title:e.title,date:e.date,location:e.location,status:r.status,participants:r.participants,createdAt:r.created_at,ticket:r.status==='confirmed'&&!e.archived&&!['draft','cancelled'].includes(e.status)?ticketFor(r):null});});
app.get('/api/admin/events/:id/registrations',auth,(req,res)=>{const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canView(req.user,e.organization_id))return bad(res,'無權限',403);res.json(db.prepare('SELECT * FROM registrations WHERE event_id=? ORDER BY created_at DESC').all(e.id).map(regJSON));});
app.post('/api/admin/registrations/:id/review',auth,(req,res)=>{const r=db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);if(!r)return bad(res,'報名不存在',404);const e=eventRow(r.event_id);if(!canView(req.user,e.organization_id))return bad(res,'無權限',403);const status=req.body?.status;if(!['confirmed','rejected','cancelled'].includes(status)||!['pending','confirmed'].includes(r.status)||r.status==='confirmed'&&status!=='cancelled')return bad(res,'不允許的狀態轉換');db.prepare('UPDATE registrations SET status=?,review_note=?,reviewed_at=? WHERE id=?').run(status,String(req.body.note||'').slice(0,500),new Date().toISOString(),r.id);queueMail(r.id,status);log(req.user,'registration.review',r.id+':'+status);res.json({ok:true});});
app.get('/api/admin/events/:id/registrations.csv',auth,(req,res)=>{const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canView(req.user,e.organization_id))return bad(res,'無權限',403);const rows=db.prepare('SELECT * FROM registrations WHERE event_id=? ORDER BY created_at DESC').all(e.id);const lines=[['編號','姓名','手機','Email','人數','狀態','備註','建立時間'],...rows.map(r=>[r.id,r.name,r.phone,r.email,r.participants,r.status,r.notes,r.created_at])];reportCSV(res,'registrations',lines);});
app.post('/api/admin/events/:id/reviews/batch',auth,(req,res)=>{const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canView(req.user,e.organization_id))return bad(res,'無權限',403);const ids=req.body?.ids,status=req.body?.status;if(!Array.isArray(ids)||ids.length>100||!['confirmed','rejected'].includes(status))return bad(res,'批次資料不正確');const run=db.transaction?null:null;let updated=0;db.exec('BEGIN IMMEDIATE');try{for(const id of new Set(ids)){const r=db.prepare('SELECT * FROM registrations WHERE id=? AND event_id=?').get(id,e.id);if(!r||r.status!=='pending')continue;db.prepare('UPDATE registrations SET status=?,reviewed_at=? WHERE id=?').run(status,new Date().toISOString(),id);updated++;}db.exec('COMMIT');for(const id of new Set(ids)){const r=db.prepare('SELECT status FROM registrations WHERE id=? AND event_id=?').get(id,e.id);if(r?.status===status)queueMail(id,status);}}catch(err){db.exec('ROLLBACK');return bad(res,'批次審核失敗',500);}log(req.user,'registration.batch',e.id+':'+updated);res.json({updated});});
app.get('/api/admin/backup',auth,(req,res)=>{if(req.user.role!=='owner')return bad(res,'無權限',403);const data={format:'EventFlow',version:14,appVersion:'2.6.0',tickets:db.prepare('SELECT * FROM tickets').all(),checkins:db.prepare('SELECT * FROM checkins').all(),events:db.prepare('SELECT * FROM events').all().map(eventJSON),registrations:db.prepare('SELECT * FROM registrations').all().map(regJSON),organizations:db.prepare('SELECT * FROM organizations').all()};res.setHeader('Content-Disposition','attachment; filename="eventflow-v25-backup.json"');res.json(data);});
app.post('/api/admin/import-v13',auth,(req,res)=>{if(req.user.role!=='owner')return bad(res,'無權限',403);const d=req.body;if(!d||d.format!=='EventFlow'||d.version!==13||!Array.isArray(d.events)||!Array.isArray(d.registrations)||!Array.isArray(d.organizations)||d.events.length>1000||d.registrations.length>10000)return bad(res,'僅支援有效 V1.3 備份');let counts={organizations:0,events:0,registrations:0};try{db.exec('BEGIN IMMEDIATE');for(const o of d.organizations){if(typeof o.id!=='string'||typeof o.name!=='string')throw Error('組織格式不正確');const r=db.prepare('INSERT OR IGNORE INTO organizations(id,name,email,phone) VALUES(?,?,?,?)').run(o.id,o.name,o.email||'',o.phone||'');counts.organizations+=Number(r.changes);}for(const e of d.events){if(!e.id||!e.title||!Number.isInteger(Number(e.capacity))||Number(e.capacity)<1)throw Error('活動格式不正確');const org=e.organizationId||'org-default';db.prepare('INSERT OR IGNORE INTO organizations(id,name) VALUES(?,?)').run(org,'匯入主辦單位');const r=db.prepare('INSERT OR IGNORE INTO events(id,organization_id,title,description,date,location,price,capacity,max_per_registration,status,archived,review_required,custom_fields) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(e.id,org,e.title,e.description||'',e.date||'',e.location||'',Number(e.price)||0,Number(e.capacity),Number(e.maxPerRegistration)||4,e.status||'open',e.archived?1:0,e.reviewRequired?1:0,JSON.stringify(e.customFields||[]));counts.events+=Number(r.changes);}for(const r of d.registrations){if(!r.id||!r.eventId||!['confirmed','pending','rejected','cancelled'].includes(r.status))throw Error('報名格式不正確');if(!eventRow(r.eventId))continue;const event=eventRow(r.eventId);const snapshot=r.fieldSnapshot||JSON.parse(event.custom_fields);const result=db.prepare('INSERT OR IGNORE INTO registrations(id,event_id,name,phone,email,participants,notes,status,custom_answers,field_snapshot,created_at,review_note,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(r.id,r.eventId,r.name||'',r.phone||'',r.email||'',Number(r.participants)||1,r.notes||'',r.status,JSON.stringify(r.customAnswers||{}),JSON.stringify(snapshot),r.createdAt||new Date().toISOString(),r.reviewNote||'',r.reviewedAt||null);counts.registrations+=Number(result.changes);}db.exec('COMMIT');log(req.user,'import.v13',JSON.stringify(counts));res.json(counts);}catch(err){try{db.exec('ROLLBACK');}catch{}bad(res,err.message);}});
// V1.6: opt-in demo content, accessible only to an authenticated owner/admin.
app.post('/api/admin/demo-seed',auth,(req,res)=>{
  const org=req.user.organization_id;
  if(!canManage(req.user,org))return bad(res,'無權限',403);
  const samples=[
    ['京都秋日文化散策','旅遊','走訪古都街道、寺院與特色小店，感受京都的季節風景。','2026-12-05','京都・日本',36,2],
    ['AI 應用實務講座','講座','從生活與工作情境出發，現場體驗 AI 工具與實作方法。','2026-11-14','台北市',120,1],
    ['森林探索週末營','營隊','透過自然觀察、團隊挑戰與戶外活動，留下難忘的週末回憶。','2026-11-21','新北市',40,4],
    ['手作陶藝體驗日','體驗','從捏塑到創作，打造一件專屬自己的陶藝作品。','2026-11-28','台北市',24,2],
    ['城市攝影散步','體驗','跟著攝影導師探索城市角落，練習用鏡頭記錄日常。','2026-12-12','台中市',30,2],
    ['親子星空探索夜','營隊','一起認識星座與夜空，透過互動活動體驗天文的樂趣。','2026-12-19','桃園市',60,4]
  ];
  let created=0;
  const insert=db.prepare('INSERT INTO events(id,organization_id,title,description,date,location,price,capacity,max_per_registration,status,archived,review_required,custom_fields) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const [title,category,description,date,location,capacity,max] of samples){
    if(db.prepare('SELECT id FROM events WHERE organization_id=? AND title=?').get(org,title))continue;
    insert.run(randomUUID(),org,title,description,date,location,0,capacity,max,'open',0,0,JSON.stringify([{id:'demo_category',label:'活動類型',type:'select',visible:false,required:false,options:[category]}]));created++;
  }
  for(const [i,[title,category]] of samples.entries()){const image=['kyoto','ai','camp','pottery','city','stars'][i];db.prepare('UPDATE events SET category=?,cover_url=COALESCE(NULLIF(cover_url, ?),?) WHERE organization_id=? AND title=?').run(category,'','/demo/'+image+'.svg',org,title);}log(req.user,'demo.seed',String(created));res.json({created});
});
// V2.2: compact event-level statistics, restricted to authorized staff.
app.get('/api/admin/stats',auth,(req,res)=>{
 const events=req.user.role==='owner'?db.prepare('SELECT id,title,capacity,status,archived FROM events').all():db.prepare('SELECT id,title,capacity,status,archived FROM events WHERE organization_id=?').all(req.user.organization_id);
 const stmt=db.prepare("SELECT status,COUNT(*) count,COALESCE(SUM(participants),0) people FROM registrations WHERE event_id=? GROUP BY status");
 res.json(events.map(e=>{const counts={confirmed:0,pending:0,rejected:0,cancelled:0};const people={...counts};for(const r of stmt.all(e.id)){counts[r.status]=r.count;people[r.status]=r.people;}return {...e,counts,people,occupied:people.confirmed+people.pending,remaining:Math.max(0,e.capacity-people.confirmed-people.pending)};}));
});
// V2.2: owner-only recent audit trail, never exposed to public visitors.
app.get('/api/admin/audit',auth,(req,res)=>{if(req.user.role!=='owner')return bad(res,'無權限',403);res.json(db.prepare('SELECT at,action,detail FROM audit ORDER BY id DESC LIMIT 60').all());});
app.get('/api/admin/notifications',auth,(req,res)=>{const rows=req.user.role==='owner'?db.prepare('SELECT n.id,n.kind,n.email,n.subject,n.status,n.attempts,n.last_error,n.created_at,n.sent_at FROM notifications n ORDER BY n.created_at DESC LIMIT 200').all():db.prepare('SELECT n.id,n.kind,n.email,n.subject,n.status,n.attempts,n.last_error,n.created_at,n.sent_at FROM notifications n JOIN registrations r ON r.id=n.registration_id JOIN events e ON e.id=r.event_id WHERE e.organization_id=? ORDER BY n.created_at DESC LIMIT 200').all(req.user.organization_id);res.json({mode:mailEnabled?'smtp':'preview',rows});});
app.post('/api/admin/notifications/:id/retry',auth,(req,res)=>{const row=db.prepare('SELECT n.id,e.organization_id FROM notifications n JOIN registrations r ON r.id=n.registration_id JOIN events e ON e.id=r.event_id WHERE n.id=?').get(req.params.id);if(!row||!canManage(req.user,row.organization_id))return bad(res,'無權限',403);db.prepare("UPDATE notifications SET status='queued',attempts=0,next_attempt_at=0,last_error='' WHERE id=?").run(row.id);res.json({ok:true});});

// QR content has no attendee details or lookup code. It is accepted only by authorized check-in APIs.
app.get('/api/admin/registrations/:id/ticket',auth,async(req,res)=>{
 const r=db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);if(!r)return bad(res,'報名不存在',404);
 const e=eventRow(r.event_id);if(!canView(req.user,e.organization_id))return bad(res,'無權限',403);
 if(r.status!=='confirmed'||e.archived||['draft','cancelled'].includes(e.status))return bad(res,'此報名目前無法使用入場憑證',409);
 try{const ticket=ticketFor(r);res.setHeader('Cache-Control','no-store');res.json({...ticket,qr:await QRCode.toDataURL(ticket.payload,{errorCorrectionLevel:'M',margin:4,width:320}),title:e.title,id:r.id});}catch{return bad(res,'憑證產生失敗',500);}
});
app.post('/api/registrations/ticket',throttle,async(req,res)=>{
 const r=db.prepare('SELECT * FROM registrations WHERE id=? AND lookup_code=? AND lookup_code<>?').get(String(req.body?.id||''),String(req.body?.code||''),'');
 if(!r)return bad(res,'查無資料或查詢碼錯誤',404);
 const e=eventRow(r.event_id);if(r.status!=='confirmed'||e.archived||['draft','cancelled'].includes(e.status))return bad(res,'此報名目前無法使用入場憑證',409);
 try{const ticket=ticketFor(r);res.setHeader('Cache-Control','no-store');res.json({...ticket,qr:await QRCode.toDataURL(ticket.payload,{errorCorrectionLevel:'M',margin:4,width:320}),title:e.title,date:e.date,location:e.location,participants:r.participants,id:r.id});}catch{return bad(res,'憑證產生失敗',500);}
});
app.post('/api/admin/events/:id/checkins',auth,(req,res)=>{
 const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canView(req.user,e.organization_id))return bad(res,'無權限',403);
 const payload=String(req.body?.payload||'').trim();if(!/^EF25:[a-f0-9]{64}$/.test(payload))return bad(res,'無效的 EventFlow 憑證');
 if(!['camera','manual','image'].includes(req.body?.method))return bad(res,'簽到方式不正確');
 try{db.exec('BEGIN IMMEDIATE');
 const r=db.prepare('SELECT r.* FROM tickets t JOIN registrations r ON r.id=t.registration_id WHERE t.token=?').get(payload.slice(5));
 const fail=(message,code)=>{db.exec('ROLLBACK');return bad(res,message,code);};
 if(!r||r.event_id!==e.id)return fail('憑證不屬於此活動或不存在',404);
 if(r.status!=='confirmed'||e.archived||e.status==='cancelled'||e.status==='draft')return fail('報名未確認、已取消，或活動無法簽到',409);
 const existing=db.prepare('SELECT checkin_time FROM checkins WHERE registration_id=?').get(r.id);
 if(existing)return fail('此憑證已核銷：'+existing.checkin_time,409);
 const at=new Date().toISOString();db.prepare('INSERT INTO checkins VALUES(?,?,?,?,?)').run(randomUUID(),r.id,at,req.body.method,req.user.id);
 log(req.user,'registration.checkin',r.id);db.exec('COMMIT');res.json({ok:true,name:r.name,participants:r.participants,checkinTime:at});
 }catch{try{db.exec('ROLLBACK');}catch{}return bad(res,'簽到失敗，請重新查詢紀錄後再試',500);}
});
app.get('/api/admin/events/:id/checkins',auth,(req,res)=>{
 const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canView(req.user,e.organization_id))return bad(res,'無權限',403);
 const rows=db.prepare('SELECT c.id,c.registration_id,c.checkin_time,c.method,u.email operator,r.name,r.participants,r.status FROM checkins c JOIN registrations r ON r.id=c.registration_id JOIN users u ON u.id=c.operator_id WHERE r.event_id=? ORDER BY c.checkin_time DESC').all(e.id);
 res.setHeader('Cache-Control','no-store');res.json({rows,registrations:rows.length,people:rows.reduce((n,r)=>n+r.participants,0)});
});
app.get('/vendor/jsQR.js',(req,res)=>res.sendFile(path.join(root,'node_modules','jsqr','dist','jsQR.js')));


// V2.6 reports use registration creation dates (Asia/Taipei); attendance is for that cohort.
function reportData(req){
 const q=req.query, valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 if((q.from&&!valid(q.from))||(q.to&&!valid(q.to))||(q.from&&q.to&&q.from>q.to))throw Error('日期範圍不正確');
 let events=(req.user.role==='owner'?db.prepare('SELECT * FROM events').all():db.prepare('SELECT * FROM events WHERE organization_id=?').all(req.user.organization_id));
 if(q.eventId){if(!events.some(e=>e.id===q.eventId))throw Error('活動不存在或無權限');events=events.filter(e=>e.id===q.eventId);}
 const registrations=[],checkins=[],trend=new Map();
 const comparison=events.map(e=>{
  const rows=db.prepare(`SELECT r.*,c.checkin_time,c.method,u.email operator FROM registrations r LEFT JOIN checkins c ON c.registration_id=r.id LEFT JOIN users u ON u.id=c.operator_id WHERE r.event_id=? ORDER BY r.created_at,r.id`).all(e.id).filter(r=>{const day=new Date(Date.parse(r.created_at)+8*3600000).toISOString().slice(0,10);return (!q.from||day>=q.from)&&(!q.to||day<=q.to);});
  const x={id:e.id,title:e.title,date:e.date,status:e.status,archived:!!e.archived,capacity:e.capacity,registrations:rows.length,people:0,confirmed:0,pending:0,waitlisted:0,rejected:0,cancelled:0,checkedIn:0,attendanceRate:null};
  for(const r of rows){x.people+=r.participants;if(r.status in x)x[r.status]+=r.participants;const v={...r,title:e.title};registrations.push(v);if(r.checkin_time){checkins.push(v);if(r.status==='confirmed')x.checkedIn+=r.participants;}const day=new Date(Date.parse(r.created_at)+8*3600000).toISOString().slice(0,10);const t=trend.get(day)||{day,registrations:0,people:0};t.registrations++;t.people+=r.participants;trend.set(day,t);}
  x.attendanceRate=x.confirmed?Math.round(x.checkedIn/x.confirmed*1000)/10:null;return x;
 });
 const totals={events:comparison.length,registrations:0,people:0,confirmed:0,pending:0,waitlisted:0,rejected:0,cancelled:0,checkedIn:0};for(const e of comparison)for(const k of Object.keys(totals))if(k!=='events')totals[k]+=e[k];totals.attendanceRate=totals.confirmed?Math.round(totals.checkedIn/totals.confirmed*1000)/10:null;
 return {totals,comparison,trend:[...trend.values()].sort((a,b)=>a.day.localeCompare(b.day)),registrations,checkins};
}
function reportCSV(res,name,rows){const cell=v=>'"'+String(v??'').replace(/^[\s\u0000-\u001f]*[=+@-]/,m=>"'"+m).replaceAll('"','""')+'"';res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="eventflow-${name}.csv"`,'Cache-Control':'no-store'});res.send('\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n'));}
app.get('/api/admin/reports',auth,(req,res)=>{try{const {totals,comparison,trend}=reportData(req);res.set('Cache-Control','no-store').json({totals,comparison,trend});}catch(e){bad(res,e.message);}});
app.get('/api/admin/reports/:kind.csv',auth,(req,res)=>{try{
 const d=reportData(req),kind=req.params.kind;let rows;
 if(kind==='events')rows=[['活動編號','活動','日期','狀態','已封存','容量','報名筆數','報名人數','已確認人數','待審核人數','候補人數','拒絕人數','取消人數','已確認出席人數','出席率%'],...d.comparison.map(e=>[e.id,e.title,e.date,e.status,e.archived,e.capacity,e.registrations,e.people,e.confirmed,e.pending,e.waitlisted,e.rejected,e.cancelled,e.checkedIn,e.attendanceRate])];
 else if(kind==='registrations')rows=[['報名編號','活動編號','活動','姓名','手機','Email','人數','狀態','備註','自訂欄位快照','自訂答案','審核備註','報名時間','審核時間','簽到時間'],...d.registrations.map(r=>[r.id,r.event_id,r.title,r.name,r.phone,r.email,r.participants,r.status,r.notes,r.field_snapshot,r.custom_answers,r.review_note,r.created_at,r.reviewed_at,r.checkin_time])];
 else if(kind==='checkins')rows=[['報名編號','活動編號','活動','姓名','人數','目前狀態','簽到時間','方式','操作人員'],...d.checkins.map(r=>[r.id,r.event_id,r.title,r.name,r.participants,r.status,r.checkin_time,r.method,r.operator])];
 else return bad(res,'未知的報表',404);reportCSV(res,kind,rows);
 }catch(e){bad(res,e.message);}});

app.get('/api/health',(req,res)=>res.json({ok:true,version:'2.6.0'}));
app.use(express.static(path.join(root,'public'),{dotfiles:'deny'}));
app.get('/',(req,res)=>res.sendFile(path.join(root,'public','index.html')));
const PORT=Number(process.env.PORT)||3000;
const HOST=process.env.HOST||'0.0.0.0';
app.listen(PORT,HOST,()=>console.log(`EventFlow V2.5 running on ${HOST}:${PORT} | Local: http://localhost:${PORT}`));

