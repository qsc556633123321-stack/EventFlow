import {randomUUID} from 'node:crypto';
import {record,email,password,identifier} from './validation.js';
export function registerMembers(app,{db,auth,policy,log,hashPass,bad}){
 const fields='id,email,role,organization_id,disabled,staff_mode';
 function expose(u){return {...u,eventAccess:db.prepare('SELECT event_id eventId,can_review canReview,can_checkin canCheckin,can_export canExport FROM user_event_access WHERE user_id=?').all(u.id).map(x=>({...x,canReview:!!x.canReview,canCheckin:!!x.canCheckin,canExport:!!x.canExport}))};}
 app.get('/api/admin/users',auth,(req,res)=>{
  if(!['owner','admin'].includes(req.user.role))return bad(res,'無權限',403);
  const rows=req.user.role==='owner'&&!req.user.scopeOrganizationId?db.prepare('SELECT '+fields+' FROM users').all():db.prepare('SELECT '+fields+' FROM users WHERE organization_id=?').all(req.user.organization_id);
  res.json(rows.map(expose));
 });
 function validate(v,create){
  return record(v)&&['admin','staff'].includes(v.role)&&identifier(v.organizationId)&&(!create||email(v.email))&&(create?password(v.password):v.password===undefined||password(v.password))&&(v.disabled===undefined?create:typeof v.disabled==='boolean')&&(v.staffMode===undefined||['organization','assigned'].includes(v.staffMode))&&(v.eventAccess===undefined||Array.isArray(v.eventAccess)&&v.eventAccess.length<=200&&new Set(v.eventAccess.map(x=>x?.eventId)).size===v.eventAccess.length&&v.eventAccess.every(x=>record(x)&&identifier(x.eventId)&&['canReview','canCheckin','canExport'].every(k=>typeof x[k]==='boolean')));
 }
 function canChange(actor,old,v){
  if(!policy.canManage(actor,v.organizationId)||old&&!policy.canManage(actor,old.organization_id))return false;
  if(actor.role==='admin'&&(v.role!=='staff'||old&&old.role!=='staff'||v.organizationId!==actor.organization_id))return false;
  return !old||old.role!=='owner'&&old.id!==actor.id;
 }
 function setAccess(id,v,old){
  const mode=v.role==='staff'?(v.staffMode||old?.staff_mode||'organization'):'organization';
  const access=v.eventAccess??(old&&old.organization_id===v.organizationId&&old.role===v.role?db.prepare('SELECT event_id eventId,can_review canReview,can_checkin canCheckin,can_export canExport FROM user_event_access WHERE user_id=?').all(id):[]);
  if(access.some(x=>db.prepare('SELECT organization_id FROM events WHERE id=?').get(x.eventId)?.organization_id!==v.organizationId))throw Object.assign(Error('活動授權不屬於此組織'),{status:400});
  db.prepare('DELETE FROM user_event_access WHERE user_id=?').run(id);
  return {mode,access:mode==='assigned'&&v.role==='staff'?access:[]};
 }
 function save(req,res,create){
  const v=req.body;
  if(!['owner','admin'].includes(req.user.role))return bad(res,'無權限',403);
  if(!validate(v,create))return bad(res,'帳號或活動授權資料不正確');
  const old=create?null:db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if(!create&&!old)return bad(res,'使用者不存在',404);
  if(!canChange(req.user,old,v))return bad(res,'無權限變更此成員或角色',403);
  if(!db.prepare('SELECT id FROM organizations WHERE id=?').get(v.organizationId))return bad(res,'組織不存在',404);
  const id=old?.id||randomUUID();
  try{
   db.exec('BEGIN IMMEDIATE');
   const {mode,access}=setAccess(id,v,old);
   if(create)db.prepare('INSERT INTO users(id,email,passhash,role,organization_id,disabled,staff_mode) VALUES(?,?,?,?,?,?,?)').run(id,v.email.trim().toLowerCase(),hashPass(v.password),v.role,v.organizationId,v.disabled?1:0,mode);
   else{db.prepare('UPDATE users SET role=?,organization_id=?,disabled=?,passhash=?,staff_mode=? WHERE id=?').run(v.role,v.organizationId,v.disabled?1:0,v.password?hashPass(v.password):old.passhash,mode,id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);}
   for(const x of access)db.prepare('INSERT INTO user_event_access(user_id,event_id,can_review,can_checkin,can_export) VALUES(?,?,?,?,?)').run(id,x.eventId,x.canReview?1:0,x.canCheckin?1:0,x.canExport?1:0);
   log(req.user,create?'user.create':'user.update',id,old?.organization_id||v.organizationId,{requestId:req.requestId});
   if(old&&old.organization_id!==v.organizationId)log(req.user,'user.transfer',id,v.organizationId,{requestId:req.requestId});
   db.exec('COMMIT');res.json(create?{id}:{ok:true});
  }catch(e){db.exec('ROLLBACK');if(e.status===400)return bad(res,'活動授權不屬於此組織');if(String(e.message).includes('UNIQUE constraint failed: users.email'))return bad(res,'帳號已存在',409);return bad(res,'帳號更新失敗',500);}
 }
 app.post('/api/users',auth,(req,res)=>save(req,res,true));
 app.put('/api/admin/users/:id',auth,(req,res)=>save(req,res,false));
}
