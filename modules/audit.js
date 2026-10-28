import {randomUUID} from 'node:crypto';
export function createAudit(db){
 function target(detail){
  const id=String(detail||'').split(':')[0];
  for(const [type,sql] of [['event','SELECT organization_id FROM events WHERE id=?'],['registration','SELECT e.organization_id FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=?'],['user','SELECT organization_id FROM users WHERE id=?'],['organization','SELECT id organization_id FROM organizations WHERE id=?']]){
   const row=db.prepare(sql).get(id);if(row)return {type,id,org:row.organization_id};
  }
  return {type:'system',id:'',org:undefined};
 }
 function log(u,action,detail,organizationId,meta={}){
  const resource=target(detail);
  // detail is a resource identifier or a fixed server message, never request bodies/credentials.
  const safeDetail=String(detail||'').replace(/EF25:[a-f0-9]{64}/g,'[redacted]').slice(0,500);
  db.prepare('INSERT INTO audit(at,user_id,action,detail,organization_id,actor_email,result,target_type,target_id,request_id,status_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(new Date().toISOString(),u?.id||null,action.slice(0,80),safeDetail,organizationId!==undefined?organizationId:resource.org??u?.organization_id??null,u?.email||'',meta.result||'success',meta.type||resource.type,meta.targetId??resource.id,meta.requestId||'',meta.status||200);
 }
 function middleware(req,res,next){
  req.requestId=randomUUID();res.setHeader('X-Request-Id',req.requestId);
  res.on('finish',()=>{
   try{
    const status=res.statusCode,actor=req.user||req.auditActor;
    const p=req.path;
    if(status>=400&&p.startsWith('/api/')){
     let action=req.auditAction||'request.rejected';
     if(p==='/api/login')action=status===429?'auth.rate_limited':'auth.login_failed';
     else if(/\/checkins$/.test(p)&&req.method==='POST')action=req.auditAction||'registration.checkin_failed';
     const match=p.match(/\/(?:events|registrations|users|organizations)\/([a-zA-Z0-9_-]{1,100})(?:\/|$)/);
     const id=match?.[1]||'';
     log(actor,action,'HTTP '+status,actor?.organization_id??null,{result:status===403?'denied':status===409?'conflict':status===429?'rate_limited':'failure',targetId:id,type:match?p.includes('/registrations/')?'registration':p.includes('/events/')?'event':p.includes('/users/')?'user':'organization':'system',status,requestId:req.requestId});
    }else if(actor&&status<300&&(p.endsWith('.csv')||p==='/api/admin/backup')){
     log(actor,'data.export','export',actor.role==='owner'&&!actor.scopeOrganizationId?null:actor.organization_id,{requestId:req.requestId});
    }
   }catch{console.error('Audit persistence failed for request '+req.requestId);}
  });next();
 }
 return {log,middleware};
}
