import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {DatabaseSync,backup} from 'node:sqlite';import nodemailer from 'nodemailer';
import {server,root} from './helpers.js';import {openDatabase} from '../modules/database.js';import {createMailer} from '../modules/mail.js';
const password='V28-test-passphrase-123';
test('V2.8 assigned event RBAC, organization member management, CSV, QR and audit outcomes',async t=>{
 const s=await server(t);const {call,login}=s;
 async function request(url,options={},status=200){const r=await call(url,options);assert.equal(r.status,status,url+' '+JSON.stringify(r.data));return r.data;}
 await request('/api/setup',{body:{email:'owner@v28.test',password}});const owner=await login('owner@v28.test',password);
 const orgA=(await request('/api/organizations',{cookie:owner,body:{name:'組織 A'}})).id,orgB=(await request('/api/organizations',{cookie:owner,body:{name:'組織 B'}})).id;
 const adminId=(await request('/api/users',{cookie:owner,body:{email:'admin-a@v28.test',password,role:'admin',organizationId:orgA}})).id;
 const adminBId=(await request('/api/users',{cookie:owner,body:{email:'admin-b@v28.test',password,role:'admin',organizationId:orgB}})).id;
 const event={title:'活動 A1',capacity:4,maxPerRegistration:2,price:0,status:'open',category:'體驗',customFields:[],reviewRequired:true};
 const a1=(await request('/api/admin/events',{cookie:owner,body:{...event,organizationId:orgA}})).id,a2=(await request('/api/admin/events',{cookie:owner,body:{...event,title:'活動 A2',organizationId:orgA}})).id,b=(await request('/api/admin/events',{cookie:owner,body:{...event,title:'活動 B',organizationId:orgB}})).id;
 const attendee={name:'參加者',phone:'0912345678',email:'a1@guest.test',participants:1};
 const reg1=await request('/api/events/'+a1+'/register',{body:attendee});const reg2=await request('/api/events/'+a2+'/register',{body:{...attendee,email:'a2@guest.test'}});const regB=await request('/api/events/'+b+'/register',{body:{...attendee,email:'b@guest.test'}});
 const admin=await login('admin-a@v28.test',password);
 const grant={email:'limited@v28.test',password,role:'staff',organizationId:orgA,staffMode:'assigned',eventAccess:[{eventId:a1,canReview:false,canCheckin:true,canExport:false}]};
 const staffId=(await request('/api/users',{cookie:admin,body:grant})).id;
 await request('/api/users',{cookie:admin,body:{...grant,email:'promote@v28.test',role:'admin'}},403);
 await request('/api/users',{cookie:admin,body:{...grant,email:'foreign@v28.test',organizationId:orgB}},403);
 await request('/api/users',{cookie:admin,body:{...grant,email:'grant-foreign@v28.test',eventAccess:[{...grant.eventAccess[0],eventId:b}]}},400);
 await request('/api/admin/users/'+adminId,{cookie:admin,method:'PUT',body:{role:'staff',organizationId:orgA,disabled:false}},403);
 await request('/api/admin/users/'+adminBId,{cookie:admin,method:'PUT',body:{role:'staff',organizationId:orgA,disabled:false}},403);
 const staff=await login('limited@v28.test',password);
 assert.deepEqual((await request('/api/admin/events',{cookie:staff})).map(e=>e.id),[a1]);
 assert.equal((await request('/api/admin/stats',{cookie:staff})).length,1);assert.equal((await request('/api/admin/reports',{cookie:staff})).totals.events,1);
 assert.ok((await request('/api/admin/notifications',{cookie:staff})).rows.every(n=>n.email==='a1@guest.test'));
 await request('/api/admin/events/'+a1+'/registrations',{cookie:staff});
 for(const id of [a2,b])for(const suffix of ['/registrations','/registrations.csv','/checkins'])await request('/api/admin/events/'+id+suffix,{cookie:staff},403);
 await request('/api/admin/events/'+a1+'/registrations.csv',{cookie:staff},403);
 await request('/api/admin/reports/registrations.csv?eventId='+a1,{cookie:staff},400);
 const emptyCSV=await request('/api/admin/reports/registrations.csv',{cookie:staff});assert.ok(!emptyCSV.includes('a1@guest.test'));
 await request('/api/admin/registrations/'+reg1.id+'/review',{cookie:staff,body:{status:'confirmed'}},403);
 await request('/api/admin/events/'+a1+'/reviews/batch',{cookie:staff,body:{ids:[reg1.id],status:'confirmed'}},403);
 await request('/api/admin/registrations/'+regB.id+'/review',{cookie:admin,body:{status:'confirmed'}},403);
 await request('/api/admin/registrations/'+reg1.id+'/review',{cookie:admin,body:{status:'confirmed'}});
 const ticket=await request('/api/registrations/ticket',{body:{id:reg1.id,code:reg1.lookupCode}});
 await request('/api/admin/events/'+a1+'/checkins',{cookie:staff,body:{payload:ticket.payload,method:'manual'}});
 await request('/api/admin/events/'+a1+'/checkins',{cookie:staff,body:{payload:ticket.payload,method:'manual'}},409);
 await request('/api/admin/events/'+b+'/checkins',{cookie:staff,body:{payload:ticket.payload,method:'manual'}},403);
 assert.equal((await request('/api/admin/events/'+a1+'/checkins',{cookie:staff})).registrations,1);
 // A member change revokes every pre-existing session; granted exports remain scoped.
 await request('/api/admin/users/'+staffId,{cookie:admin,method:'PUT',body:{role:'staff',organizationId:orgA,disabled:false,staffMode:'assigned',eventAccess:[{eventId:a1,canReview:true,canCheckin:false,canExport:true}]}});
 await request('/api/me',{cookie:staff},401);const updated=await login('limited@v28.test',password);
 await request('/api/admin/registrations/'+reg1.id+'/ticket',{cookie:updated},403);
 const csv=await request('/api/admin/reports/registrations.csv',{cookie:updated});assert.ok(csv.includes('a1@guest.test'));assert.ok(!csv.includes('a2@guest.test'));assert.ok(!csv.includes('b@guest.test'));
 await request('/api/admin/registrations/'+reg1.id+'/review',{cookie:updated,body:{status:'cancelled'}});
 await request('/api/admin/registrations/'+reg2.id+'/review',{cookie:updated,body:{status:'confirmed'}},403);
 await request('/api/admin/context',{cookie:owner,body:{organizationId:orgA}});
 await request('/api/admin/events/'+b+'/registrations',{cookie:owner},403);
 await request('/api/admin/events/'+b,{cookie:owner,method:'PUT',body:event},403);await request('/api/admin/backup',{cookie:owner},403);
 await request('/api/admin/context',{cookie:owner,body:{organizationId:null}});
 // Delete is archival, preserving all historical rows and allowing restoration.
 await request('/api/admin/events/'+a1,{cookie:admin,method:'DELETE'});await request('/api/events/'+a1,{},404);
 assert.equal((await request('/api/admin/events/'+a1+'/registrations',{cookie:admin})).length,1);
 const archived=(await request('/api/admin/events',{cookie:admin})).find(e=>e.id===a1);await request('/api/admin/events/'+a1,{cookie:admin,method:'PUT',body:{...archived,archived:false}});
 const rows=await request('/api/admin/audit',{cookie:admin});assert.ok(rows.every(r=>r.organization_id===orgA));
 for(const action of ['user.create','user.update','registration.review','registration.cancel','registration.checkin','registration.checkin_duplicate','event.delete'])assert.ok(rows.some(r=>r.action===action),action);
 assert.ok(rows.some(r=>r.result==='denied'));assert.ok(rows.some(r=>r.action==='registration.checkin_duplicate'&&r.result==='conflict'&&r.status_code===409));
 assert.ok(rows.filter(r=>r.result==='success'&&r.action.startsWith('registration.')).every(r=>r.target_id&&r.user_id&&r.at));
 const serialized=JSON.stringify(await request('/api/admin/audit',{cookie:owner}));for(const secret of [password,ticket.payload,reg1.lookupCode,s.csrf.get(owner),owner.split('=')[1]])assert.ok(!serialized.includes(secret));
});

test('V2.8 API validation, CSRF, cookies, failed login and bounded rate limiting',async t=>{
 const {call,login}=await server(t);
 assert.equal((await call('/api/setup',{body:{email:'security@v28.test',password},headers:{'X-Forwarded-For':'203.0.113.10'}})).status,403);
 assert.equal((await call('/api/setup',{body:{email:'security@v28.test',password}})).status,200);const owner=await login('security@v28.test',password);
 const loginResponse=await call('/api/login',{body:{email:'security@v28.test',password}});assert.match(loginResponse.headers.get('set-cookie'),/HttpOnly/);assert.match(loginResponse.headers.get('set-cookie'),/SameSite=Strict/);
 const mutation={cookie:owner,body:{name:'不應建立'}};
 for(const opts of [{...mutation,token:false},{...mutation,headers:{'X-CSRF-Token':'é'.repeat(64)}},{...mutation,headers:{Origin:'https://evil.example'}},{...mutation,headers:{'Sec-Fetch-Site':'cross-site'}}])assert.equal((await call('/api/organizations',opts)).status,403);
 const badBodies=[{raw:'{"email":'}, {raw:'null'}, {body:[]}, {body:{name:{sql:'anything'}}}];
 for(const options of badBodies){const r=await call('/api/organizations',{cookie:owner,...options});assert.equal(r.status,400);assert.equal(typeof r.data.code,'string');assert.match(r.data.requestId,/^[a-f0-9-]{36}$/);assert.ok(!JSON.stringify(r.data).includes('SQLITE'));}
 const contentType=await call('/api/login',{raw:'email=a&password=b',headers:{'Content-Type':'application/x-www-form-urlencoded'}});assert.equal(contentType.status,415);
 const huge=await call('/api/login',{body:{email:'security@v28.test',password:'x'.repeat(300)}});assert.equal(huge.status,400);
 const org=(await call('/api/me',{cookie:owner})).data.organization_id;
 const event={title:'安全測試 <img src=x onerror=alert(1)>',capacity:3,maxPerRegistration:1,price:0,status:'open',organizationId:org,customFields:[]};
 const e=await call('/api/admin/events',{cookie:owner,body:event});assert.equal(e.status,200);
 for(const overrides of [{date:'2026-02-30'},{description:{}},{capacity:'3'},{reviewRequired:'false'},{customFields:[{id:'field',label:'x',type:'select',options:null}]},{customFields:[{id:'__proto__',label:'x',type:'text'}]}])assert.equal((await call('/api/admin/events',{cookie:owner,body:{...event,...overrides}})).status,400);
 const sql=await call('/api/admin/events/'+encodeURIComponent("x'OR'1'='1")+'/registrations',{cookie:owner});assert.equal(sql.status,404);
 const unknown=await call('/api/unknown',{cookie:owner});assert.equal(unknown.status,404);assert.equal(unknown.data.code,'NOT_FOUND');
 const failed=await call('/api/login',{body:{email:'security@v28.test',password:'wrong-password'}});assert.equal(failed.status,401);
 const injection=await call('/api/login',{body:{email:"a'--@v28.test",password:'wrong-password'}});assert.equal(injection.status,401);assert.equal(injection.data.error,failed.data.error);
 for(let n=0;n<10;n++)assert.equal((await call('/api/login',{body:{email:'rate-missing@v28.test',password:'wrong-password'}})).status,401);
 const limited=await call('/api/login',{body:{email:'rate-missing@v28.test',password:'wrong-password'}});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
 const audit=(await call('/api/admin/audit',{cookie:owner})).data;assert.ok(audit.some(r=>r.action==='auth.login_failed'&&r.actor_email==='security@v28.test'&&r.result==='failure'));assert.ok(audit.some(r=>r.action==='auth.rate_limited'&&r.result==='rate_limited'));assert.ok(!JSON.stringify(audit).includes('wrong-password'));
 const prefix=fs.readFileSync(path.join(root,'public/discovery.js'),'utf8').split('async function api')[0];assert.ok(vm.runInNewContext(prefix+`;escapeHTML('<img src=x onerror=alert(1)>')`).startsWith('&lt;img'));
});

test('V2.8 mail generation, preview, retry and secret-free transport errors',async t=>{
 const s=await server(t);await s.stop();const db=new DatabaseSync(path.join(s.dir,'eventflow.sqlite'));s.resources.push(db);
 db.prepare('INSERT INTO organizations(id,name) VALUES(?,?)').run('mail-org','Mail');db.prepare('INSERT INTO events(id,organization_id,title,capacity) VALUES(?,?,?,?)').run('mail-event','mail-org','信件測試',5);
 db.prepare('INSERT INTO registrations(id,event_id,name,phone,email,participants,status,created_at,lookup_code) VALUES(?,?,?,?,?,?,?,?,?)').run('mail-reg','mail-event','測試參加者','0912345678','nobody@example.test',1,'confirmed',new Date().toISOString(),'private-lookup');
 let output;const stream=nodemailer.createTransport({streamTransport:true,buffer:true});const mail=createMailer(db,{enabled:true,from:'sender@example.test',transport:{sendMail:async value=>{const r=await stream.sendMail(value);output=r.message.toString();return r}}});
 mail.queueMail('mail-reg','registered');mail.queueMail('mail-reg','registered');assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n,1);await mail.processMail();assert.equal(db.prepare('SELECT status FROM notifications').get().status,'sent');assert.ok(output.includes('To: nobody@example.test'));assert.ok(output.includes('text/plain'));assert.ok(!output.includes('private-lookup'));
 const preview=createMailer(db,{enabled:false});preview.queueMail('mail-reg','confirmed');await preview.processMail();assert.equal(db.prepare("SELECT status FROM notifications WHERE kind='confirmed'").get().status,'preview');
 const failing=createMailer(db,{enabled:true,from:'sender@example.test',transport:{sendMail:async()=>{throw Object.assign(Error('smtp-secret-password'),{code:'EAUTH'})}}});failing.queueMail('mail-reg','cancelled');for(let n=0;n<5;n++){db.prepare("UPDATE notifications SET next_attempt_at=0 WHERE kind='cancelled'").run();await failing.processMail()}const row=db.prepare("SELECT * FROM notifications WHERE kind='cancelled'").get();assert.equal(row.status,'failed');assert.equal(row.attempts,5);assert.equal(row.last_error,'EAUTH');assert.ok(!JSON.stringify(row).includes('smtp-secret-password'));
});

test('V2.7 production copy upgrades to V2.8 without altering event/registration/ticket history',async t=>{
 const s=await server(t);await s.stop();
 // Only the read-only production connection and its consistent backup are touched.
 const source=new DatabaseSync(path.join(root,'data/eventflow.sqlite'),{readOnly:true});const destination=path.join(s.dir,'eventflow.sqlite');await backup(source,destination);source.close();
 const snapshot=new DatabaseSync(destination,{readOnly:true});const sourceVersion=snapshot.prepare('PRAGMA user_version').get().user_version;
 const tables=['organizations','users','events','registrations','tickets','checkins','notifications','audit'];const before=Object.fromEntries(tables.map(table=>[table,snapshot.prepare('SELECT * FROM '+table+' ORDER BY 1').all()]));snapshot.close();
 const db=await openDatabase(s.dir);assert.equal(db.prepare('PRAGMA user_version').get().user_version,28);
 for(const table of tables){const columns=Object.keys(before[table][0]||{});if(!columns.length)continue;const rows=db.prepare('SELECT '+columns.join(',')+' FROM '+table+' ORDER BY 1').all();assert.deepEqual(rows,before[table],table);}
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations WHERE version=28').get().n,1);db.close();
 const backups=fs.existsSync(path.join(s.dir,'migration-backups'))?fs.readdirSync(path.join(s.dir,'migration-backups')):[];assert.equal(backups.length,sourceVersion<28?1:0);if(backups.length){const saved=new DatabaseSync(path.join(s.dir,'migration-backups',backups[0]),{readOnly:true});assert.equal(saved.prepare('PRAGMA user_version').get().user_version,sourceVersion);saved.close();}
 const again=await openDatabase(s.dir);again.close();assert.equal(fs.existsSync(path.join(s.dir,'migration-backups'))?fs.readdirSync(path.join(s.dir,'migration-backups')).length:0,backups.length);
});

test('V2.7 fixture migrates complete QR history, preserves hashes and revokes old sessions',async t=>{
 const s=await server(t);const {call,login}=s;assert.equal((await call('/api/setup',{body:{email:'fixture@v28.test',password}})).status,200);const owner=await login('fixture@v28.test',password);const me=(await call('/api/me',{cookie:owner})).data;
 const e=(await call('/api/admin/events',{cookie:owner,body:{title:'遷移歷史',capacity:5,maxPerRegistration:2,price:0,status:'open',customFields:[]}})).data.id;
 const reg=(await call('/api/events/'+e+'/register',{body:{name:'歷史參加者',phone:'0912345678',email:'fixture-guest@example.test',participants:1}})).data;
 const ticket=(await call('/api/registrations/ticket',{body:{id:reg.id,code:reg.lookupCode}})).data;
 assert.equal((await call('/api/admin/events/'+e+'/checkins',{cookie:owner,body:{payload:ticket.payload,method:'manual'}})).status,200);await s.stop();
 const legacy=new DatabaseSync(path.join(s.dir,'eventflow.sqlite'));legacy.exec('DROP TABLE user_event_access; DROP INDEX audit_action_result;');for(const name of ['result','target_type','target_id','request_id','status_code'])legacy.exec('ALTER TABLE audit DROP COLUMN '+name);legacy.exec("ALTER TABLE users DROP COLUMN staff_mode; DELETE FROM schema_migrations WHERE version=28; PRAGMA user_version=27;");
 const before={};for(const table of ['users','events','registrations','tickets','checkins','notifications','audit'])before[table]=legacy.prepare('SELECT * FROM '+table+' ORDER BY 1').all();assert.ok(legacy.prepare('SELECT count(*) n FROM sessions').get().n>0);legacy.close();
 const upgraded=await openDatabase(s.dir);s.resources.push(upgraded);for(const [table,rows] of Object.entries(before)){if(!rows.length)continue;assert.deepEqual(upgraded.prepare('SELECT '+Object.keys(rows[0]).join(',')+' FROM '+table+' ORDER BY 1').all(),rows,table)}assert.equal(upgraded.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(upgraded.prepare('SELECT staff_mode FROM users WHERE id=?').get(me.id).staff_mode,'organization');assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version,28);upgraded.close();
 await s.start();assert.equal((await call('/api/me',{cookie:owner})).status,401);const renewed=await login('fixture@v28.test',password);assert.equal((await call('/api/admin/events/'+e+'/checkins',{cookie:renewed})).data.registrations,1);assert.equal((await call('/api/admin/events/'+e+'/checkins',{cookie:renewed,body:{payload:ticket.payload,method:'manual'}})).status,409);
});


