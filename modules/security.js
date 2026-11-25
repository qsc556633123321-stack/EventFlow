import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const csrfFor=token=>sha('eventflow-csrf:'+token);
export const cookieToken=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ef_session='))?.slice(11)||'';
export function createSecurity(db,{log}){
 const buckets=new Map();
 function throttle(req,res,next){
  const now=Date.now(),login=req.path==='/api/login';
  const ip=req.ip||req.socket.remoteAddress||'unknown';
  const keys=[[login?'login-ip:':'public:',ip,login?30:90,60000]];
  if(login)keys.push(['login-account:',sha(String(req.body?.email||'').trim().toLowerCase()),10,10*60000]);
  for(const [prefix,key,max,window] of keys){const id=prefix+key;let item=buckets.get(id);if(!item||now>=item.until)item={n:0,until:now+window};item.n++;buckets.set(id,item);if(item.n>max){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((item.until-now)/1000))));return res.status(429).json({error:'嘗試次數過多，請稍後再試',code:'RATE_LIMITED'});}}
  if(buckets.size>10000){for(const [key,v] of buckets)if(v.until<=now)buckets.delete(key);while(buckets.size>10000)buckets.delete(buckets.keys().next().value);}
  next();
 }
 function auth(req,res,next){
  const token=cookieToken(req);if(!/^[a-f0-9]{64}$/.test(token))return res.status(401).json({error:'請先登入'});
  // The platform role is read only from users. Effective organization roles never fall back to legacy columns.
  const row=db.prepare('SELECT u.id,u.email,u.role platformRole,u.organization_id home_organization_id,s.organization_id session_organization_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.disabled=0').get(sha(token),Date.now());
  if(!row||!['owner','admin','staff'].includes(row.platformRole))return res.status(401).json({error:'登入已失效'});
  let user;
  if(row.platformRole==='owner'){
   if(row.session_organization_id&&!db.prepare('SELECT 1 FROM organizations WHERE id=?').get(row.session_organization_id))return res.status(401).json({error:'登入範圍已失效，請重新登入'});
   user={id:row.id,email:row.email,role:'owner',platformRole:'owner',staff_mode:'organization',organization_id:row.session_organization_id||row.home_organization_id,scopeOrganizationId:row.session_organization_id};
  }else{
   const membership=row.session_organization_id&&db.prepare("SELECT role,staff_mode FROM organization_memberships WHERE user_id=? AND organization_id=? AND status='active'").get(row.id,row.session_organization_id);
   if(!membership||!['admin','staff'].includes(membership.role))return res.status(401).json({error:'組織資格已失效，請重新登入'});
   user={id:row.id,email:row.email,role:membership.role,platformRole:row.platformRole,staff_mode:membership.staff_mode,organization_id:row.session_organization_id,scopeOrganizationId:row.session_organization_id};
  }
  req.user=user;res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!safeEqual(req.get('X-CSRF-Token'),csrfFor(token)))return res.status(403).json({error:'安全驗證已失效，請重新整理後再試',code:'CSRF_INVALID'});
  next();
 }
 function login(req,res){
  const {email,password}=req.body;const u=db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());req.auditActor=u?{id:u.id,email:u.email,organization_id:u.organization_id}:null;
  // Unknown accounts take the same password-hashing path.
  const valid=verify(password,u?.passhash||dummyHash);
  if(!u||u.disabled||!['owner','admin','staff'].includes(u.role)||!valid)return res.status(401).json({error:'帳號或密碼錯誤',code:'AUTH_FAILED'});
  const membership=u.role==='owner'?null:db.prepare("SELECT organization_id,role,staff_mode FROM organization_memberships WHERE user_id=? AND status='active' ORDER BY CASE WHEN organization_id=? THEN 0 ELSE 1 END,organization_id LIMIT 1").get(u.id,u.organization_id);
  if(u.role!=='owner'&&(!membership||!['admin','staff'].includes(membership.role)))return res.status(401).json({error:'帳號尚無有效組織資格，請聯絡管理員',code:'MEMBERSHIP_INACTIVE'});
  const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires,organization_id) VALUES(?,?,?,?)').run(sha(token),u.id,Date.now()+8*3600000,membership?.organization_id||null);
  const actor={...u,role:membership?.role||'owner',organization_id:membership?.organization_id||u.organization_id,platformRole:u.role};
  res.setHeader('Set-Cookie',sessionCookie(req,token));log(actor,'auth.login','session created',actor.organization_id,{requestId:req.requestId});res.json({email:u.email,role:actor.role,platformRole:u.role,organizationId:actor.organization_id});
 }
 // Injected below by configurePasswords, so password hashing remains in one place.
 let verify,dummyHash;
 function configurePasswords(verifyPass,hashPass){verify=verifyPass;dummyHash=hashPass(randomBytes(32).toString('hex'));}
 return {auth,throttle,login,configurePasswords};
}
export function sessionCookie(req,token,clear=false){return `ef_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:28800}${req.secure||process.env.COOKIE_SECURE==='1'?'; Secure':''}`;}
export function installSecurity(app){
 if(process.env.TRUST_PROXY==='loopback')app.set('trust proxy','loopback');
 app.use((req,res,next)=>{
  const json=res.json.bind(res);
  res.json=data=>{
   if(data&&typeof data.error==='string')data={error:data.error,code:data.code||({400:'VALIDATION_ERROR',401:'UNAUTHENTICATED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',413:'PAYLOAD_TOO_LARGE',415:'UNSUPPORTED_MEDIA_TYPE',429:'RATE_LIMITED'}[res.statusCode]||'INTERNAL_ERROR'),requestId:req.requestId};
   return json(data);
  };
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  if(!req.path.startsWith('/api/'))return next();
  res.setHeader('Cache-Control','no-store');
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  const origin=req.get('origin');
  if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'禁止跨來源操作',code:'ORIGIN_REJECTED'});
  if(origin){try{const u=new URL(origin);if(!['http:','https:'].includes(u.protocol)||u.host!==req.get('host')||(req.secure&&u.protocol!=='https:'))throw Error();}catch{return res.status(403).json({error:'來源驗證失敗',code:'ORIGIN_REJECTED'});}}
  if(req.method!=='DELETE'&&!req.path.startsWith('/api/admin/upload')&&!req.is('application/json'))return res.status(415).json({error:'請使用 JSON 格式提交資料'});
  next();
 });
}
export function apiErrors(app){
 app.use('/api',(req,res)=>res.status(404).json({error:'找不到 API'}));
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err.type==='entity.too.large'?413:err instanceof SyntaxError&&'body' in err?400:500;
  if(status===500)console.error('Unhandled request error: '+req.requestId);
  res.status(status).json({error:status===413?'提交內容超過大小限制':status===400?'JSON 格式不正確':'系統暫時無法處理，請稍後再試'});
 });
}
