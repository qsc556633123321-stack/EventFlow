import express from 'express';
import QRCode from 'qrcode';
import {openDatabase} from './modules/database.js';
import {createPolicy} from './modules/policy.js';
import {createAudit} from './modules/audit.js';
import {createSecurity,installSecurity,apiErrors,csrfFor,cookieToken,sessionCookie} from './modules/security.js';
import {validateEvent,routeValidation,date as validDate,fieldsValid,record,identifier,text as validText} from './modules/validation.js';
import {createWaitlist,registerReviews} from './modules/registrations.js';
import {registerAccounts} from './modules/accounts.js';
import {createMaintenance,registerMaintenance} from './modules/maintenance.js';
import {registerMembers} from './modules/members.js';
import {registerEventArchive} from './modules/events.js';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import {createMailer} from './modules/mail.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.EVENTFLOW_DATA_DIR||path.join(root,'data');
fs.mkdirSync(dataDir,{recursive:true});
const db=await openDatabase(dataDir);
function ticketFor(r){
 let t=db.prepare('SELECT token FROM tickets WHERE registration_id=?').get(r.id);
 if(!t){db.prepare('INSERT INTO tickets VALUES(?,?,?)').run(r.id,randomBytes(32).toString('hex'),new Date().toISOString());t=db.prepare('SELECT token FROM tickets WHERE registration_id=?').get(r.id);}
 return {payload:'EF25:'+t.token,checkedIn:!!db.prepare('SELECT id FROM checkins WHERE registration_id=?').get(r.id)};
}
const mailer=createMailer(db,{dataDir});const {queueMail,processMail}=mailer;const mailEnabled=mailer.enabled;
setInterval(()=>processMail().catch(()=>console.error('Mail queue processing failed')),30000).unref();
const uploads=process.env.EVENTFLOW_UPLOADS_DIR||path.join(root,'public','uploads');fs.mkdirSync(uploads,{recursive:true});
const publicOrg=o=>({id:o.id,name:o.name,logoUrl:o.logo_url,brandColor:o.brand_color,heroUrl:o.hero_url,tagline:o.tagline});
const validColor=s=>/^#[0-9a-fA-F]{6}$/.test(s);
const validCategory=s=>['旅遊','講座','營隊','體驗'].includes(s);
const app=express();app.disable('x-powered-by');
const audit=createAudit(db);const {log}=audit;
app.use(audit.middleware);installSecurity(app);
app.use('/admin.html',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.use(express.json({limit:'1mb'}));app.use(routeValidation);app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');next();});
const sha=x=>createHash('sha256').update(x).digest('hex');
const hashPass=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const verifyPass=(p,h)=>{try{const [salt,hash]=h.split(':');return timingSafeEqual(scryptSync(p,salt,64),Buffer.from(hash,'hex'));}catch{return false;}};
const bad=(res,msg,code=400)=>res.status(code).json({error:msg});
const policy=createPolicy(db);const {canManage,canView,canOperate,visibleEvents}=policy;
const security=createSecurity(db,{log});security.configurePasswords(verifyPass,hashPass);
const {auth,throttle}=security;
const eventRow=id=>db.prepare('SELECT * FROM events WHERE id=?').get(id);
const eventJSON=e=>({...e,archived:!!e.archived,reviewRequired:!!e.review_required,allowWaitlist:!!e.allow_waitlist,autoWaitlist:!!e.auto_waitlist,customFields:JSON.parse(e.custom_fields),organizationId:e.organization_id,maxPerRegistration:e.max_per_registration,coverUrl:e.cover_url,category:e.category});
const regJSON=r=>({...r,eventId:r.event_id,participants:r.participants,customAnswers:JSON.parse(r.custom_answers),fieldSnapshot:JSON.parse(r.field_snapshot),createdAt:r.created_at,reviewNote:r.review_note});
app.post('/api/setup',throttle,(req,res)=>{
 // Initial owner creation is local-only unless explicitly opted in for classroom deployment.
 const remote=req.socket.remoteAddress||'';
 const localHost=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.get('host')||'');const forwarded=!!(req.get('x-forwarded-for')||req.get('cf-connecting-ip')||req.get('forwarded')||req.get('x-forwarded-proto'));if((!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)||!localHost||forwarded) && process.env.ALLOW_REMOTE_SETUP!=='1')return bad(res,'請在伺服器本機完成初始管理員設定',403);
if(db.prepare('SELECT count(*) n FROM users').get().n)return bad(res,'系統已初始化',403);const {email,password}=req.body||{};if(!/^\S+@\S+\.\S+$/.test(email||'')||typeof password!=='string'||password.length<12)return bad(res,'請使用有效 Email 與至少 12 字元密碼');const org='org-default';db.prepare('INSERT OR IGNORE INTO organizations(id,name) VALUES(?,?)').run(org,'預設主辦單位');db.prepare('INSERT INTO users(id,email,passhash,role,organization_id) VALUES(?,?,?,?,?)').run(randomUUID(),email.toLowerCase(),hashPass(password),'owner',org);log(null,'setup','initial owner');res.json({ok:true});});
app.post('/api/login',throttle,security.login);
app.post('/api/logout',auth,(req,res)=>{log(req.user,'auth.logout','session revoked');db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(cookieToken(req)));res.setHeader('Set-Cookie',sessionCookie(req,'',true));res.json({ok:true});});
app.post('/api/admin/context',auth,(req,res)=>{
 if(req.user.role!=='owner')return bad(res,'無權限',403);
 const id=req.body?.organizationId||null;
 if(id&&!db.prepare('SELECT id FROM organizations WHERE id=?').get(id))return bad(res,'組織不存在',404);
 db.prepare('UPDATE sessions SET organization_id=? WHERE token_hash=?').run(id,sha(cookieToken(req)));log(req.user,'context.switch',id||'all',id);res.json({ok:true});
});
app.put('/api/organizations/:id',auth,(req,res)=>{
 if(!canManage(req.user,req.params.id))return bad(res,'無權限',403);
 const name=String(req.body?.name||'').trim(),email=String(req.body?.email||''),phone=String(req.body?.phone||'');
 if(!name||name.length>100||email.length>200||phone.length>60)return bad(res,'組織資料不正確');
 if(!db.prepare('SELECT id FROM organizations WHERE id=?').get(req.params.id))return bad(res,'組織不存在',404);
 db.prepare('UPDATE organizations SET name=?,email=?,phone=? WHERE id=?').run(name,email,phone,req.params.id);log(req.user,'organization.update',req.params.id);res.json({ok:true});
});
const promoteWaitlist=createWaitlist(db,queueMail,log);
registerReviews(app,{db,auth,policy,log,bad,queueMail,promoteWaitlist,throttle});
registerAccounts(app,{db,auth,policy,log,bad,hashPass,mailer,throttle});
const configuredBackup=path.resolve(process.env.BACKUP_DIR||path.join(dataDir,'backups'));const publishedRoot=fs.realpathSync(path.join(root,'public'));fs.mkdirSync(configuredBackup,{recursive:true});const resolvedBackup=fs.realpathSync(configuredBackup);if([publishedRoot,fs.realpathSync(uploads)].some(p=>resolvedBackup===p||resolvedBackup.startsWith(p+path.sep)))throw Error('BACKUP_DIR must be outside the public directory');
const maintenance=createMaintenance({db,dataDir,uploadsDir:uploads,log});
registerMaintenance(app,{db,auth,bad,maintenance,mailer});
setInterval(()=>maintenance.runDue().catch(()=>console.error('Scheduled maintenance failed')),60000).unref();
registerMembers(app,{db,auth,policy,log,hashPass,bad});
registerEventArchive(app,{db,auth,policy,log,bad});
app.get('/api/me',auth,(req,res)=>res.json({...req.user,csrfToken:csrfFor(cookieToken(req))}));
app.get('/api/events',(req,res)=>res.json(db.prepare("SELECT * FROM events WHERE archived=0 AND status='open'").all().map(e=>({id:e.id,title:e.title,date:e.date,location:e.location,capacity:e.capacity,coverUrl:e.cover_url,category:e.category,price:e.price,description:e.description,status:e.status,allowWaitlist:!!e.allow_waitlist,allow_waitlist:!!e.allow_waitlist,maxPerRegistration:e.max_per_registration,remaining:Math.max(0,e.capacity-db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(e.id).n),organizationName:db.prepare('SELECT name FROM organizations WHERE id=?').get(e.organization_id)?.name,organizationId:e.organization_id}))));
app.get('/api/events/:id',(req,res)=>{const e=eventRow(req.params.id);if(!e||e.archived||!['open','closed'].includes(e.status))return bad(res,'找不到活動',404);const occupied=db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(e.id).n;res.json({...eventJSON(e),organizationName:db.prepare('SELECT name FROM organizations WHERE id=?').get(e.organization_id)?.name,remaining:Math.max(0,e.capacity-occupied)});});
app.get('/api/admin/events',auth,(req,res)=>{const rows=visibleEvents(req.user,req.csvExport?'export':'read');res.json(rows.map(e=>({...eventJSON(e),permissions:{manage:canManage(req.user,e.organization_id),review:canOperate(req.user,e,'review'),checkin:canOperate(req.user,e,'checkin'),export:canOperate(req.user,e,'export')}})));});
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
 log(req.user,'image.upload',kind,kind==='cover'?eventRow(eventId).organization_id:req.user.organization_id);res.json({url});
});
app.post('/api/organizations',auth,(req,res)=>{if(req.user.role!=='owner')return bad(res,'無權限',403);const name=String(req.body?.name||'').trim();if(!name||name.length>100)return bad(res,'主辦單位名稱不正確');const id=randomUUID();db.prepare('INSERT INTO organizations(id,name,email,phone) VALUES(?,?,?,?)').run(id,name,String(req.body.email||''),String(req.body.phone||''));log(req.user,'organization.create',id);res.json({id});});
app.post('/api/admin/events',auth,(req,res)=>{const v=req.body||{};if(!validateEvent(v))return bad(res,'活動資料格式不正確');const org=v.organizationId||req.user.organization_id;if(!canManage(req.user,org)||!db.prepare('SELECT id FROM organizations WHERE id=?').get(org))return bad(res,'無權限',403);const id=randomUUID();db.prepare('INSERT INTO events(id,organization_id,title,description,date,location,price,capacity,max_per_registration,status,archived,review_required,custom_fields) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,org,v.title.trim(),v.description||'',v.date||'',v.location||'',v.price,v.capacity,v.maxPerRegistration,v.status,0,v.reviewRequired?1:0,JSON.stringify(v.customFields));db.prepare('UPDATE events SET category=? WHERE id=?').run(validCategory(v.category)?v.category:'體驗',id);db.prepare('UPDATE events SET allow_waitlist=? WHERE id=?').run(v.allowWaitlist?1:0,id);db.prepare('UPDATE events SET auto_waitlist=? WHERE id=?').run(v.autoWaitlist===false?0:1,id);log(req.user,'event.create',id);res.json({id});});
app.put('/api/admin/events/:id',auth,(req,res)=>{
 const old=eventRow(req.params.id);if(!old)return bad(res,'活動不存在',404);if(!canManage(req.user,old.organization_id))return bad(res,'無權限',403);const v=req.body||{};if(!validateEvent(v))return bad(res,'活動資料格式不正確');
 db.exec('BEGIN IMMEDIATE');try{const occupied=db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(old.id).n;if(v.capacity<occupied){db.exec('ROLLBACK');return bad(res,'名額不可小於已占用名額');}
 db.prepare('UPDATE events SET title=?,description=?,date=?,location=?,price=?,capacity=?,max_per_registration=?,status=?,archived=?,review_required=?,custom_fields=?,category=?,allow_waitlist=?,auto_waitlist=? WHERE id=?').run(v.title.trim(),v.description||'',v.date||'',v.location||'',v.price,v.capacity,v.maxPerRegistration,v.status,v.archived?1:0,v.reviewRequired?1:0,JSON.stringify(v.customFields),v.category||old.category,v.allowWaitlist?1:0,v.autoWaitlist===undefined?old.auto_waitlist:v.autoWaitlist?1:0,old.id);
 promoteWaitlist(old.id,req.user,req.requestId);log(req.user,'event.update',old.id);db.exec('COMMIT');res.json({ok:true});}catch{db.exec('ROLLBACK');bad(res,'活動更新失敗',500);}
});
app.post('/api/registrations/lookup',throttle,(req,res)=>{const id=String(req.body?.id||''),code=String(req.body?.code||'');const r=db.prepare('SELECT id,event_id,status,participants,created_at FROM registrations WHERE id=? AND lookup_code=? AND lookup_code<>?').get(id,code,'');if(!r)return bad(res,'查無資料或查詢碼錯誤',404);const e=eventRow(r.event_id);res.setHeader('Cache-Control','no-store');res.json({id:r.id,eventId:r.event_id,title:e.title,date:e.date,location:e.location,status:r.status,participants:r.participants,createdAt:r.created_at,ticket:r.status==='confirmed'&&!e.archived&&!['draft','cancelled'].includes(e.status)?ticketFor(r):null});});
app.get('/api/admin/events/:id/registrations',auth,(req,res)=>{const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canView(req.user,e.organization_id,e.id))return bad(res,'無權限',403);res.json(db.prepare('SELECT * FROM registrations WHERE event_id=? ORDER BY created_at DESC').all(e.id).map(r=>{const value=regJSON(r);delete value.lookup_code;return value}));});
app.get('/api/admin/events/:id/registrations.csv',auth,(req,res)=>{const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canOperate(req.user,e,'export'))return bad(res,'無權限',403);const rows=db.prepare('SELECT * FROM registrations WHERE event_id=? ORDER BY created_at DESC').all(e.id);const lines=[['編號','姓名','手機','Email','人數','狀態','備註','建立時間'],...rows.map(r=>[r.id,r.name,r.phone,r.email,r.participants,r.status,r.notes,r.created_at])];reportCSV(res,'registrations',lines);});
app.get('/api/admin/backup',auth,(req,res)=>{if(req.user.role!=='owner'||req.user.scopeOrganizationId)return bad(res,'無權限',403);const data={format:'EventFlow',version:14,appVersion:'2.9.0',tickets:db.prepare('SELECT * FROM tickets').all(),checkins:db.prepare('SELECT * FROM checkins').all(),events:db.prepare('SELECT * FROM events').all().map(eventJSON),registrations:db.prepare('SELECT * FROM registrations').all().map(regJSON),organizations:db.prepare('SELECT * FROM organizations').all()};res.setHeader('Content-Disposition','attachment; filename="eventflow-v29-backup.json"');res.json(data);});
app.post('/api/admin/import-v13',auth,(req,res)=>{if(req.user.role!=='owner'||req.user.scopeOrganizationId)return bad(res,'無權限',403);const d=req.body;if(!d||d.format!=='EventFlow'||d.version!==13||!Array.isArray(d.events)||!Array.isArray(d.registrations)||!Array.isArray(d.organizations)||d.events.length>1000||d.registrations.length>10000)return bad(res,'僅支援有效 V1.3 備份');let counts={organizations:0,events:0,registrations:0};try{db.exec('BEGIN IMMEDIATE');for(const o of d.organizations){if(typeof o.id!=='string'||typeof o.name!=='string')throw Error('組織格式不正確');const r=db.prepare('INSERT OR IGNORE INTO organizations(id,name,email,phone) VALUES(?,?,?,?)').run(o.id,o.name,o.email||'',o.phone||'');counts.organizations+=Number(r.changes);}for(const e of d.events){if(!e.id||!e.title||!Number.isInteger(Number(e.capacity))||Number(e.capacity)<1)throw Error('活動格式不正確');const org=e.organizationId||'org-default';db.prepare('INSERT OR IGNORE INTO organizations(id,name) VALUES(?,?)').run(org,'匯入主辦單位');const r=db.prepare('INSERT OR IGNORE INTO events(id,organization_id,title,description,date,location,price,capacity,max_per_registration,status,archived,review_required,custom_fields) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(e.id,org,e.title,e.description||'',e.date||'',e.location||'',Number(e.price)||0,Number(e.capacity),Number(e.maxPerRegistration)||4,e.status||'open',e.archived?1:0,e.reviewRequired?1:0,JSON.stringify(e.customFields||[]));counts.events+=Number(r.changes);}for(const r of d.registrations){if(!r.id||!r.eventId||!['confirmed','pending','rejected','cancelled'].includes(r.status))throw Error('報名格式不正確');if(!eventRow(r.eventId))continue;const event=eventRow(r.eventId);const snapshot=r.fieldSnapshot||JSON.parse(event.custom_fields);const result=db.prepare('INSERT OR IGNORE INTO registrations(id,event_id,name,phone,email,participants,notes,status,custom_answers,field_snapshot,created_at,review_note,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(r.id,r.eventId,r.name||'',r.phone||'',r.email||'',Number(r.participants)||1,r.notes||'',r.status,JSON.stringify(r.customAnswers||{}),JSON.stringify(snapshot),r.createdAt||new Date().toISOString(),r.reviewNote||'',r.reviewedAt||null);counts.registrations+=Number(result.changes);}db.exec('COMMIT');log(req.user,'import.v13',JSON.stringify(counts));res.json(counts);}catch(err){try{db.exec('ROLLBACK');}catch{}bad(res,'匯入格式不正確或資料不相容');}});
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
 const events=visibleEvents(req.user);
 const stmt=db.prepare("SELECT status,COUNT(*) count,COALESCE(SUM(participants),0) people FROM registrations WHERE event_id=? GROUP BY status");
 res.json(events.map(e=>{const counts={confirmed:0,pending:0,waitlisted:0,rejected:0,cancelled:0};const people={...counts};for(const r of stmt.all(e.id)){counts[r.status]=r.count;people[r.status]=r.people;}return {...e,counts,people,occupied:people.confirmed+people.pending,remaining:Math.max(0,e.capacity-people.confirmed-people.pending)};}));
});
// V2.2: owner-only recent audit trail, never exposed to public visitors.
app.get('/api/admin/audit',auth,(req,res)=>{
 if(req.user.role==='staff')return bad(res,'無權限',403);
 const all=req.user.role==='owner'&&!req.user.scopeOrganizationId;
 const rows=all?db.prepare('SELECT id,at,user_id,action,detail,organization_id,actor_email,result,target_type,target_id,request_id,status_code FROM audit ORDER BY id DESC LIMIT 200').all():db.prepare('SELECT id,at,user_id,action,detail,organization_id,actor_email,result,target_type,target_id,request_id,status_code FROM audit WHERE organization_id=? ORDER BY id DESC LIMIT 200').all(req.user.organization_id);
 res.json(rows);
});
app.get('/api/admin/notifications',auth,(req,res)=>{const rows=req.user.role==='owner'&&!req.user.scopeOrganizationId?db.prepare('SELECT n.id,n.kind,n.email,n.subject,n.status,n.attempts,n.last_error,n.created_at,n.sent_at,n.message_id,n.delivery_state FROM notifications n ORDER BY n.created_at DESC LIMIT 200').all():db.prepare('SELECT r.event_id,n.id,n.kind,n.email,n.subject,n.status,n.attempts,n.last_error,n.created_at,n.sent_at,n.message_id,n.delivery_state FROM notifications n JOIN registrations r ON r.id=n.registration_id JOIN events e ON e.id=r.event_id WHERE e.organization_id=? ORDER BY n.created_at DESC LIMIT 200').all(req.user.organization_id);res.json({mode:mailEnabled?'smtp':'preview',rows:rows.filter(r=>req.user.role!=='staff'||canOperate(req.user,eventRow(r.event_id),'read'))});});
app.post('/api/admin/notifications/:id/retry',auth,(req,res)=>{const row=db.prepare('SELECT n.id,e.organization_id FROM notifications n JOIN registrations r ON r.id=n.registration_id JOIN events e ON e.id=r.event_id WHERE n.id=?').get(req.params.id);if(!row||!canManage(req.user,row.organization_id))return bad(res,'無權限',403);const state=db.prepare('SELECT status FROM notifications WHERE id=?').get(row.id).status;if(['sent','sending','uncertain'].includes(state))return bad(res,'此通知已寄出、寄送中或結果不確定，禁止自動重寄',409);db.prepare("UPDATE notifications SET status='queued',attempts=0,next_attempt_at=0,last_error='',delivery_state='not_sent' WHERE id=?").run(row.id);log(req.user,'notification.retry',row.id,row.organization_id,{type:'notification',targetId:row.id,requestId:req.requestId});res.json({ok:true});});

// QR content has no attendee details or lookup code. It is accepted only by authorized check-in APIs.
app.get('/api/admin/registrations/:id/ticket',auth,async(req,res)=>{
 const r=db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);if(!r)return bad(res,'報名不存在',404);
 const e=eventRow(r.event_id);if(!canOperate(req.user,e,'checkin'))return bad(res,'無權限',403);
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
 const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canOperate(req.user,e,'checkin'))return bad(res,'無權限',403);
 const payload=String(req.body?.payload||'').trim();if(!/^EF25:[a-f0-9]{64}$/.test(payload))return bad(res,'無效的 EventFlow 憑證');
 if(!['camera','manual','image'].includes(req.body?.method))return bad(res,'簽到方式不正確');
 try{db.exec('BEGIN IMMEDIATE');
 const r=db.prepare('SELECT r.* FROM tickets t JOIN registrations r ON r.id=t.registration_id WHERE t.token=?').get(payload.slice(5));
 const fail=(message,code)=>{db.exec('ROLLBACK');return bad(res,message,code);};
 if(!r||r.event_id!==e.id)return fail('憑證不屬於此活動或不存在',404);
 if(r.status!=='confirmed'||e.archived||e.status==='cancelled'||e.status==='draft')return fail('報名未確認、已取消，或活動無法簽到',409);
 const existing=db.prepare('SELECT checkin_time FROM checkins WHERE registration_id=?').get(r.id);
 if(existing){req.auditAction='registration.checkin_duplicate';return fail('此憑證已核銷：'+existing.checkin_time,409);}
 const at=new Date().toISOString();db.prepare('INSERT INTO checkins VALUES(?,?,?,?,?)').run(randomUUID(),r.id,at,req.body.method,req.user.id);
 log(req.user,'registration.checkin',r.id);db.exec('COMMIT');res.json({ok:true,name:r.name,participants:r.participants,checkinTime:at});
 }catch{try{db.exec('ROLLBACK');}catch{}return bad(res,'簽到失敗，請重新查詢紀錄後再試',500);}
});
app.get('/api/admin/events/:id/checkins',auth,(req,res)=>{
 const e=eventRow(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!canView(req.user,e.organization_id,e.id))return bad(res,'無權限',403);
 const rows=db.prepare('SELECT c.id,c.registration_id,c.checkin_time,c.method,u.email operator,r.name,r.participants,r.status FROM checkins c JOIN registrations r ON r.id=c.registration_id JOIN users u ON u.id=c.operator_id WHERE r.event_id=? ORDER BY c.checkin_time DESC').all(e.id);
 res.setHeader('Cache-Control','no-store');res.json({rows,registrations:rows.length,people:rows.reduce((n,r)=>n+r.participants,0)});
});
app.get('/vendor/jsQR.js',(req,res)=>res.sendFile(path.join(root,'node_modules','jsqr','dist','jsQR.js')));


// V2.6 reports use registration creation dates (Asia/Taipei); attendance is for that cohort.
function reportData(req){
 const q=req.query, valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 if((q.from&&!valid(q.from))||(q.to&&!valid(q.to))||(q.from&&q.to&&q.from>q.to))throw Error('日期範圍不正確');
 let events=(visibleEvents(req.user,req.csvExport?'export':'read'));
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
app.get('/api/admin/reports',auth,(req,res)=>{try{const {totals,comparison,trend}=reportData(req);res.set('Cache-Control','no-store').json({totals,comparison,trend});}catch(e){bad(res,'日期範圍、活動或權限不正確');}});
app.get('/api/admin/reports/:kind.csv',auth,(req,res)=>{try{
 req.csvExport=true;const d=reportData(req),kind=req.params.kind;let rows;
 if(kind==='events')rows=[['活動編號','活動','日期','狀態','已封存','容量','報名筆數','報名人數','已確認人數','待審核人數','候補人數','拒絕人數','取消人數','已確認出席人數','出席率%'],...d.comparison.map(e=>[e.id,e.title,e.date,e.status,e.archived,e.capacity,e.registrations,e.people,e.confirmed,e.pending,e.waitlisted,e.rejected,e.cancelled,e.checkedIn,e.attendanceRate])];
 else if(kind==='registrations')rows=[['報名編號','活動編號','活動','姓名','手機','Email','人數','狀態','備註','自訂欄位快照','自訂答案','審核備註','報名時間','審核時間','簽到時間'],...d.registrations.map(r=>[r.id,r.event_id,r.title,r.name,r.phone,r.email,r.participants,r.status,r.notes,r.field_snapshot,r.custom_answers,r.review_note,r.created_at,r.reviewed_at,r.checkin_time])];
 else if(kind==='checkins')rows=[['報名編號','活動編號','活動','姓名','人數','目前狀態','簽到時間','方式','操作人員'],...d.checkins.map(r=>[r.id,r.event_id,r.title,r.name,r.participants,r.status,r.checkin_time,r.method,r.operator])];
 else return bad(res,'未知的報表',404);reportCSV(res,kind,rows);
 }catch(e){bad(res,e.message);}});

app.get('/api/health',(req,res)=>res.json({ok:true,version:'2.9.0'}));
apiErrors(app);
app.use('/uploads',express.static(uploads,{dotfiles:'deny'}),(req,res)=>res.sendStatus(404));
app.use(express.static(path.join(root,'public'),{dotfiles:'deny'}));
app.get('/',(req,res)=>res.sendFile(path.join(root,'public','index.html')));
const PORT=Number(process.env.PORT??3000);
const HOST=process.env.HOST||'0.0.0.0';
const httpServer=app.listen(PORT,HOST,()=>console.log(`EventFlow V2.9 running on ${HOST}:${httpServer.address().port} | Local: http://localhost:${httpServer.address().port}`));
