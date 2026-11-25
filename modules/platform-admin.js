import {platformEvents} from './platform-events.js';
export function savePlatformEvent(db,id,v,old={}){
 const object=(value,fallback)=>JSON.stringify(value===undefined?JSON.parse(fallback||'{}'):value);
 db.prepare('UPDATE events SET member_required=?,chat_enabled=?,chat_join_policy=?,form_settings=?,notification_settings=?,starts_at=?,ends_at=? WHERE id=?').run(v.memberRequired===undefined?(old.member_required||0):v.memberRequired?1:0,v.chatEnabled===undefined?(old.chat_enabled||0):v.chatEnabled?1:0,v.chatJoinPolicy||old.chat_join_policy||'confirmed',object(v.formSettings,old.form_settings),object(v.notificationSettings,old.notification_settings),v.startsAt??old.starts_at??'',v.endsAt??old.ends_at??'',id);
}
export function notifyEventChange(db,queueMail,old,current){
 let kind;if(old.status!=='cancelled'&&current.status==='cancelled')kind='event_cancelled';else if(old.date!==current.date||old.starts_at!==current.starts_at||old.ends_at!==current.ends_at)kind='event_time_changed:'+Date.now();
 if(!kind)return;for(const r of db.prepare("SELECT id FROM registrations WHERE event_id=? AND status IN ('confirmed','pending','waitlisted')").all(current.id))queueMail(r.id,kind);
}
export function createUpcomingNotifier({db,queueMail}){
 return function runUpcoming(now=Date.now()){
  const today=new Date(now+8*3600000).toISOString().slice(0,10);
  const events=db.prepare("SELECT * FROM events WHERE status='open' AND archived=0 AND (starts_at<>'' OR date=?)").all(today);
  for(const e of events){let settings;try{settings=JSON.parse(e.notification_settings)}catch{continue}if(settings.reminders===false)continue;
   const start=e.starts_at?Date.parse(e.starts_at):null;if(start!==null&&(!Number.isFinite(start)||start<now||start>now+86400000))continue;
   for(const r of db.prepare("SELECT id FROM registrations WHERE event_id=? AND status='confirmed'").all(e.id))queueMail(r.id,'event_upcoming:'+(e.starts_at||e.date));
  }
 };
}
export function registerPlatformAdmin(app,{db,auth,policy,bad,log,fieldsValid}){
 const globalOwner=(req,res,next)=>req.user.role==='owner'&&!req.user.scopeOrganizationId?next():bad(res,'會員帳號郵件僅供全域系統管理員查看',403);
 app.get('/api/admin/member-notifications',auth,globalOwner,(req,res)=>{const rows=db.prepare('SELECT m.id,m.kind,u.email,m.status,m.attempts,m.last_error,m.created_at,m.sent_at,m.delivery_state FROM member_mail_outbox m JOIN users u ON u.id=m.user_id ORDER BY m.created_at DESC LIMIT 200').all().map(r=>({...r,subject:r.kind==='verify'?'會員 Email 驗證':'會員密碼重設',memberNotification:true}));res.json({rows})});
 app.post('/api/admin/member-notifications/:id/retry',auth,globalOwner,(req,res)=>{const m=db.prepare('SELECT m.*,t.used_at,t.expires_at,p.status profile_status FROM member_mail_outbox m JOIN member_tokens t ON t.id=m.token_id JOIN member_profiles p ON p.user_id=m.user_id WHERE m.id=?').get(req.params.id);if(!m)return bad(res,'通知不存在',404);let base;try{base=new URL(process.env.PUBLIC_BASE_URL)}catch{}if(!process.env.SMTP_HOST||!process.env.SMTP_FROM||!base||!['http:','https:'].includes(base.protocol))return bad(res,'請先設定 SMTP 與公開網址',409);if(m.used_at||m.expires_at<=Date.now()||m.profile_status!=='active'||!['preview','failed','retry'].includes(m.status))return bad(res,'通知已失效、寄出或結果不確定，不能重寄',409);db.prepare("UPDATE member_mail_outbox SET status='queued',attempts=0,next_attempt_at=0,last_error='',delivery_state='not_sent' WHERE id=?").run(m.id);log(req.user,'member_notification.retry',m.id,null,{type:'notification',targetId:m.id,requestId:req.requestId});res.json({ok:true})});
 app.get('/api/admin/dashboard',auth,(req,res)=>{
  const events=policy.visibleEvents(req.user),ids=new Set(events.map(e=>e.id)),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const registrations=db.prepare('SELECT event_id,status,participants FROM registrations').all().filter(r=>ids.has(r.event_id));const participants=status=>registrations.filter(r=>status.includes(r.status)).reduce((n,r)=>n+r.participants,0);
  const todayCheckins=db.prepare("SELECT r.event_id,r.participants FROM checkins c JOIN registrations r ON r.id=c.registration_id WHERE substr(datetime(c.checkin_time,'+8 hours'),1,10)=?").all(today).filter(r=>ids.has(r.event_id)).reduce((n,r)=>n+r.participants,0);
  let failedNotifications=db.prepare("SELECT r.event_id FROM notifications n JOIN registrations r ON r.id=n.registration_id WHERE n.status IN ('failed','uncertain')").all().filter(r=>ids.has(r.event_id)).length;
  failedNotifications+=db.prepare("SELECT t.organization_id FROM account_messages m JOIN account_tokens t ON t.id=m.token_id WHERE m.status IN ('failed','uncertain')").all().filter(r=>req.user.role!=='staff'&&(req.user.role==='owner'&&!req.user.scopeOrganizationId||r.organization_id===req.user.organization_id)).length;
  if(req.user.role==='owner'&&!req.user.scopeOrganizationId)failedNotifications+=db.prepare("SELECT count(*) n FROM member_mail_outbox WHERE status IN ('failed','uncertain')").get().n;
  const reports=req.user.role==='staff'?[]:db.prepare("SELECT c.event_id,c.kind FROM chat_reports x JOIN chat_messages m ON m.id=x.message_id JOIN chat_rooms c ON c.id=m.room_id WHERE x.status='open'").all();
  const pendingReports=reports.filter(r=>r.kind==='event'?ids.has(r.event_id):req.user.role==='owner'&&!req.user.scopeOrganizationId).length;
  res.json({activeEvents:events.filter(e=>e.status==='open'&&!e.archived&&(!e.date||e.date>=today)).length,totalParticipants:participants(['confirmed','pending','waitlisted']),pendingParticipants:participants(['pending']),waitlistedParticipants:participants(['waitlisted']),todayCheckins,upcomingEvents:events.filter(e=>!e.archived&&e.status==='open'&&e.date>=today).sort((a,b)=>(a.starts_at||a.date).localeCompare(b.starts_at||b.date)).slice(0,5).map(e=>({id:e.id,title:e.title,date:e.date,startsAt:e.starts_at,location:e.location})),failedNotifications,pendingReports});
 });
 app.post('/api/admin/events/:id/publish',auth,(req,res)=>{
  const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);if(!e)return bad(res,'活動不存在',404);if(!policy.canManage(req.user,e.organization_id))return bad(res,'無權限',403);
  if(e.archived||e.status==='cancelled'||!e.title.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!e.location.trim()||e.capacity<1||e.max_per_registration<1||!fieldsValid(JSON.parse(e.custom_fields)))return bad(res,'發布前請完成活動名稱、日期、地點、名額與有效表單');
  db.prepare("UPDATE events SET status='open' WHERE id=?").run(e.id);log(req.user,'event.publish',e.id,e.organization_id,{requestId:req.requestId});res.json({ok:true,id:e.id});
 });

}
