export const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
// Accept a single unquoted mailbox, not display names, comments or recipient lists.
export const email=v=>text(v,254,true)&&/^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(v);
export const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
export const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export const password=v=>text(v,256,true)&&v.length>=12;
export function fieldsValid(fields){
 if(!Array.isArray(fields)||fields.length>30)return false;
 const ids=new Set();
 return fields.every(f=>{
  if(!record(f)||!identifier(f.id)||['__proto__','constructor','prototype'].includes(f.id)||ids.has(f.id)||!text(f.label,100,true)||!['text','textarea','number','date','select'].includes(f.type))return false;
  ids.add(f.id);
  if(f.required!==undefined&&typeof f.required!=='boolean'||f.visible!==undefined&&typeof f.visible!=='boolean')return false;
  return f.type!=='select'||Array.isArray(f.options)&&f.options.length>0&&f.options.length<=50&&f.options.every(o=>text(o,100,true));
 });
}
export function validateEvent(v){
 return record(v)&&text(v.title,100,true)&&Number.isSafeInteger(v.capacity)&&v.capacity>0&&v.capacity<=1000000&&Number.isSafeInteger(v.maxPerRegistration)&&v.maxPerRegistration>0&&v.maxPerRegistration<=100&&Number.isSafeInteger(v.price)&&v.price>=0&&v.price<=100000000&&['open','closed','draft','cancelled'].includes(v.status)&&fieldsValid(v.customFields)&&['reviewRequired','allowWaitlist','archived'].every(k=>v[k]===undefined||typeof v[k]==='boolean')&&(v.description===undefined||text(v.description,20000))&&(v.date===undefined||v.date===''||date(v.date))&&(v.location===undefined||text(v.location,300))&&(v.organizationId===undefined||identifier(v.organizationId))&&(v.category===undefined||['旅遊','講座','營隊','體驗'].includes(v.category));
}
export function routeValidation(req,res,next){
 const v=req.body,p=req.path;
 const bad=()=>res.status(400).json({error:'輸入資料格式不正確',code:'VALIDATION_ERROR'});
 if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&p.startsWith('/api/')&&!p.startsWith('/api/admin/upload')&&v!==undefined&&!record(v))return bad();
 if(!v)return next();
 if(p==='/api/admin/context'&&v.organizationId!==undefined&&v.organizationId!==null&&v.organizationId!==''&&!identifier(v.organizationId))return bad();
 if(p==='/api/admin/import-v13'&&req.method==='POST'){
  if(!Array.isArray(v.organizations)||!Array.isArray(v.events)||!Array.isArray(v.registrations))return bad();
  if(v.organizations.some(o=>!record(o)||!identifier(o.id)||!text(o.name,100,true)||(o.email!==undefined&&!text(o.email,254))||(o.phone!==undefined&&!text(o.phone,60))))return bad();
  if(v.events.some(e=>!record(e)||!identifier(e.id)||!validateEvent({...e,capacity:Number(e.capacity),price:Number(e.price)||0,maxPerRegistration:Number(e.maxPerRegistration)||4,status:e.status||'open',customFields:e.customFields||[]})))return bad();
  if(v.registrations.some(r=>!record(r)||!identifier(r.id)||!identifier(r.eventId)||!Number.isSafeInteger(Number(r.participants))||Number(r.participants)<1||Number(r.participants)>100||(r.createdAt!==undefined&&!Number.isFinite(Date.parse(r.createdAt)))||(r.customAnswers!==undefined&&!record(r.customAnswers))||(r.fieldSnapshot!==undefined&&!fieldsValid(r.fieldSnapshot))||['name','phone','email','notes','reviewNote'].some(k=>r[k]!==undefined&&!text(r[k],k==='notes'?1000:k==='reviewNote'?500:254))))return bad();
 }
 if(p==='/api/login'&&(!email(v.email)||!text(v.password,256,true)))return bad();
 if(p==='/api/setup'&&(!email(v.email)||!password(v.password)))return bad();
 if(/^\/api\/organizations(?:\/[^/]+)?$/.test(p)&&req.method!=='GET'&&(!text(v.name,100,true)||(v.email!==undefined&&v.email!==''&&!email(v.email))||(v.phone!==undefined&&!text(v.phone,60))))return bad();
 if(p==='/api/admin/branding'&&req.method==='PUT'&&(!text(v.name,100,true)||!text(v.tagline,160)||typeof v.brandColor!=='string'))return bad();
 if(/\/review$/.test(p)&&(!text(v.status,20,true)||(v.note!==undefined&&!text(v.note,500))))return bad();
 if(/\/reviews\/batch$/.test(p)&&(!Array.isArray(v.ids)||!v.ids.length||v.ids.length>100||!v.ids.every(identifier)))return bad();
 if(/\/register$/.test(p)){
  if(!text(v.name,60,true)||!text(v.phone,40,true)||!email(v.email)||!Number.isSafeInteger(v.participants)||(v.notes!==undefined&&!text(v.notes,1000))||(v.customAnswers!==undefined&&!record(v.customAnswers)))return bad();
  if(v.customAnswers&&Object.entries(v.customAnswers).some(([k,x])=>!identifier(k)||['__proto__','constructor','prototype'].includes(k)||!['string','number'].includes(typeof x)||String(x).length>500))return bad();
 }
 next();
}
