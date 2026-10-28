import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export async function openDatabase(dataDir){
fs.mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'eventflow.sqlite'),{timeout:5000});
if(db.prepare('PRAGMA user_version').get().user_version>29){db.close();throw Error('Database version is newer than this application');}
const needs29=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!db.prepare('SELECT version FROM schema_migrations WHERE version=29').get();
const needs28=!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()||!db.prepare('SELECT version FROM schema_migrations WHERE version=28').get();
if(needs29&&db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()){
 const dest=path.join(dataDir,'migration-backups');fs.mkdirSync(dest,{recursive:true});
 const file=path.join(dest,'pre-v29-'+Date.now()+'-'+randomUUID()+'.sqlite');
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
return db;
}
