import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export async function openDatabase(dataDir){
fs.mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'eventflow.sqlite'),{timeout:5000});
if(db.prepare('PRAGMA user_version').get().user_version>31){db.close();throw Error('Database version is newer than this application');}
const needs31=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!db.prepare('SELECT version FROM schema_migrations WHERE version=31').get();
const needs30=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!db.prepare('SELECT version FROM schema_migrations WHERE version=30').get();
const needs29=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!db.prepare('SELECT version FROM schema_migrations WHERE version=29').get();
const needs28=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!db.prepare('SELECT version FROM schema_migrations WHERE version=28').get();
if(needs31&&db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()){
 const dest=path.join(dataDir,'migration-backups');fs.mkdirSync(dest,{recursive:true});
 const file=path.join(dest,'pre-v31-'+Date.now()+'-'+randomUUID()+'.sqlite');
 await backup(db,file);
 // Normalize the backup only to DELETE journaling so it is one portable SQLite file.
 const verified=new DatabaseSync(file);
 try{verified.exec('PRAGMA journal_mode=DELETE');if(verified.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');}finally{verified.close();}
}
// Back up consistently through SQLite before any schema change, including WAL content.
const needs27=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!db.prepare('SELECT version FROM schema_migrations WHERE version=27').get();
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT DEFAULT '',phone TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,passhash TEXT NOT NULL,role TEXT NOT NULL,organization_id TEXT REFERENCES organizations(id));
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',date TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',price INTEGER NOT NULL DEFAULT 0,capacity INTEGER NOT NULL, max_per_registration INTEGER NOT NULL DEFAULT 4,status TEXT NOT NULL DEFAULT 'open',archived INTEGER NOT NULL DEFAULT 0,review_required INTEGER NOT NULL DEFAULT 0,custom_fields TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL,participants INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,custom_answers TEXT NOT NULL DEFAULT '{}',field_snapshot TEXT NOT NULL DEFAULT '[]',review_note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,user_id TEXT,action TEXT NOT NULL,detail TEXT NOT NULL);`);

// V2.7 additive, transactional migration. Legacy audit rows remain unscoped.
if(needs27){
 db.exec('BEGIN IMMEDIATE');
 try{
 for(const [table,column,definition] of [['users','disabled','INTEGER NOT NULL DEFAULT 0'],['sessions','organization_id','TEXT REFERENCES organizations(id)'],['audit','organization_id','TEXT'],['audit','actor_email',"TEXT NOT NULL DEFAULT ''"]]){
  if(!db.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition);
 }
 db.exec("CREATE INDEX IF NOT EXISTS audit_org ON audit(organization_id,id); CREATE INDEX IF NOT EXISTS event_org ON events(organization_id); CREATE INDEX IF NOT EXISTS registration_event ON registrations(event_id); CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(27,datetime('now')); PRAGMA user_version=27;");
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migration foreign key check failed');
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
// V1.8 additive migrations: existing V1.7 data remains intact.
for(const [table,column,definition] of [
  ['organizations','logo_url',"TEXT NOT NULL DEFAULT ''"],
  ['organizations','brand_color',"TEXT NOT NULL DEFAULT '#4658ba'"],
  ['organizations','hero_url',"TEXT NOT NULL DEFAULT ''"],
  ['organizations','tagline',"TEXT NOT NULL DEFAULT ''"],
  ['events','cover_url',"TEXT NOT NULL DEFAULT ''"],
  ['events','category',"TEXT NOT NULL DEFAULT '體驗'"]
]) {if(!db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name===column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
for(const [table,column,definition] of [['events','allow_waitlist','INTEGER NOT NULL DEFAULT 0'],['registrations','lookup_code',"TEXT NOT NULL DEFAULT ''"]]){if(!db.prepare(`PRAGMA table_info(${table})`).all().some(x=>x.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
db.exec(`CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,registration_id TEXT NOT NULL REFERENCES registrations(id),kind TEXT NOT NULL,email TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,sent_at TEXT,UNIQUE(registration_id,kind));`);
// V2.5: additive migration; one credential and at most one check-in per registration.
db.exec(`CREATE TABLE IF NOT EXISTS tickets(registration_id TEXT PRIMARY KEY REFERENCES registrations(id),token TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checkins(id TEXT PRIMARY KEY,registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id),checkin_time TEXT NOT NULL,method TEXT NOT NULL,operator_id TEXT NOT NULL REFERENCES users(id));`);
if(needs28){
 db.exec('BEGIN IMMEDIATE');try{
 const additions=[['users','staff_mode',"TEXT NOT NULL DEFAULT 'organization' CHECK(staff_mode IN ('organization','assigned'))"],['audit','result',"TEXT NOT NULL DEFAULT 'unknown'"],['audit','target_type',"TEXT NOT NULL DEFAULT 'legacy'"],['audit','target_id',"TEXT NOT NULL DEFAULT ''"],['audit','request_id',"TEXT NOT NULL DEFAULT ''"],['audit','status_code','INTEGER']];
 for(const [table,column,definition] of additions)if(!db.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition);
 db.exec(`CREATE TABLE user_event_access(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,can_review INTEGER NOT NULL CHECK(can_review IN (0,1)),can_checkin INTEGER NOT NULL CHECK(can_checkin IN (0,1)),can_export INTEGER NOT NULL CHECK(can_export IN (0,1)),PRIMARY KEY(user_id,event_id));
 CREATE TRIGGER access_same_org_insert BEFORE INSERT ON user_event_access WHEN NOT EXISTS(SELECT 1 FROM users u JOIN events e ON e.organization_id=u.organization_id WHERE u.id=NEW.user_id AND e.id=NEW.event_id AND u.role='staff') BEGIN SELECT RAISE(ABORT,'Invalid event assignment'); END;
 CREATE TRIGGER access_same_org_update BEFORE UPDATE ON user_event_access WHEN NOT EXISTS(SELECT 1 FROM users u JOIN events e ON e.organization_id=u.organization_id WHERE u.id=NEW.user_id AND e.id=NEW.event_id AND u.role='staff') BEGIN SELECT RAISE(ABORT,'Invalid event assignment'); END;
 CREATE INDEX audit_action_result ON audit(action,result,id);
 DELETE FROM sessions;
 INSERT INTO schema_migrations(version,applied_at) VALUES(28,datetime('now'));
 PRAGMA user_version=28;`);
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Migration foreign key check failed');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Migration integrity check failed');
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
if(needs29){db.exec('BEGIN IMMEDIATE');try{
 const fields=[['events','auto_waitlist','INTEGER NOT NULL DEFAULT 1'],['notifications','message_id',"TEXT NOT NULL DEFAULT ''"],['notifications','delivery_state',"TEXT NOT NULL DEFAULT 'unknown'"],['notifications','lease_until','INTEGER NOT NULL DEFAULT 0']];
 for(const [table,column,type] of fields)if(!db.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+type);
 db.exec(`CREATE TABLE account_tokens(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('invite','reset')),token_hash TEXT NOT NULL UNIQUE,email TEXT NOT NULL,user_id TEXT REFERENCES users(id),organization_id TEXT REFERENCES organizations(id),role TEXT,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at TEXT,revoked_at TEXT);
 CREATE INDEX account_token_email ON account_tokens(email,kind,expires_at);
 CREATE TABLE account_messages(id TEXT PRIMARY KEY,token_id TEXT NOT NULL UNIQUE REFERENCES account_tokens(id),payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,sent_at TEXT,message_id TEXT NOT NULL DEFAULT '',delivery_state TEXT NOT NULL DEFAULT 'unknown',lease_until INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE maintenance_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE INDEX audit_time_org ON audit(organization_id,at,id);
 INSERT INTO schema_migrations(version,applied_at) VALUES(29,datetime('now'));PRAGMA user_version=29;`);
 if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Migration integrity check failed');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}}
if(needs30){
 db.exec('BEGIN IMMEDIATE');try{
  // Membership becomes the authority for a non-owner's active organization.
  // Legacy user columns remain untouched for source/history compatibility.
  db.exec(`CREATE TABLE organization_memberships(
   user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
   role TEXT NOT NULL CHECK(role IN ('admin','staff')),
   status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
   staff_mode TEXT NOT NULL DEFAULT 'assigned' CHECK(staff_mode IN ('organization','assigned')),
   created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
   PRIMARY KEY(user_id,organization_id));
  INSERT INTO organization_memberships(user_id,organization_id,role,status,staff_mode,created_at,updated_at)
   SELECT id,organization_id,CASE WHEN role='owner' THEN 'admin' ELSE role END,'active',staff_mode,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM users;
  UPDATE sessions SET organization_id=(SELECT u.organization_id FROM users u WHERE u.id=sessions.user_id)
   WHERE organization_id IS NULL AND user_id IN (SELECT id FROM users WHERE role<>'owner');
  DROP TRIGGER IF EXISTS access_same_org_insert;
  DROP TRIGGER IF EXISTS access_same_org_update;
  CREATE TRIGGER access_same_org_insert BEFORE INSERT ON user_event_access
   WHEN NOT EXISTS(SELECT 1 FROM organization_memberships m JOIN events e ON e.organization_id=m.organization_id
    WHERE m.user_id=NEW.user_id AND e.id=NEW.event_id AND m.role='staff' AND m.status='active')
   BEGIN SELECT RAISE(ABORT,'Invalid event assignment'); END;
  CREATE TRIGGER access_same_org_update BEFORE UPDATE ON user_event_access
   WHEN NOT EXISTS(SELECT 1 FROM organization_memberships m JOIN events e ON e.organization_id=m.organization_id
    WHERE m.user_id=NEW.user_id AND e.id=NEW.event_id AND m.role='staff' AND m.status='active')
   BEGIN SELECT RAISE(ABORT,'Invalid event assignment'); END;
  CREATE INDEX membership_org_active ON organization_memberships(organization_id,status,role,user_id);
  CREATE INDEX registration_event_status ON registrations(event_id,status,created_at,participants);
  CREATE INDEX session_user ON sessions(user_id);
  CREATE TABLE registration_requests(
   key_hash TEXT PRIMARY KEY NOT NULL CHECK(length(key_hash)=64),
   event_id TEXT NOT NULL REFERENCES events(id),
   request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
   registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id),
   created_at TEXT NOT NULL,expires_at INTEGER NOT NULL CHECK(expires_at>0));
  CREATE INDEX registration_request_expiry ON registration_requests(expires_at);
  CREATE TRIGGER request_same_event_insert BEFORE INSERT ON registration_requests
   WHEN NOT EXISTS(SELECT 1 FROM registrations WHERE id=NEW.registration_id AND event_id=NEW.event_id)
   BEGIN SELECT RAISE(ABORT,'Invalid registration request'); END;
  CREATE TRIGGER request_same_event_update BEFORE UPDATE ON registration_requests
   WHEN NOT EXISTS(SELECT 1 FROM registrations WHERE id=NEW.registration_id AND event_id=NEW.event_id)
   BEGIN SELECT RAISE(ABORT,'Invalid registration request'); END;
  INSERT INTO schema_migrations(version,applied_at) VALUES(30,datetime('now'));
  PRAGMA user_version=30;`);
  if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Migration integrity check failed');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');db.close();throw e;}
}
if(needs31){
 db.exec('BEGIN IMMEDIATE');try{
  const additions=[
   ['sessions','audience',"TEXT NOT NULL DEFAULT 'admin' CHECK(audience IN ('admin','member'))"],
   ['events','member_required','INTEGER NOT NULL DEFAULT 0 CHECK(member_required IN (0,1))'],
   ['events','chat_enabled','INTEGER NOT NULL DEFAULT 0 CHECK(chat_enabled IN (0,1))'],
   ['events','chat_join_policy',"TEXT NOT NULL DEFAULT 'confirmed' CHECK(chat_join_policy IN ('members','confirmed','staff'))"],
   ['events','form_settings',"TEXT NOT NULL DEFAULT '{}'"],['events','notification_settings',"TEXT NOT NULL DEFAULT '{}'"],
   ['events','starts_at',"TEXT NOT NULL DEFAULT ''"],['events','ends_at',"TEXT NOT NULL DEFAULT ''"],
   ['registrations','member_user_id','TEXT REFERENCES users(id)']
  ];
  for(const [table,column,definition] of additions)if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition);
  db.exec(`
   CREATE TABLE member_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),public_id TEXT NOT NULL UNIQUE,full_name TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',nickname TEXT NOT NULL,avatar_url TEXT NOT NULL DEFAULT '',common_answers TEXT NOT NULL DEFAULT '{}',email_verified_at TEXT,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','deletion_requested')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE member_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('verify','reset')),token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
   CREATE TABLE member_mail_outbox(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),token_id TEXT REFERENCES member_tokens(id),kind TEXT,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,sent_at TEXT,message_id TEXT NOT NULL DEFAULT '',delivery_state TEXT NOT NULL DEFAULT 'unknown',lease_until INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),preferences TEXT NOT NULL DEFAULT '{}',dm_policy TEXT NOT NULL DEFAULT 'requests' CHECK(dm_policy IN ('open','requests','closed')),show_presence INTEGER NOT NULL DEFAULT 1 CHECK(show_presence IN (0,1)));
   CREATE TABLE in_app_notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',href TEXT NOT NULL DEFAULT '/member.html',event_key TEXT,created_at TEXT NOT NULL,read_at TEXT,UNIQUE(user_id,event_key));
   CREATE TABLE form_templates(id TEXT PRIMARY KEY,organization_id TEXT REFERENCES organizations(id),created_by TEXT REFERENCES users(id),name TEXT NOT NULL,fields TEXT NOT NULL,settings TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE chat_rooms(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('public','event','direct')),event_id TEXT UNIQUE REFERENCES events(id),title TEXT NOT NULL,direct_key TEXT UNIQUE,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);
   CREATE TABLE chat_room_members(room_id TEXT NOT NULL REFERENCES chat_rooms(id),user_id TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','pending','declined')),created_at TEXT NOT NULL,PRIMARY KEY(room_id,user_id));
   CREATE TABLE chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL REFERENCES chat_rooms(id),sender_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message','announcement')),pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),deleted_at TEXT,created_at TEXT NOT NULL);
   CREATE TABLE chat_read_states(room_id TEXT NOT NULL REFERENCES chat_rooms(id),user_id TEXT NOT NULL REFERENCES users(id),last_read_id INTEGER NOT NULL DEFAULT 0 CHECK(last_read_id>=0),updated_at TEXT NOT NULL,PRIMARY KEY(room_id,user_id));
   CREATE TABLE member_blocks(blocker_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,PRIMARY KEY(blocker_id,blocked_id),CHECK(blocker_id<>blocked_id));
   CREATE TABLE chat_mutes(room_id TEXT NOT NULL REFERENCES chat_rooms(id),user_id TEXT NOT NULL REFERENCES users(id),until_at INTEGER NOT NULL,reason TEXT NOT NULL DEFAULT '',created_by TEXT REFERENCES users(id),PRIMARY KEY(room_id,user_id));
   CREATE TABLE chat_reports(id TEXT PRIMARY KEY,message_id INTEGER REFERENCES chat_messages(id),reporter_id TEXT REFERENCES users(id),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),resolution TEXT NOT NULL DEFAULT '',resolved_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,resolved_at TEXT);
   CREATE INDEX session_audience_user ON sessions(audience,user_id,expires);
   CREATE INDEX registration_member_status ON registrations(member_user_id,status,created_at);
   CREATE INDEX member_tokens_expiry ON member_tokens(user_id,kind,expires_at);
   CREATE INDEX member_mail_pending ON member_mail_outbox(status,next_attempt_at);
   CREATE INDEX member_notifications_unread ON in_app_notifications(user_id,read_at,id);
   CREATE INDEX member_notifications_kind ON in_app_notifications(user_id,kind,id);
   CREATE INDEX form_templates_org ON form_templates(organization_id,name);
   CREATE INDEX chat_messages_room_cursor ON chat_messages(room_id,id);
   CREATE INDEX chat_members_user ON chat_room_members(user_id,state,room_id);
   CREATE INDEX chat_reports_status_message ON chat_reports(status,message_id,created_at);
   CREATE INDEX chat_blocks_target ON member_blocks(blocked_id,blocker_id);
  `);
  const at=new Date().toISOString();
  const templates=[
   ['general','一般活動報名表',[]],
   ['travel','旅遊團報名表',[{id:'travel_diet',label:'飲食需求',type:'select',required:false,options:['一般','素食','其他']}]],
   ['course','課程報名表',[{id:'course_experience',label:'相關學習經驗',type:'textarea',required:false}]],
   ['lecture','講座報名表',[{id:'lecture_question',label:'想詢問講者的問題',type:'textarea',required:false}]],
   ['meal','聚餐報名表',[{id:'meal_diet',label:'餐食選擇',type:'select',required:true,options:['一般','素食']}]],
   ['competition','比賽報名表',[{id:'competition_team',label:'隊伍名稱',type:'text',required:true}]],
   ['blank','空白自訂表單',[]]
  ];
  const insert=db.prepare('INSERT INTO form_templates(id,organization_id,created_by,name,fields,settings,created_at,updated_at) VALUES(?,NULL,NULL,?,?,?,?,?)');
  for(const [id,name,fields] of templates)insert.run('builtin-'+id,name,JSON.stringify(fields),'{}',at,at);
  db.prepare("INSERT INTO chat_rooms(id,kind,title,created_at) VALUES('public','public','公共聊天室',?)").run(at);
  db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(31,?)').run(at);db.exec('PRAGMA user_version=31');
  if(db.prepare('PRAGMA foreign_key_check').all().length||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Migration integrity check failed');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');db.close();throw e;}
}
return db;
}
