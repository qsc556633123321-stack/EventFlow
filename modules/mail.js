import nodemailer from 'nodemailer';import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';import fs from 'node:fs';import path from 'node:path';
export function accountKey(dataDir){const file=path.join(dataDir,'account-mail.key');try{fs.writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}const key=fs.readFileSync(file);if(key.length!==32)throw Error('Invalid account mail key');return key;}
export function decryptMessage(payload,key){const [iv,tag,body]=payload.split('.').map(x=>Buffer.from(x,'base64url'));const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(body),cipher.final()]).toString());}
function encryptMessage(value,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return [iv,cipher.getAuthTag(),body].map(x=>x.toString('base64url')).join('.');}
export function createMailer(db,options={}){
 const enabled=options.enabled??!!(process.env.SMTP_HOST&&process.env.SMTP_FROM),from=options.from||process.env.SMTP_FROM;
 const transport=options.transport||(enabled?nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='1',disableFileAccess:true,disableUrlAccess:true,auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS||''}:undefined}):null);
 const key=options.dataDir?accountKey(options.dataDir):null;
 function queueMail(id,kind){const r=db.prepare('SELECT r.*,e.title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=?').get(id);if(!r)return;
  const names={registered:'報名已收到',confirmed:'報名審核通過',cancelled:'報名已取消',rejected:'報名未通過',waitlist_promoted:r.status==='pending'?'候補已遞補，等待審核':'候補已遞補為確認名額'};
  db.prepare('INSERT OR IGNORE INTO notifications(id,registration_id,kind,email,subject,body,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,kind,r.email,`[EventFlow] ${names[kind]||'報名狀態更新'}：${r.title}`,`${r.name} 您好：\n活動：${r.title}\n報名編號：${r.id}\n目前狀態：${r.status}\n請至活動網站使用原查詢碼查詢報名結果。`,new Date().toISOString());
 }
 function queueAccountMail(tokenId,to,subject,text,deliver=true){if(!key)throw Error('Account key not configured');db.prepare('INSERT INTO account_messages(id,token_id,payload,status,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),tokenId,encryptMessage({to,subject,text},key),enabled&&deliver?'queued':'preview',new Date().toISOString());}
 let busy=false;
 async function processMail(){if(busy)return;busy=true;try{
  for(const table of ['notifications','account_messages']){
   db.prepare("UPDATE "+table+" SET status='uncertain',delivery_state='unknown',last_error='DELIVERY_UNKNOWN' WHERE status='sending' AND lease_until<?").run(Date.now());
   const rows=db.prepare("SELECT * FROM "+table+" WHERE status IN ('queued','retry') AND next_attempt_at<=? AND attempts<5 ORDER BY created_at LIMIT 10").all(Date.now());
   for(const r of rows){
    if(!enabled){db.prepare("UPDATE "+table+" SET status='preview',delivery_state='not_sent' WHERE id=? AND status IN ('queued','retry')").run(r.id);continue;}
    if(table==='account_messages'){const token=db.prepare('SELECT * FROM account_tokens WHERE id=?').get(r.token_id);if(!token||token.used_at||token.revoked_at||token.expires_at<=Date.now()){db.prepare("UPDATE account_messages SET status='expired',delivery_state='not_sent' WHERE id=?").run(r.id);continue;}}
    const claimed=db.prepare("UPDATE "+table+" SET status='sending',lease_until=?,message_id=? WHERE id=? AND status IN ('queued','retry')").run(Date.now()+10*60000,r.message_id||`<eventflow-${r.id}@eventflow.invalid>`,r.id);if(!claimed.changes)continue;
    try{const content=table==='notifications'?{to:r.email,subject:r.subject,text:r.body}:decryptMessage(r.payload,key);const result=await transport.sendMail({from,...content,messageId:r.message_id||`<eventflow-${r.id}@eventflow.invalid>`,disableFileAccess:true,disableUrlAccess:true});
     if(result?.rejected?.length||result?.accepted&&result.accepted.length===0)throw Object.assign(Error('Rejected'),{code:'EENVELOPE'});
     db.prepare("UPDATE "+table+" SET status='sent',delivery_state='accepted',sent_at=?,attempts=attempts+1,last_error='',lease_until=0 WHERE id=? AND status='sending'").run(new Date().toISOString(),r.id);
    }catch(err){const attempts=r.attempts+1,code=String(err.code||'SMTP_ERROR').replace(/[^A-Z0-9_]/g,'').slice(0,40)||'SMTP_ERROR';const known=['EAUTH','EENVELOPE','EMESSAGE','EDNS'].includes(code)||['CONN','EHLO','HELO','AUTH','STARTTLS','MAIL FROM','RCPT TO'].includes(err.command)||Number(err.responseCode)>=400;
     db.prepare('UPDATE '+table+' SET status=?,delivery_state=?,attempts=?,next_attempt_at=?,last_error=?,lease_until=0 WHERE id=?').run(known?(attempts>=5?'failed':'retry'):'uncertain',known?'not_sent':'unknown',attempts,Date.now()+Math.min(3600000,60000*2**attempts),known?code:'DELIVERY_UNKNOWN',r.id);
    }
   }
  }
 }finally{busy=false;}}
 return {queueMail,queueAccountMail,processMail,enabled};
}
