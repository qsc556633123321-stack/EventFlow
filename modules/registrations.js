import {randomUUID,randomBytes} from 'node:crypto';
import {date} from './validation.js';
export function createWaitlist(db,queueMail,log){return function promoteWaitlist(eventId,actor=null,requestId=''){
 const e=db.prepare('SELECT * FROM events WHERE id=?').get(eventId);if(!e||!e.allow_waitlist||!e.auto_waitlist||e.archived||e.status!=='open')return [];
 let free=e.capacity-db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(e.id).n;const promoted=[];
 const rows=db.prepare("SELECT * FROM registrations WHERE event_id=? AND status='waitlisted' ORDER BY created_at,rowid").all(e.id);
 for(const r of rows){if(r.participants>free)break;const status=e.review_required?'pending':'confirmed';db.prepare("UPDATE registrations SET status=?,reviewed_at=? WHERE id=? AND status='waitlisted'").run(status,new Date().toISOString(),r.id);free-=r.participants;queueMail(r.id,'waitlist_promoted');log(actor,'waitlist.promote',r.id+':'+status,e.organization_id,{requestId});promoted.push(r.id);}return promoted;
};}
export function registerReviews(app,{db,auth,policy,log,bad,queueMail,promoteWaitlist,throttle}){
 app.post('/api/events/:id/register',throttle,(req,res)=>{
 const v=req.body||{},e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e||e.archived||e.status!=='open')return bad(res,'活動未開放',404);
 const name=String(v.name||'').trim(),phone=String(v.phone||'').replace(/[\s()-]/g,''),email=String(v.email||'').trim().toLowerCase(),n=v.participants;
 if(!name||!/^09\d{8}$/.test(phone)||!Number.isInteger(n)||n<1||n>e.max_per_registration)return bad(res,'報名資料格式不正確');
 const fields=JSON.parse(e.custom_fields).filter(f=>f.visible!==false),answers=v.customAnswers||{};
 if(Object.keys(answers).some(k=>!fields.some(f=>f.id===k)))return bad(res,'包含未定義的報名欄位');
 for(const f of fields){const value=String(answers[f.id]??'').trim();if(f.required&&!value||value.length>500||f.type==='select'&&value&&!f.options?.includes(value)||f.type==='number'&&value&&!Number.isFinite(Number(value))||f.type==='date'&&value&&!date(value))return bad(res,'自訂欄位驗證失敗：'+f.label);}
 let begun=false;try{db.exec('BEGIN IMMEDIATE');begun=true;
 if(db.prepare("SELECT id FROM registrations WHERE event_id=? AND status IN ('confirmed','pending','waitlisted') AND (phone=? OR email=?)").get(e.id,phone,email)){db.exec('ROLLBACK');begun=false;return bad(res,'手機或 Email 已報名',409);}
 const occupied=db.prepare("SELECT COALESCE(SUM(participants),0) n FROM registrations WHERE event_id=? AND status IN ('confirmed','pending')").get(e.id).n;
 const queued=e.allow_waitlist&&e.auto_waitlist&&db.prepare("SELECT id FROM registrations WHERE event_id=? AND status='waitlisted' LIMIT 1").get(e.id);
 const full=occupied+n>e.capacity;if(full&&!e.allow_waitlist){db.exec('ROLLBACK');begun=false;return bad(res,'剩餘名額不足',409);}
 const id=randomUUID(),code=randomBytes(12).toString('hex'),status=full||queued?'waitlisted':e.review_required?'pending':'confirmed';
 db.prepare('INSERT INTO registrations(id,event_id,name,phone,email,participants,notes,status,custom_answers,field_snapshot,created_at,lookup_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,e.id,name,phone,email,n,v.notes||'',status,JSON.stringify(answers),JSON.stringify(fields),new Date().toISOString(),code);
 promoteWaitlist(e.id,null,req.requestId);queueMail(id,'registered');const actual=db.prepare('SELECT status FROM registrations WHERE id=?').get(id).status;db.exec('COMMIT');begun=false;res.json({id,status:actual,lookupCode:code});
 }catch{if(begun)db.exec('ROLLBACK');bad(res,'報名失敗，請保留資料後重試',500);}
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
