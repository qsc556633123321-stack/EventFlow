import {randomBytes,randomUUID,createHash} from 'node:crypto';import {email,password,identifier} from './validation.js';
const digest=v=>createHash('sha256').update(v).digest('hex');
export function registerAccounts(app,{db,auth,policy,log,bad,hashPass,mailer,throttle}){
 app.use('/api/account',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
 const base=(()=>{try{const u=new URL(process.env.PUBLIC_BASE_URL);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.origin:''}catch{return ''}})();
 const url=(kind,token)=>(base||'')+'/account.html#'+kind+'='+token;
 const validToken=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 const get=(token,kind)=>validToken(token)?db.prepare('SELECT * FROM account_tokens WHERE token_hash=? AND kind=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(digest(token),kind,Date.now()):null;
 const generic={ok:true,message:'若帳號符合資格，會建立重設通知；未設定寄信服務時不會寄送。'};
 const limits=new Map();
 function resetLimit(req,res,next){const now=Date.now();for(const [key,max] of [['ip:'+req.ip,20],['email:'+digest(String(req.body?.email||'').toLowerCase()),5]]){const old=limits.get(key);const item=old&&old.until>now?old:{n:0,until:now+15*60000};item.n++;limits.set(key,item);if(item.n>max){res.set('Retry-After',String(Math.ceil((item.until-now)/1000)));return bad(res,'重設請求過於頻繁，請稍後再試',429)}}if(limits.size>10000){for(const [k,v] of limits)if(v.until<=now)limits.delete(k);while(limits.size>10000)limits.delete(limits.keys().next().value)}next();}
 app.get('/api/account/config',(req,res)=>res.json({emailConfigured:!!(mailer.enabled&&base)}));
 app.get('/api/admin/account-notifications',auth,(req,res)=>{
  if(req.user.role==='staff')return bad(res,'無權限',403);
  const scoped=req.user.role!=='owner'||req.user.scopeOrganizationId;
  const rows=db.prepare('SELECT m.id,m.status,m.attempts,m.last_error,m.delivery_state,m.created_at,m.sent_at,t.email,t.kind,t.organization_id FROM account_messages m JOIN account_tokens t ON t.id=m.token_id'+(scoped?' WHERE t.organization_id=?':'')+' ORDER BY m.created_at DESC LIMIT 200').all(...(scoped?[req.user.organization_id]:[]));res.json({rows});
 });
 app.post('/api/admin/account-notifications/:id/retry',auth,(req,res)=>{
  const row=db.prepare('SELECT m.id,m.status,t.organization_id,t.used_at,t.revoked_at,t.expires_at FROM account_messages m JOIN account_tokens t ON t.id=m.token_id WHERE m.id=?').get(req.params.id);
  if(!row||!policy.canManage(req.user,row.organization_id))return bad(res,'無權限',403);
  if(!mailer.enabled||!base)return bad(res,'請先設定 SMTP 及 PUBLIC_BASE_URL',409);
  if(row.used_at||row.revoked_at||row.expires_at<=Date.now()||!['failed','preview','retry'].includes(row.status))return bad(res,'此郵件已失效、寄出或結果不確定，不可重寄',409);
  db.prepare("UPDATE account_messages SET status='queued',attempts=0,next_attempt_at=0,last_error='',delivery_state='not_sent' WHERE id=?").run(row.id);log(req.user,'account_notification.retry',row.id,row.organization_id,{type:'notification',targetId:row.id});res.json({ok:true});
 });
 app.get('/api/admin/invitations',auth,(req,res)=>{
  if(!['owner','admin'].includes(req.user.role))return bad(res,'無權限',403);
  const rows=req.user.role==='owner'&&!req.user.scopeOrganizationId?db.prepare('SELECT * FROM account_tokens WHERE kind=? ORDER BY created_at DESC LIMIT 100').all('invite'):db.prepare('SELECT * FROM account_tokens WHERE kind=? AND organization_id=? ORDER BY created_at DESC LIMIT 100').all('invite',req.user.organization_id);
  res.json(rows.map(r=>({id:r.id,email:r.email,organizationId:r.organization_id,role:r.role,expiresAt:r.expires_at,status:r.used_at?'accepted':r.revoked_at?'revoked':r.expires_at<=Date.now()?'expired':'pending'})));
 });
 app.post('/api/admin/invitations',auth,(req,res)=>{
  const v=req.body||{};if(!email(v.email)||!identifier(v.organizationId)||!['admin','staff'].includes(v.role))return bad(res,'邀請資料不正確');
  if(!policy.canManage(req.user,v.organizationId)||req.user.role==='admin'&&v.role!=='staff')return bad(res,'無權限',403);
  if(!db.prepare('SELECT id FROM organizations WHERE id=?').get(v.organizationId))return bad(res,'組織不存在',404);
  const address=v.email.toLowerCase();if(db.prepare('SELECT id FROM users WHERE email=?').get(address))return bad(res,'此帳號已存在，請使用成員管理；跨組織加入尚未開放',409);
  const raw=randomBytes(32).toString('hex'),id=randomUUID(),expires=Date.now()+48*3600000;
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare("UPDATE account_tokens SET revoked_at=? WHERE kind='invite' AND email=? AND organization_id=? AND used_at IS NULL AND revoked_at IS NULL").run(new Date().toISOString(),address,v.organizationId);
   db.prepare("INSERT INTO account_tokens(id,kind,token_hash,email,organization_id,role,created_by,created_at,expires_at) VALUES(?,'invite',?,?,?,?,?,?,?)").run(id,digest(raw),address,v.organizationId,v.role,req.user.id,new Date().toISOString(),expires);
   mailer.queueAccountMail(id,address,'[EventFlow] 組織成員邀請','請於 48 小時內開啟一次性邀請連結：\n'+url('invite',raw)+'\n若非預期邀請，請忽略。',!!base);
   log(req.user,'invitation.create',id,v.organizationId,{type:'invitation',targetId:id,requestId:req.requestId});db.exec('COMMIT');res.json({id,invitationUrl:url('invite',raw),expiresAt:expires,deliveryStatus:mailer.enabled&&base?'queued':'preview'});
  }catch{db.exec('ROLLBACK');bad(res,'建立邀請失敗',500)}
 });
 app.delete('/api/admin/invitations/:id',auth,(req,res)=>{const token=db.prepare("SELECT * FROM account_tokens WHERE id=? AND kind='invite'").get(req.params.id);if(!token||!policy.canManage(req.user,token.organization_id))return bad(res,'無權限',403);db.prepare('UPDATE account_tokens SET revoked_at=? WHERE id=? AND used_at IS NULL').run(new Date().toISOString(),token.id);log(req.user,'invitation.revoke',token.id,token.organization_id,{type:'invitation',targetId:token.id});res.json({ok:true})});
 app.post('/api/account/invitation/info',throttle,(req,res)=>{const token=get(req.body?.token,'invite');if(!token)return bad(res,'連結無效、已使用或已到期',400);res.json({organization:db.prepare('SELECT name FROM organizations WHERE id=?').get(token.organization_id)?.name,role:token.role,email:token.email.replace(/^(.{1,3})[^@]*@/,'$1***@'),expiresAt:token.expires_at})});
 app.post('/api/account/invitation/accept',throttle,(req,res)=>{
  if(!password(req.body?.password))return bad(res,'密碼需為 12 至 256 字元');
  let begun=false;try{db.exec('BEGIN IMMEDIATE');begun=true;const token=get(req.body?.token,'invite');if(!token)throw Error();
   const issuer=db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(token.created_by);if(!issuer||!policy.canManage(issuer,token.organization_id)||issuer.role==='admin'&&token.role!=='staff'||db.prepare('SELECT id FROM users WHERE email=?').get(token.email))throw Error();
   const id=randomUUID();db.prepare('INSERT INTO users(id,email,passhash,role,organization_id,staff_mode) VALUES(?,?,?,?,?,?)').run(id,token.email,hashPass(req.body.password),token.role,token.organization_id,token.role==='staff'?'assigned':'organization');
   db.prepare('UPDATE account_tokens SET used_at=?,user_id=? WHERE id=?').run(new Date().toISOString(),id,token.id);log({id,email:token.email,organization_id:token.organization_id},'invitation.accept',token.id,token.organization_id,{type:'invitation',targetId:token.id});db.exec('COMMIT');begun=false;res.json({ok:true,message:'已加入組織，請登入。工作人員活動權限由管理員設定。'});
  }catch{if(begun)db.exec('ROLLBACK');bad(res,'連結無效、已使用、已到期或邀請資格已變更',400)}
 });
 app.post('/api/account/reset/request',resetLimit,throttle,(req,res)=>{
  if(!email(req.body?.email))return bad(res,'請輸入有效 Email');const user=db.prepare('SELECT * FROM users WHERE email=? AND disabled=0').get(req.body.email.toLowerCase());
  if(user){db.exec('BEGIN IMMEDIATE');try{const id=randomUUID(),raw=randomBytes(32).toString('hex');db.prepare("UPDATE account_tokens SET revoked_at=? WHERE user_id=? AND kind='reset' AND used_at IS NULL AND revoked_at IS NULL").run(new Date().toISOString(),user.id);
   db.prepare("INSERT INTO account_tokens(id,kind,token_hash,email,user_id,organization_id,created_at,expires_at) VALUES(?,'reset',?,?,?,?,?,?)").run(id,digest(raw),user.email,user.id,user.organization_id,new Date().toISOString(),Date.now()+30*60000);
   mailer.queueAccountMail(id,user.email,'[EventFlow] 密碼重設','請於 30 分鐘內開啟一次性重設連結：\n'+url('reset',raw)+'\n若非本人申請，請忽略。',!!base);log(null,'account.reset_requested',user.id,user.organization_id,{type:'user',targetId:user.id});db.exec('COMMIT');
  }catch{db.exec('ROLLBACK');return bad(res,'暫時無法處理，請稍後再試',500)}}res.json(generic);
 });
 app.post('/api/account/reset/complete',throttle,(req,res)=>{
  if(!password(req.body?.password))return bad(res,'密碼需為 12 至 256 字元');let begun=false;try{db.exec('BEGIN IMMEDIATE');begun=true;const token=get(req.body?.token,'reset');if(!token)throw Error();const user=db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(token.user_id);if(!user)throw Error();
   db.prepare('UPDATE users SET passhash=? WHERE id=?').run(hashPass(req.body.password),user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.prepare("UPDATE account_tokens SET used_at=? WHERE user_id=? AND kind='reset' AND used_at IS NULL AND revoked_at IS NULL").run(new Date().toISOString(),user.id);log(user,'account.password_reset',user.id,user.organization_id);db.exec('COMMIT');begun=false;res.json({ok:true,message:'密碼已更新，請重新登入。'});
  }catch{if(begun)db.exec('ROLLBACK');bad(res,'連結無效、已使用或已到期',400)}
 });
}
