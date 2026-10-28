import nodemailer from 'nodemailer';import {randomUUID} from 'node:crypto';
export function createMailer(db,options={}){
 const enabled=options.enabled??!!(process.env.SMTP_HOST&&process.env.SMTP_FROM);
 const from=options.from||process.env.SMTP_FROM;
 const transport=options.transport||(enabled?nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='1',disableFileAccess:true,disableUrlAccess:true,auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS||''}:undefined}):null);
 function queueMail(id,kind){
  const r=db.prepare('SELECT r.*,e.title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=?').get(id);if(!r)return;
  const names={registered:'報名已收到',confirmed:'報名審核通過',cancelled:'報名已取消',rejected:'報名未通過'};
  const subject=`[EventFlow] ${names[kind]||'報名狀態更新'}：${r.title}`;
  const body=`${r.name} 您好：\n活動：${r.title}\n報名編號：${r.id}\n目前狀態：${r.status}\n此信為系統通知，請勿直接回覆。`;
  db.prepare('INSERT OR IGNORE INTO notifications(id,registration_id,kind,email,subject,body,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,kind,r.email,subject,body,new Date().toISOString());
 }
 let busy=false;
 async function processMail(){
  if(busy)return;busy=true;
  try{
   const rows=db.prepare("SELECT * FROM notifications WHERE status IN ('queued','retry') AND next_attempt_at<=? AND attempts<5 ORDER BY created_at LIMIT 10").all(Date.now());
   for(const r of rows){
    if(!enabled){db.prepare("UPDATE notifications SET status='preview' WHERE id=?").run(r.id);continue;}
    try{await transport.sendMail({from,to:r.email,subject:r.subject,text:r.body,disableFileAccess:true,disableUrlAccess:true});db.prepare("UPDATE notifications SET status='sent',sent_at=?,attempts=attempts+1,last_error='' WHERE id=?").run(new Date().toISOString(),r.id);}
    catch(err){const attempts=r.attempts+1;const error=String(err.code||'SMTP_ERROR').replace(/[^A-Z0-9_]/g,'').slice(0,40)||'SMTP_ERROR';db.prepare('UPDATE notifications SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=?').run(attempts>=5?'failed':'retry',attempts,Date.now()+Math.min(3600000,60000*2**attempts),error,r.id);}
   }
  }finally{busy=false;}
 }
 return {queueMail,processMail,enabled};
}
