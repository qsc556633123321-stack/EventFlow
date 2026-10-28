// Event removal is reversible archival; registrations, tickets and check-ins stay intact.
export function registerEventArchive(app,{db,auth,policy,log,bad}){
 app.delete('/api/admin/events/:id',auth,(req,res)=>{
  const e=db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
  if(!e)return bad(res,'活動不存在',404);
  if(!policy.canManage(req.user,e.organization_id))return bad(res,'無權限',403);
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare('UPDATE events SET archived=1 WHERE id=?').run(e.id);
   log(req.user,'event.delete',e.id,e.organization_id,{requestId:req.requestId});
   db.exec('COMMIT');res.json({ok:true,archived:true});
  }catch{db.exec('ROLLBACK');bad(res,'封存失敗',500);}
 });
}
