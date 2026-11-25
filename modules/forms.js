import {randomUUID} from 'node:crypto';
import {fieldsValid,settingsValid,identifier} from './form-schema.js';
const validName=v=>typeof v==='string'&&v.trim().length>0&&v.length<=100;
export function registerForms(app,{db,auth,policy,log,bad}){
 const expose=r=>({id:r.id,name:r.name,organizationId:r.organization_id,builtin:r.organization_id===null,fields:JSON.parse(r.fields),settings:JSON.parse(r.settings),createdAt:r.created_at,updatedAt:r.updated_at});
 app.get('/api/admin/form-templates',auth,(req,res)=>{
  if(!['owner','admin'].includes(req.user.role))return bad(res,'無權限',403);
  const org=req.query.organizationId||req.user.organization_id;if(!identifier(org))return bad(res,'組織編號不正確');if(!policy.canManage(req.user,org))return bad(res,'無權限',403);
  res.json(db.prepare('SELECT * FROM form_templates WHERE organization_id IS NULL OR organization_id=? ORDER BY organization_id IS NOT NULL,name').all(org).map(expose));
 });
 function save(req,res,create){
  const v=req.body||{},old=create?null:db.prepare('SELECT * FROM form_templates WHERE id=?').get(req.params.id);
  if(!create&&!old)return bad(res,'找不到表單範本',404);
  if(old?.organization_id===null)return bad(res,'內建範本不可覆寫，請另存自訂範本',403);
  const org=old?.organization_id||v.organizationId||req.user.organization_id;
  if(!identifier(org))return bad(res,'組織編號不正確');
  if(!policy.canManage(req.user,org))return bad(res,'無權限',403);
  const settings=v.settings===undefined?{}:v.settings;
  if(!validName(v.name)||!fieldsValid(v.fields)||!settingsValid(settings))return bad(res,'範本名稱、欄位或設定不正確');
  const id=old?.id||randomUUID(),now=new Date().toISOString();
  if(create)db.prepare('INSERT INTO form_templates(id,organization_id,created_by,name,fields,settings,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,org,req.user.id,v.name.trim(),JSON.stringify(v.fields),JSON.stringify(settings),now,now);
  else db.prepare('UPDATE form_templates SET name=?,fields=?,settings=?,updated_at=? WHERE id=?').run(v.name.trim(),JSON.stringify(v.fields),JSON.stringify(settings),now,id);
  log(req.user,create?'form_template.create':'form_template.update',id,org,{type:'form_template',targetId:id,requestId:req.requestId});res.json({id,ok:true});
 }
 app.post('/api/admin/form-templates',auth,(req,res)=>save(req,res,true));
 app.put('/api/admin/form-templates/:id',auth,(req,res)=>save(req,res,false));
 app.delete('/api/admin/form-templates/:id',auth,(req,res)=>{const row=db.prepare('SELECT * FROM form_templates WHERE id=?').get(req.params.id);if(!row)return bad(res,'找不到表單範本',404);if(row.organization_id===null||!policy.canManage(req.user,row.organization_id))return bad(res,'無權限刪除此範本',403);db.prepare('DELETE FROM form_templates WHERE id=?').run(row.id);log(req.user,'form_template.delete',row.id,row.organization_id,{type:'form_template',targetId:row.id,requestId:req.requestId});res.json({ok:true})});
}
