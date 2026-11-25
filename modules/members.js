import {revokePasswordLinks} from './identity-security.js';
import {randomUUID} from 'node:crypto';
import {record,email,password,identifier} from './validation.js';
export function registerMembers(app,{db,auth,policy,log,hashPass,bad}){
 const select=`SELECT u.id,u.email,CASE WHEN u.role='owner' THEN 'owner' ELSE m.role END role,m.organization_id,CASE WHEN u.disabled=1 OR m.status='suspended' THEN 1 ELSE 0 END disabled,m.staff_mode,u.role platformRole,u.disabled globalDisabled,m.status membershipStatus FROM organization_memberships m JOIN users u ON u.id=m.user_id`;
 function expose(u){return {...u,eventAccess:db.prepare('SELECT a.event_id eventId,a.can_review canReview,a.can_checkin canCheckin,a.can_export canExport FROM user_event_access a JOIN events e ON e.id=a.event_id WHERE a.user_id=? AND e.organization_id=?').all(u.id,u.organization_id).map(x=>({...x,canReview:!!x.canReview,canCheckin:!!x.canCheckin,canExport:!!x.canExport}))};}
 app.get('/api/admin/users',auth,(req,res)=>{
  if(!['owner','admin'].includes(req.user.role))return bad(res,'無權限',403);
  const global=req.user.role==='owner'&&!req.user.scopeOrganizationId;
  const rows=db.prepare(select+(global?'':' WHERE m.organization_id=?')+' ORDER BY u.email,m.organization_id').all(...(global?[]:[req.user.organization_id]));res.json(rows.map(expose));
 });
 function validate(v,create){return record(v)&&['admin','staff'].includes(v.role)&&identifier(v.organizationId)&&(!create||email(v.email))&&(create?password(v.password):v.password===undefined||password(v.password))&&(v.disabled===undefined?create:typeof v.disabled==='boolean')&&(v.globalDisabled===undefined||typeof v.globalDisabled==='boolean')&&(v.staffMode===undefined||['organization','assigned'].includes(v.staffMode))&&(v.eventAccess===undefined||Array.isArray(v.eventAccess)&&v.eventAccess.length<=200&&new Set(v.eventAccess.map(x=>x?.eventId)).size===v.eventAccess.length&&v.eventAccess.every(x=>record(x)&&identifier(x.eventId)&&['canReview','canCheckin','canExport'].every(k=>typeof x[k]==='boolean')));}
 const membership=(id,org)=>db.prepare('SELECT * FROM organization_memberships WHERE user_id=? AND organization_id=?').get(id,org);
 function save(req,res,create){
  const v=req.body,globalOwner=req.user.role==='owner'&&!req.user.scopeOrganizationId;if(!['owner','admin'].includes(req.user.role))return bad(res,'無權限',403);if(!validate(v,create))return bad(res,'帳號或活動授權資料不正確');
  if(v.globalDisabled!==undefined&&!globalOwner||!create&&v.password!==undefined&&!globalOwner)return bad(res,'全平台帳號狀態與密碼僅能在系統管理員的所有組織範圍變更',403);
  const old=create?null:db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id),prior=old&&membership(old.id,v.organizationId);
  if(!create&&!old)return bad(res,'使用者不存在',404);
  if(!policy.canManage(req.user,v.organizationId)||old&&(old.role==='owner'||old.id===req.user.id||!prior)||req.user.role==='admin'&&(v.role!=='staff'||prior&&prior.role!=='staff'||v.password!==undefined&&!create))return bad(res,'無權限變更此成員、密碼或角色',403);
  if(!db.prepare('SELECT id FROM organizations WHERE id=?').get(v.organizationId))return bad(res,'組織不存在',404);
  if(old?.disabled&&!(globalOwner&&v.globalDisabled===false))return bad(res,'此帳號已由平台停用，不能透過組織成員設定重新啟用',409);
  const id=old?.id||randomUUID(),mode=v.role==='staff'?(v.staffMode||prior?.staff_mode||(create?'organization':'assigned')):'organization';
  const access=v.eventAccess??(prior&&prior.role===v.role?db.prepare('SELECT a.event_id eventId,a.can_review canReview,a.can_checkin canCheckin,a.can_export canExport FROM user_event_access a JOIN events e ON e.id=a.event_id WHERE a.user_id=? AND e.organization_id=?').all(id,v.organizationId):[]);
  if(access.some(x=>db.prepare('SELECT organization_id FROM events WHERE id=?').get(x.eventId)?.organization_id!==v.organizationId))return bad(res,'活動授權不屬於此組織');
  let begun=false;try{
   db.exec('BEGIN IMMEDIATE');begun=true;const now=new Date().toISOString();
   if(create)db.prepare('INSERT INTO users(id,email,passhash,role,organization_id,disabled,staff_mode) VALUES(?,?,?,?,?,0,?)').run(id,v.email.trim().toLowerCase(),hashPass(v.password),v.role,v.organizationId,mode);
   else if(v.password!==undefined){db.prepare('UPDATE users SET passhash=? WHERE id=?').run(hashPass(v.password),id);revokePasswordLinks(db,id);}
   if(v.globalDisabled!==undefined)db.prepare('UPDATE users SET disabled=? WHERE id=?').run(v.globalDisabled?1:0,id);
   // The legacy home organization is immutable here: this endpoint only changes an existing membership.
   db.prepare("INSERT INTO organization_memberships(user_id,organization_id,role,status,staff_mode,created_at,updated_at) VALUES(?,?,?,'active',?,?,?) ON CONFLICT(user_id,organization_id) DO UPDATE SET role=excluded.role,status='active',staff_mode=excluded.staff_mode,updated_at=excluded.updated_at").run(id,v.organizationId,v.role,mode,now,now);
   db.prepare('DELETE FROM user_event_access WHERE user_id=? AND event_id IN (SELECT id FROM events WHERE organization_id=?)').run(id,v.organizationId);
   if(v.role==='staff'&&mode==='assigned')for(const x of access)db.prepare('INSERT INTO user_event_access(user_id,event_id,can_review,can_checkin,can_export) VALUES(?,?,?,?,?)').run(id,x.eventId,x.canReview?1:0,x.canCheckin?1:0,x.canExport?1:0);
   db.prepare('UPDATE organization_memberships SET status=? WHERE user_id=? AND organization_id=?').run(v.disabled?'suspended':'active',id,v.organizationId);
   // Revoke every session for a password change; otherwise revoke only the affected organization's sessions.
   if(!create){if(v.password!==undefined||v.globalDisabled!==undefined&&Number(v.globalDisabled)!==old.disabled)db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);else db.prepare('DELETE FROM sessions WHERE user_id=? AND (organization_id=? OR (organization_id IS NULL AND ?=?))').run(id,v.organizationId,old.organization_id,v.organizationId);}
   log(req.user,create?'user.create':'membership.update',id,v.organizationId,{type:'user',targetId:id,requestId:req.requestId});
   if(!create&&v.globalDisabled!==undefined&&Number(v.globalDisabled)!==old.disabled)log(req.user,v.globalDisabled?'account.global_disable':'account.global_enable',id,null,{type:'user',targetId:id,requestId:req.requestId});
   if(!create&&v.password!==undefined)log(req.user,'account.password_changed',id,null,{type:'user',targetId:id,requestId:req.requestId});
   db.exec('COMMIT');begun=false;res.json(create?{id}:{ok:true});
  }catch(e){if(begun)db.exec('ROLLBACK');if(String(e.message).includes('UNIQUE constraint failed: users.email'))return bad(res,'帳號已存在，請使用成員邀請加入其他組織',409);return bad(res,'帳號更新失敗',500);}
 }
 app.post('/api/users',auth,(req,res)=>save(req,res,true));app.put('/api/admin/users/:id',auth,(req,res)=>save(req,res,false));
}
