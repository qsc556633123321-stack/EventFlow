import {validateAnswers} from './form-schema.js';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {date} from './validation.js';
export function createWaitlist(db,queueMail,log){return function promoteWaitlist(eventId,actor=null,requestId=''){
 const e=db.prepare('SELECT * FROM events WHERE id=?').get(eventId);if(!e||!e.allow_waitlist||!e.auto_waitlist||e.archived||e.status!=='open')return [];
 let free=e.capacity-db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(e.id).n;const promoted=[];
 const rows=db.prepare("SELECT * FROM registrations WHERE event_id=? AND status='waitlisted' ORDER BY created_at,rowid").all(e.id);
 for(const r of rows){if(r.participants>free)break;const status=e.review_required?'pending':'confirmed';db.prepare("UPDATE registrations SET status=?,reviewed_at=? WHERE id=? AND status='waitlisted'").run(status,new Date().toISOString(),r.id);free-=r.participants;queueMail(r.id,'waitlist_promoted');log(actor,'waitlist.promote',r.id+':'+status,e.organization_id,{requestId});promoted.push(r.id);}return promoted;
};}
export function registerReviews(app,{db,auth,policy,log,bad,queueMail,promoteWaitlist,throttle,memberPlatform}){
 app.post('/api/events/:id/register',throttle,(req,res)=>{
 const v=req.body||{},rawKey=req.get('Idempotency-Key'),member=memberPlatform?.optional(req);
 if(member&&!member.verified)return bad(res,'請先驗證會員 Email，再以會員身分報名',403);
 if(member&&req.get('X-CSRF-Token')!==member.csrfToken)return bad(res,'會員安全驗證已失效，請重新載入',403);
 if(rawKey!==undefined&&!/^[a-f0-9]{32,64}$/i.test(rawKey))return bad(res,'報名重送識別碼格式不正確');
 const name=String(v.name||'').trim(),phone=String(v.phone||'').replace(/[\s()-]/g,''),address=String(v.email||'').trim().toLowerCase(),n=v.participants,answers=v.customAnswers||{},notes=v.notes||'';
 if(!name||!/^09\d{8}$/.test(phone)||!Number.isSafeInteger(n)||n<1||n>100)return bad(res,'報名資料格式不正確');
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const canonical=JSON.stringify({name,phone,email:address,participants:n,notes,customAnswers:Object.keys(answers).sort().map(key=>[key,Array.isArray(answers[key])?answers[key].map(String):typeof answers[key]==='boolean'?answers[key]:String(answers[key])])});
 const keyHash=rawKey===undefined?null:digest(rawKey.toLowerCase()),requestHash=digest(canonical);
 const failure=(message,status=400)=>Object.assign(Error(message),{status,publicMessage:message});let begun=false;
 try{db.exec('BEGIN IMMEDIATE');begun=true;
  if(keyHash){const existing=db.prepare('SELECT * FROM registration_requests WHERE key_hash=?').get(keyHash);if(existing){
   if(existing.event_id!==req.params.id||existing.request_hash!==requestHash)throw failure('此重送識別碼已用於其他報名內容，請重新確認資料',409);
   if(existing.expires_at<=Date.now())throw failure('報名重送期限已過，請使用已保存的編號與查詢碼查詢，勿重複建立報名',409);
   const prior=db.prepare('SELECT id,status,lookup_code,member_user_id FROM registrations WHERE id=? AND event_id=?').get(existing.registration_id,existing.event_id);if(!prior)throw failure('找不到原報名結果，請聯絡主辦單位',409);if(prior.member_user_id&&prior.member_user_id!==member?.id)throw failure('請登入原報名會員以恢復結果',403);
   db.exec('COMMIT');begun=false;return res.json({id:prior.id,status:prior.status,lookupCode:prior.lookup_code});
  }}
  const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e||e.archived||e.status!=='open')throw failure('活動未開放',404);
  if(e.member_required&&!member)throw failure('此活動必須登入並驗證會員才能報名',401);
  if(n>e.max_per_registration)throw failure('報名人數超過每筆上限');
  const fields=JSON.parse(e.custom_fields).filter(f=>f.visible!==false);
  if(Object.keys(answers).some(k=>!fields.some(f=>f.id===k)))throw failure('包含未定義的報名欄位');
  const answerError=validateAnswers(fields,answers);if(answerError)throw failure(answerError);
  if(db.prepare("SELECT id FROM registrations WHERE event_id=? AND status IN ('confirmed','pending','waitlisted') AND (phone=? OR email=?)").get(e.id,phone,address))throw failure('手機或 Email 已報名',409);
  const occupied=db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(e.id).n;
  const queued=e.allow_waitlist&&e.auto_waitlist&&db.prepare("SELECT id FROM registrations WHERE event_id=? AND status='waitlisted' LIMIT 1").get(e.id);
  const full=occupied+n>e.capacity;if(full&&!e.allow_waitlist)throw failure('剩餘名額不足',409);
  const id=randomUUID(),code=randomBytes(12).toString('hex'),status=full||queued?'waitlisted':e.review_required?'pending':'confirmed',now=new Date().toISOString();
  db.prepare('INSERT INTO registrations(id,event_id,name,phone,email,participants,notes,status,custom_answers,field_snapshot,created_at,lookup_code,member_user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,e.id,name,phone,address,n,notes,status,JSON.stringify(answers),JSON.stringify(fields),now,code,member?.id||null);
  if(keyHash)db.prepare('INSERT INTO registration_requests(key_hash,event_id,request_hash,registration_id,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(keyHash,e.id,requestHash,id,now,Date.now()+24*3600000);
  promoteWaitlist(e.id,null,req.requestId);queueMail(id,'registered');log(null,'registration.create',id,e.organization_id,{requestId:req.requestId});const actual=db.prepare('SELECT status FROM registrations WHERE id=?').get(id).status;
  db.exec('COMMIT');begun=false;res.json({id,status:actual,lookupCode:code});
 }catch(err){if(begun)db.exec('ROLLBACK');bad(res,err.publicMessage||'報名失敗，請保留資料後重試',err.status||500);}
 });
 const event=id=>db.prepare('SELECT * FROM events WHERE id=?').get(id);
 function review(req,res,batch){
  const body=req.body||{};
  const first=batch?null:db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  const e=event(batch?req.params.id:first?.event_id||'');
  if(!e||!batch&&!first)return bad(res,'活動或報名不存在',404);
  if(!policy.canOperate(req.user,e,'review'))return bad(res,'無權限',403);
  if(!['confirmed','rejected',...(batch?[]:['cancelled'])].includes(body.status))return bad(res,'不允許的狀態轉換');
  if(batch&&(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>100))return bad(res,'批次資料不正確');
  const ids=batch?[...new Set(body.ids)]:[first.id];
  let begun=false;
  try{
   db.exec('BEGIN IMMEDIATE');begun=true;let updated=0;
   for(const id of ids){
    const r=db.prepare('SELECT * FROM registrations WHERE id=? AND event_id=?').get(id,e.id);
    const allowed=r&&(batch?r.status==='pending':r.status==='pending'||r.status==='waitlisted'||r.status==='confirmed'&&body.status==='cancelled');
    if(!allowed){if(batch)continue;throw Object.assign(Error(),{status:400});}
    if(body.status==='confirmed'){
     const occupied=db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND id<>? AND status IN ('confirmed','pending')").get(e.id,r.id).n;
     if(e.archived||['draft','cancelled'].includes(e.status)||occupied+r.participants>e.capacity)throw Object.assign(Error(),{status:409});
    }
    db.prepare('UPDATE registrations SET status=?,review_note=?,reviewed_at=? WHERE id=?').run(body.status,body.note||'',new Date().toISOString(),r.id);
    queueMail(r.id,body.status);log(req.user,body.status==='cancelled'?'registration.cancel':'registration.review',r.id+':'+body.status,e.organization_id,{requestId:req.requestId});updated++;
   }
   promoteWaitlist(e.id,req.user,req.requestId);if(batch)log(req.user,'registration.batch',e.id+':'+updated,e.organization_id,{requestId:req.requestId});
   db.exec('COMMIT');begun=false;res.json(batch?{updated}:{ok:true});
  }catch(err){if(begun)db.exec('ROLLBACK');bad(res,err.status===400?'不允許的狀態轉換':err.status===409?'活動狀態或剩餘名額不允許確認':'審核失敗',err.status||500);}
 }
 app.post('/api/admin/registrations/:id/review',auth,(req,res)=>review(req,res,false));
 app.post('/api/admin/events/:id/reviews/batch',auth,(req,res)=>review(req,res,true));
}
