export function registerReviews(app,{db,auth,policy,log,bad,queueMail}){
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
   if(batch)log(req.user,'registration.batch',e.id+':'+updated,e.organization_id,{requestId:req.requestId});
   db.exec('COMMIT');begun=false;res.json(batch?{updated}:{ok:true});
  }catch(err){if(begun)db.exec('ROLLBACK');bad(res,err.status===400?'不允許的狀態轉換':err.status===409?'活動狀態或剩餘名額不允許確認':'審核失敗',err.status||500);}
 }
 app.post('/api/admin/registrations/:id/review',auth,(req,res)=>review(req,res,false));
 app.post('/api/admin/events/:id/reviews/batch',auth,(req,res)=>review(req,res,true));
}
