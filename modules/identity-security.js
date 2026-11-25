// One users identity may have public and management sessions. A password change invalidates every reset capability.
export function revokePasswordLinks(db,userId,at=new Date().toISOString()){
 db.prepare("UPDATE account_tokens SET used_at=? WHERE user_id=? AND kind='reset' AND used_at IS NULL").run(at,userId);
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='member_tokens'").get())db.prepare('UPDATE member_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL').run(at,userId);
}
