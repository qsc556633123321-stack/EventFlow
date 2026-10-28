// A single policy is shared by lists, details, mutations, CSV and reports.
export function createPolicy(db){
 const known=u=>!!u&&['owner','admin','staff'].includes(u.role);
 const inScope=(u,org)=>known(u)&&(u.role==='owner'?(!u.scopeOrganizationId||u.scopeOrganizationId===org):u.organization_id===org);
 const canManage=(u,org)=>inScope(u,org)&&['owner','admin'].includes(u.role);
 function permission(u,org,eventId,operation='read'){
  if(!inScope(u,org))return false;
  if(u.role!=='staff')return true;
  if(u.staff_mode==='organization')return true; // Preserve existing staff access until explicitly restricted.
  if(!eventId)return false;
  const access=db.prepare('SELECT * FROM user_event_access WHERE user_id=? AND event_id=?').get(u.id,eventId);
  return !!access&&(operation==='read'||!!access['can_'+operation]);
 }
 const canView=(u,org,id)=>permission(u,org,id);
 const canOperate=(u,e,operation)=>!!e&&permission(u,e.organization_id,e.id,operation);
 function visibleEvents(u,operation='read'){
  if(!known(u))return [];
  const rows=u.role==='owner'&&!u.scopeOrganizationId?db.prepare('SELECT * FROM events').all():db.prepare('SELECT * FROM events WHERE organization_id=?').all(u.organization_id);
  return rows.filter(e=>canOperate(u,e,operation));
 }
 return {canManage,canView,canOperate,visibleEvents,inScope};
}
