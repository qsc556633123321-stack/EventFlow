// Shared policy resolves current database membership; stale request objects cannot restore removed authority.
export function createPolicy(db){
 function effective(u,org){
  if(!u?.id||!org)return null;
  const account=db.prepare('SELECT role,disabled FROM users WHERE id=?').get(u.id);
  if(!account||account.disabled)return null;
  if(account.role==='owner')return !u.scopeOrganizationId||u.scopeOrganizationId===org?{role:'owner',staff_mode:'organization'}:null;
  if(!['admin','staff'].includes(account.role)||u.organization_id!==org)return null;
  return db.prepare("SELECT role,staff_mode FROM organization_memberships WHERE user_id=? AND organization_id=? AND status='active'").get(u.id,org)||null;
 }
 const inScope=(u,org)=>!!effective(u,org);
 const canManage=(u,org)=>['owner','admin'].includes(effective(u,org)?.role);
 function permission(u,org,eventId,operation='read'){
  if(!['read','review','checkin','export'].includes(operation))return false;
  const member=effective(u,org);if(!member)return false;
  if(eventId){const event=db.prepare('SELECT organization_id FROM events WHERE id=?').get(eventId);if(!event||event.organization_id!==org)return false;}
  if(member.role!=='staff')return ['owner','admin'].includes(member.role);
  if(member.staff_mode==='organization')return true;
  if(!eventId)return false;
  const access=db.prepare('SELECT * FROM user_event_access WHERE user_id=? AND event_id=?').get(u.id,eventId);
  return !!access&&(operation==='read'||!!access['can_'+operation]);
 }
 const canView=(u,org,id)=>permission(u,org,id);
 const canOperate=(u,e,operation)=>!!e&&permission(u,e.organization_id,e.id,operation);
 function visibleEvents(u,operation='read'){
  if(!u?.id)return [];
  const account=db.prepare('SELECT role,disabled FROM users WHERE id=?').get(u.id);if(!account||account.disabled)return [];
  const rows=account.role==='owner'&&!u.scopeOrganizationId?db.prepare('SELECT * FROM events').all():db.prepare('SELECT * FROM events WHERE organization_id=?').all(u.organization_id);
  return rows.filter(e=>canOperate(u,e,operation));
 }
 return {canManage,canView,canOperate,visibleEvents,inScope};
}
