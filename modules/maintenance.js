import fs from 'node:fs';import path from 'node:path';import {DatabaseSync,backup} from 'node:sqlite';import {randomUUID,createHash} from 'node:crypto';import {date} from './validation.js';
const inside=(root,file)=>path.resolve(file).startsWith(path.resolve(root)+path.sep);
const idValid=id=>typeof id==='string'&&/^eventflow-[0-9]+-[a-f0-9-]{36}$/.test(id);
async function hash(file){const sum=createHash('sha256');for await(const chunk of fs.createReadStream(file))sum.update(chunk);return sum.digest('hex');}
function files(root,base=root){if(!fs.existsSync(root))return [];if(fs.lstatSync(root).isSymbolicLink())throw Error('Symbolic backup source');const result=[];for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isSymbolicLink()||!entry.isDirectory()&&!entry.isFile())throw Error('Unsupported backup file');if(entry.isDirectory())result.push(...files(file,base));else result.push(path.relative(base,file).split(path.sep).join('/'));}return result;}
export async function verifySnapshot(directory){
 const dir=fs.realpathSync(directory);if(fs.lstatSync(directory).isSymbolicLink())throw Error('Symbolic backup directory');
 files(dir);const manifestFile=path.join(dir,'manifest.json');if(fs.statSync(manifestFile).size>5*1024*1024)throw Error('Manifest too large');const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 if(manifest.format!=='EventFlowSnapshot'||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>100000||!manifest.files.some(x=>x.path==='database.sqlite'))throw Error('Invalid snapshot');
 const seen=new Set();for(const item of manifest.files){if(typeof item.path!=='string'||item.path.includes('\\')||item.path.includes(':')||item.path.startsWith('/')||item.path.split('/').some(x=>!x||x==='.'||x==='..')||!['database.sqlite','account-mail.key'].includes(item.path)&&!item.path.startsWith('uploads/')||seen.has(item.path))throw Error('Invalid backup path');seen.add(item.path);
  const file=path.join(dir,...item.path.split('/'));if(!inside(dir,file)||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size!==item.size||await hash(file)!==item.sha256)throw Error('Backup checksum mismatch');
 }
 const actual=files(dir).filter(x=>x!=='manifest.json');if(actual.length!==seen.size||actual.some(x=>!seen.has(x)))throw Error('Unexpected backup content');
 const db=new DatabaseSync(path.join(dir,'database.sqlite'),{readOnly:true});try{
  const version=db.prepare('PRAGMA user_version').get().user_version;if(version>29||version!==manifest.schemaVersion||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Invalid backup database');
  if(db.prepare("SELECT name FROM sqlite_master WHERE name='account_messages'").get()&&db.prepare('SELECT COUNT(*) n FROM account_messages').get().n&&!seen.has('account-mail.key'))throw Error('Account mail key missing');
  for(const row of db.prepare('SELECT cover_url url FROM events UNION SELECT logo_url FROM organizations UNION SELECT hero_url FROM organizations').all()){if(row.url?.startsWith('/uploads/')){const relative='uploads/'+row.url.slice(9);if(!seen.has(relative))throw Error('Referenced upload missing');}}
 }finally{db.close();}return manifest;
}
export async function createSnapshot({db,dataDir,uploadsDir,backupRoot=path.join(dataDir,'backups')}){
 fs.mkdirSync(backupRoot,{recursive:true});const lock=path.join(backupRoot,'.create.lock');let descriptor;
 try{descriptor=fs.openSync(lock,'wx');fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));}catch{throw Object.assign(Error('Backup already running; inspect stale lock only while service is stopped'),{status:409})}
 const id='eventflow-'+Date.now()+'-'+randomUUID(),stage=path.join(backupRoot,'.working-'+randomUUID()),destination=path.join(backupRoot,id);
 try{fs.mkdirSync(stage);await backup(db,path.join(stage,'database.sqlite'));const copy=new DatabaseSync(path.join(stage,'database.sqlite'));try{copy.exec('PRAGMA journal_mode=DELETE');if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Invalid database');}finally{copy.close()}
  for(const name of files(uploadsDir)){const dest=path.join(stage,'uploads',...name.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(uploadsDir,...name.split('/')),dest);}
  if(fs.existsSync(path.join(dataDir,'account-mail.key')))fs.copyFileSync(path.join(dataDir,'account-mail.key'),path.join(stage,'account-mail.key'));
  const entries=[];for(const name of files(stage)){const file=path.join(stage,...name.split('/'));entries.push({path:name,size:fs.statSync(file).size,sha256:await hash(file)});}
  const check=new DatabaseSync(path.join(stage,'database.sqlite'),{readOnly:true});const schemaVersion=check.prepare('PRAGMA user_version').get().user_version;check.close();
  const manifest={format:'EventFlowSnapshot',version:1,id,createdAt:new Date().toISOString(),schemaVersion,files:entries};fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});await verifySnapshot(stage);fs.renameSync(stage,destination);return {id,directory:destination,manifest};
 }catch(e){if(inside(backupRoot,stage))fs.rmSync(stage,{recursive:true,force:true});throw e;}finally{if(descriptor!==undefined)fs.closeSync(descriptor);fs.unlinkSync(lock);}
}
export async function restoreSnapshot({directory,target,forbiddenRoots=[]}){
 const manifest=await verifySnapshot(directory);target=path.resolve(target);if(fs.existsSync(target))throw Error('Restore target already exists');const parent=fs.realpathSync(path.dirname(target));target=path.join(parent,path.basename(target));
 if(forbiddenRoots.some(root=>target===path.resolve(root)||inside(root,target)))throw Error('Restore target must be outside the running project/data/backups');
 const stage=target+'.restoring-'+randomUUID();if(fs.existsSync(stage))throw Error('Restore staging exists');
 try{fs.mkdirSync(stage);fs.mkdirSync(path.join(stage,'data'));fs.mkdirSync(path.join(stage,'public','uploads'),{recursive:true});
  for(const item of manifest.files){const dest=item.path==='database.sqlite'?path.join(stage,'data','eventflow.sqlite'):item.path==='account-mail.key'?path.join(stage,'data','account-mail.key'):path.join(stage,'public',...item.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(directory,...item.path.split('/')),dest);}
  const restored=new DatabaseSync(path.join(stage,'data','eventflow.sqlite'));try{restored.exec('BEGIN IMMEDIATE; DELETE FROM sessions;');if(restored.prepare("SELECT name FROM sqlite_master WHERE name='account_tokens'").get())restored.prepare('UPDATE account_tokens SET revoked_at=? WHERE used_at IS NULL AND revoked_at IS NULL').run(new Date().toISOString());for(const table of ['notifications','account_messages'])if(restored.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table)&&restored.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name==='delivery_state'))restored.exec("UPDATE "+table+" SET status='uncertain',delivery_state='unknown' WHERE status IN ('queued','retry','sending')");restored.exec('COMMIT');if(restored.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||restored.prepare('PRAGMA foreign_key_check').all().length)throw Error('Restore integrity check failed');}finally{restored.close();}
  fs.writeFileSync(path.join(stage,'RESTORE.json'),JSON.stringify({source:manifest.id,restoredAt:new Date().toISOString(),sessionsRevoked:true,accountLinksRevoked:true,pendingMailPaused:true},null,2));fs.renameSync(stage,target);return {target,source:manifest.id};
 }catch(e){if(stage.startsWith(target+'.restoring-'))fs.rmSync(stage,{recursive:true,force:true});throw e;}
}
export function createMaintenance({db,dataDir,uploadsDir,backupRoot=process.env.BACKUP_DIR||path.join(dataDir,'backups'),log,intervalMinutes=Number(process.env.BACKUP_INTERVAL_MINUTES??1440),retentionDays=Number(process.env.AUDIT_RETENTION_DAYS||0)}){
 if(!Number.isFinite(intervalMinutes)||intervalMinutes<0||!Number.isInteger(retentionDays)||retentionDays!==0&&retentionDays<30)throw Error('Invalid maintenance settings');
 const read=key=>db.prepare('SELECT value FROM maintenance_state WHERE key=?').get(key)?.value;const put=(key,value)=>db.prepare('INSERT INTO maintenance_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));if(!read('last_backup_at'))put('last_backup_at',Date.now());
 let running=false;
 async function make(actor=null){if(running)throw Object.assign(Error('Backup running'),{status:409});running=true;try{const result=await createSnapshot({db,dataDir,uploadsDir,backupRoot});put('last_backup_at',Date.now());put('last_backup_error','');log?.(actor,'backup.create',result.id,null,{type:'backup',targetId:result.id});return result;}catch(e){put('last_backup_error','BACKUP_FAILED');throw e;}finally{running=false;}}
 async function runDue(now=Date.now()){
  if(running)return;const due=intervalMinutes>0&&now-Number(read('last_backup_at'))>=intervalMinutes*60000;const cutoff=new Date(now-retentionDays*86400000).toISOString();const purge=retentionDays>0&&db.prepare('SELECT id FROM audit WHERE at<? LIMIT 1').get(cutoff);
  if(!due&&!purge)return;const saved=await make();put('last_backup_at',now);
  if(purge){const removed=db.prepare('DELETE FROM audit WHERE at<?').run(cutoff).changes;log?.(null,'audit.archive',saved.id,null,{type:'backup',targetId:saved.id});put('last_archived_count',removed);}
 }
 function list(){if(!fs.existsSync(backupRoot))return [];return fs.readdirSync(backupRoot).filter(idValid).map(id=>{try{const m=JSON.parse(fs.readFileSync(path.join(backupRoot,id,'manifest.json'),'utf8'));return {id,createdAt:m.createdAt,schemaVersion:m.schemaVersion,files:m.files.length,bytes:m.files.reduce((n,f)=>n+f.size,0)}}catch{return null}}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 return {make,runDue,list,backupRoot,status:()=>({intervalMinutes,retentionDays,running,lastBackupAt:Number(read('last_backup_at')),lastError:read('last_backup_error')||'',lastArchivedCount:Number(read('last_archived_count')||0)})};
}
export function registerMaintenance(app,{db,auth,bad,maintenance,mailer}){
 const owner=(req,res,next)=>req.user.role==='owner'&&!req.user.scopeOrganizationId?next():bad(res,'請切換至系統管理員的所有組織範圍',403);
 app.get('/api/admin/backups',auth,owner,(req,res)=>res.json({rows:maintenance.list(),...maintenance.status(),accountEmailConfigured:!!(mailer.enabled&&process.env.PUBLIC_BASE_URL)}));
 app.post('/api/admin/backups',auth,owner,async(req,res)=>{try{const result=await maintenance.make(req.user);res.json({id:result.id,verified:true,createdAt:result.manifest.createdAt})}catch(e){bad(res,e.status===409?'備份正在進行':'備份失敗，請檢查儲存空間與伺服器設定',e.status||500)}});
 app.post('/api/admin/backups/:id/verify',auth,owner,async(req,res)=>{if(!idValid(req.params.id))return bad(res,'備份編號不正確');try{await verifySnapshot(path.join(maintenance.backupRoot,req.params.id));res.json({verified:true})}catch{bad(res,'備份完整性驗證失敗',409)}});
 app.get('/api/admin/audit/page',auth,(req,res)=>{
  if(req.user.role==='staff')return bad(res,'無權限',403);const q=req.query,page=Number(q.page||1),size=Number(q.pageSize||30);if(!Number.isInteger(page)||page<1||page>100000||!Number.isInteger(size)||size<1||size>100||q.from&&!date(q.from)||q.to&&!date(q.to)||q.from&&q.to&&q.from>q.to||typeof(q.search||'')!=='string'||String(q.search||'').length>200)return bad(res,'查詢條件不正確');
  const clauses=[],args=[];if(req.user.role!=='owner'||req.user.scopeOrganizationId){clauses.push('organization_id=?');args.push(req.user.organization_id)}
  if(q.from){clauses.push('at>=?');args.push(new Date(q.from+'T00:00:00+08:00').toISOString())}if(q.to){clauses.push('at<?');args.push(new Date(Date.parse(q.to+'T00:00:00+08:00')+86400000).toISOString())}
  if(q.result){if(!['success','failure','denied','conflict','rate_limited','unknown'].includes(q.result))return bad(res,'結果篩選不正確');clauses.push('result=?');args.push(q.result)}
  if(q.search){const value='%'+q.search.replace(/[\\%_]/g,'\\$&')+'%';clauses.push("(actor_email LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR target_id LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\')");args.push(value,value,value,value)}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'',total=db.prepare('SELECT COUNT(*) n FROM audit'+where).get(...args).n;const rows=db.prepare('SELECT * FROM audit'+where+' ORDER BY id DESC LIMIT ? OFFSET ?').all(...args,size,(page-1)*size);res.json({rows,page,pageSize:size,total,pages:Math.max(1,Math.ceil(total/size))});
 });
}
