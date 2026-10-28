import {test} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {DatabaseSync} from 'node:sqlite';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('V2.7 tenant boundaries, role lifecycle, scoped audit, legacy migration and repeat startup',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'eventflow-v27-'));let child,base,cookie='',port=34831;
 async function stop(){if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill()});child=null}
 t.after(async()=>{await stop();rmSync(dir,{force:true,recursive:true})});
 // A genuine pre-V2.7 schema, including a legacy audit entry that cannot be safely assigned.
 const legacy=new DatabaseSync(path.join(dir,'eventflow.sqlite'));
 const server=readFileSync(path.join(root,'modules/database.js'),'utf8');const schema=server.match(/db.exec\(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;([\s\S]*?)`\);/)[1];legacy.exec(schema);legacy.prepare('INSERT INTO organizations(id,name) VALUES(?,?)').run('legacy-org','既有組織');legacy.prepare('INSERT INTO audit(at,action,detail) VALUES(?,?,?)').run(new Date().toISOString(),'legacy.action','legacy-sensitive');legacy.close();
 async function start(){base='http://127.0.0.1:'+port++;child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:base.split(':').at(-1),HOST:'127.0.0.1',EVENTFLOW_DATA_DIR:dir,SMTP_HOST:'',SMTP_FROM:''},stdio:'pipe'});let err='';child.stderr.on('data',b=>err+=b);for(let i=0;i<400;i++){if(child.exitCode!==null)throw Error(err);try{if((await fetch(base+'/api/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('Startup failed '+err)}
 async function request(url,body,expected=200,method=body===undefined?'GET':'POST'){const csrf=cookie&&method!=='GET'?(await fetch(base+'/api/me',{headers:{Cookie:cookie}}).then(r=>r.json())).csrfToken:'';const r=await fetch(base+url,{method,headers:{...(csrf?{'X-CSRF-Token':csrf}:{}),Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=r.headers.get('content-type')?.includes('json')?await r.json():await r.text();assert.equal(r.status,expected,url+' '+JSON.stringify(data));return {data,r}}
 const password='V27-test-password-123';async function login(email){const {r}=await request('/api/login',{email,password});cookie=r.headers.get('set-cookie').split(';')[0];return cookie}
 await start();assert.equal(readdirSync(path.join(dir,'migration-backups')).length,1);
 const backupDb=new DatabaseSync(path.join(dir,'migration-backups',readdirSync(path.join(dir,'migration-backups'))[0]),{readOnly:true});assert.equal(backupDb.prepare('SELECT count(*) n FROM organizations').get().n,1);assert.ok(!backupDb.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='disabled'));backupDb.close();
 await request('/api/setup',{email:'owner@v27.test',password});const owner=await login('owner@v27.test');
 const orgA=(await request('/api/organizations',{name:'組織 A'})).data.id,orgB=(await request('/api/organizations',{name:'組織 B'})).data.id;
 const userA=(await request('/api/users',{email:'admin-a@v27.test',password,role:'admin',organizationId:orgA})).data.id;
 await request('/api/users',{email:'staff-a@v27.test',password,role:'staff',organizationId:orgA});await request('/api/users',{email:'admin-b@v27.test',password,role:'admin',organizationId:orgB});
 const event={title:'A 的活動',capacity:4,maxPerRegistration:2,price:0,status:'open',customFields:[],allowWaitlist:true};
 const eventA=(await request('/api/admin/events',{...event,organizationId:orgA})).data.id,eventB=(await request('/api/admin/events',{...event,title:'B 的活動',organizationId:orgB})).data.id;
 const draft=(await request('/api/admin/events',{...event,organizationId:orgB,status:'draft'})).data.id;
 cookie='';await request('/api/events/'+draft,undefined,404);await request('/api/admin/audit',undefined,401);
 const regA=(await request('/api/events/'+eventA+'/register',{name:'A參加者',phone:'0911111111',email:'guest-a@v27.test',participants:1})).data;
 const regB=(await request('/api/events/'+eventB+'/register',{name:'B參加者',phone:'0922222222',email:'guest-b@v27.test',participants:1})).data;
 const ticketB=(await request('/api/registrations/ticket',{id:regB.id,code:regB.lookupCode})).data;
 const adminA=await login('admin-a@v27.test');assert.deepEqual((await request('/api/admin/events')).data.map(e=>e.id),[eventA]);
 assert.equal((await request('/api/organizations')).data.length,1);assert.ok((await request('/api/admin/users')).data.every(u=>u.organization_id===orgA));
 for(const url of ['/api/admin/events/'+eventB+'/registrations','/api/admin/events/'+eventB+'/registrations.csv','/api/admin/events/'+eventB+'/checkins','/api/admin/registrations/'+regB.id+'/ticket'])await request(url,undefined,403);
 await request('/api/admin/events/'+eventB,{...event},403,'PUT');await request('/api/admin/events',{...event,organizationId:orgB},403);
 await request('/api/organizations/'+orgB,{name:'非法更改'},403,'PUT');await request('/api/admin/context',{organizationId:orgB},403);
 await request('/api/users',{email:'hacker@v27.test',password,role:'owner',organizationId:orgA},400);
 await request('/api/admin/users/'+userA,{role:'staff',organizationId:orgB,disabled:false},403,'PUT');
 await request('/api/admin/registrations/'+regB.id+'/review',{status:'cancelled'},403);await request('/api/admin/events/'+eventB+'/reviews/batch',{ids:[regB.id],status:'confirmed'},403);await request('/api/admin/events/'+eventB+'/checkins',{payload:ticketB.payload,method:'manual'},403);
 await request('/api/admin/reports?eventId='+eventB,undefined,400);for(const kind of ['events','registrations','checkins'])await request('/api/admin/reports/'+kind+'.csv?eventId='+eventB,undefined,400);
 const report=(await request('/api/admin/reports')).data;assert.equal(report.totals.events,1);assert.equal(report.totals.people,1);
 const notifications=(await request('/api/admin/notifications')).data;assert.ok(notifications.rows.every(x=>x.email!=='guest-b@v27.test'));
 await request('/api/admin/branding',{name:'A品牌',tagline:'A標語',brandColor:'#123456'},200,'PUT');
 const auditA=(await request('/api/admin/audit')).data;assert.ok(auditA.length);assert.ok(auditA.every(x=>x.organization_id===orgA));assert.ok(!auditA.some(x=>x.detail==='legacy-sensitive'));assert.ok(auditA.some(x=>x.action==='branding.update'&&x.actor_email==='admin-a@v27.test'));
 await request('/api/admin/backup',undefined,403);await request('/api/admin/import-v13',{format:'EventFlow',version:13,organizations:[],events:[],registrations:[]},403);
 await login('staff-a@v27.test');await request('/api/admin/events/'+eventA+'/registrations');await request('/api/admin/audit',undefined,403);await request('/api/admin/users',undefined,403);await request('/api/admin/events',{...event,organizationId:orgA},403);await request('/api/admin/branding',{name:'非法修改',tagline:'',brandColor:'#123456'},403,'PUT');
 cookie=owner;assert.ok((await request('/api/admin/audit')).data.some(x=>x.detail==='legacy-sensitive'));
 await request('/api/admin/context',{organizationId:orgA});assert.equal((await request('/api/admin/events')).data.length,1);assert.ok((await request('/api/admin/audit')).data.every(x=>x.organization_id===orgA));
 await request('/api/admin/context',{organizationId:orgB});assert.equal((await request('/api/admin/reports')).data.totals.events,2);assert.ok((await request('/api/admin/notifications')).data.rows.every(x=>x.email!=='guest-a@v27.test'));
 await request('/api/admin/context',{organizationId:null});await request('/api/admin/users/'+userA,{role:'staff',organizationId:orgA,disabled:true},200,'PUT');cookie=adminA;await request('/api/me',undefined,401);await request('/api/login',{email:'admin-a@v27.test',password},401);
 cookie=owner;await request('/api/admin/users/'+userA,{role:'admin',organizationId:orgB,disabled:false},200,'PUT');await login('admin-a@v27.test');assert.ok((await request('/api/admin/events')).data.every(e=>e.organizationId===orgB));await request('/api/admin/events/'+eventA+'/registrations',undefined,403);
 cookie=owner;await request('/api/admin/context',{organizationId:null});const before=(await request('/api/admin/backup')).data;
 await stop();await start();assert.equal(readdirSync(path.join(dir,'migration-backups')).length,1);const after=(await request('/api/admin/backup')).data;assert.deepEqual(after.events,before.events);assert.deepEqual(after.registrations,before.registrations);
 await stop();const db=new DatabaseSync(path.join(dir,'eventflow.sqlite'),{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,29);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(db.prepare('SELECT name FROM organizations WHERE id=?').get('legacy-org').name,'既有組織');db.close();
});

test('V2.7 migration refuses invalid legacy references and rolls back new columns',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'eventflow-v27-invalid-'));t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const db=new DatabaseSync(path.join(dir,'eventflow.sqlite'));db.exec('PRAGMA foreign_keys=OFF');const source=readFileSync(path.join(root,'modules/database.js'),'utf8');db.exec(source.match(/db.exec\(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;([\s\S]*?)`\);/)[1]);db.exec('PRAGMA foreign_keys=OFF');db.prepare('INSERT INTO users(id,email,passhash,role,organization_id) VALUES(?,?,?,?,?)').run('orphan','orphan@example.test','existing-hash','staff','missing-org');db.close();
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,EVENTFLOW_DATA_DIR:dir,PORT:'34899',HOST:'127.0.0.1'},stdio:'pipe'});let err='';child.stderr.on('data',b=>err+=b);const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Expected migration rejection'))},10000);child.once('exit',code=>{clearTimeout(timer);resolve(code)})});assert.notEqual(code,0);assert.match(err,/Migration foreign key check failed/);
 const migrated=new DatabaseSync(path.join(dir,'eventflow.sqlite'),{readOnly:true});assert.ok(!migrated.prepare('PRAGMA table_info(users)').all().some(x=>x.name==='disabled'));assert.equal(migrated.prepare('SELECT passhash FROM users WHERE id=?').get('orphan').passhash,'existing-hash');assert.ok(!migrated.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get());migrated.close();assert.equal(readdirSync(path.join(dir,'migration-backups')).length,1);
});
