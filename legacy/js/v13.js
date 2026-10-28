"use strict";
// V1.3: All permissions below are UI demonstrations, not security controls.
const roleSelect = document.getElementById("demoRole");
const orgSelect = document.getElementById("settingOrganization");
const reviewBox = document.getElementById("settingReviewRequired");
function role() { return roleSelect.value; }
function organizationOptions() {
  const orgs = Storage.getOrganizations();
  orgSelect.replaceChildren();
  for (const org of orgs) {
    const option = document.createElement("option");
    option.value = org.id; option.textContent = org.name;
    orgSelect.appendChild(option);
  }
}
function syncExtraSettings() {
  organizationOptions();
  const e = getEvent();
  reviewBox.checked = !!e.reviewRequired;
  orgSelect.value = e.organizationId || "org-default";
}
// The V1.2 event save handler runs first; this handler persists V1.3 settings.
settingsForm.addEventListener("submit", () => {
  const event = getEvent();
  if (!event || !settingsForm.checkValidity()) return;
  if (document.getElementById("settingsFeedback").classList.contains("error")) return;
  event.reviewRequired = reviewBox.checked;
  event.organizationId = orgSelect.value;
  Storage.saveEvent(event);
  Storage.audit("更新審核與主辦單位設定", event.title);
});
const previousSwitchEvent = switchEvent;
switchEvent = function(id) { previousSwitchEvent(id); syncExtraSettings(); };
function renderOrganizations() {
  const list = document.getElementById("organizationsList");
  list.replaceChildren();
  for (const org of Storage.getOrganizations()) {
    const row = document.createElement("div"); row.className="field-editor";
    const title=document.createElement("strong"); title.textContent=org.name;
    const info=document.createElement("p"); info.textContent=[org.email,org.phone].filter(Boolean).join(" · ") || "尚無聯絡資料";
    row.append(title,info); list.appendChild(row);
  }
}
document.getElementById("addOrgButton").addEventListener("click", () => {
  const name=document.getElementById("orgName").value.trim();
  const email=document.getElementById("orgEmail").value.trim();
  const phone=document.getElementById("orgPhone").value.trim();
  if(!name || name.length>100 || email.length>254 || phone.length>30 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    feedback("orgFeedback","請輸入有效的主辦單位名稱及聯絡資訊。",true);return;
  }
  const orgs=Storage.getOrganizations();
  if(orgs.some(o=>o.name===name)){feedback("orgFeedback","主辦單位名稱已存在。",true);return;}
  orgs.push({id:"org_"+Date.now().toString(36)+Math.random().toString(36).slice(2),name,email,phone});
  try {Storage.saveOrganizations(orgs);Storage.audit("新增主辦單位",name);renderOrganizations();syncExtraSettings();feedback("orgFeedback","已建立主辦單位。");}
  catch {feedback("orgFeedback","儲存失敗。",true);}
});
function reviewRegistration(id, action) {
  const all=Storage.getRegistrations();
  const item=all.find(r=>r.id===id && r.eventId===activeEventId);
  if(!item || item.status!=="pending") {feedback("listFeedback","這筆報名已非待審核狀態。",true);return;}
  const note=prompt(action==="confirmed" ? "審核通過備註（可留空）" : "拒絕原因（可留空）");
  if(note===null)return;
  if(note.length>500){feedback("listFeedback","備註不得超過 500 字。",true);return;}
  item.status=action; item.reviewNote=note.trim();item.reviewedAt=new Date().toISOString();
  try {Storage.saveRegistrations(all);Storage.audit(action==="confirmed"?"通過報名":"拒絕報名",id);updateDashboard();renderRegistrations();feedback("listFeedback",action==="confirmed"?"審核通過。":"已拒絕並釋放名額。");}
  catch {feedback("listFeedback","審核儲存失敗。",true);}
}
const oldRenderRegistrations=renderRegistrations;
renderRegistrations=function(){
  oldRenderRegistrations();
  const status=document.getElementById("statusFilter").value;
  const keyword=document.getElementById("searchInput").value.trim().toLowerCase();
  const filtered=getRegistrations().filter(r=>(status==="all"||r.status===status)&&[r.id,r.name,r.phone,r.email].join(" ").toLowerCase().includes(keyword)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const rows=[...tableBody.querySelectorAll("tr")];
  filtered.forEach((r,i)=>{
    if(r.status!=="pending" || !rows[i])return;
    const cell=rows[i].lastElementChild;
    if(!cell)return;
    cell.append(
      makeButton("通過",()=>reviewRegistration(r.id,"confirmed")),
      makeButton("拒絕",()=>reviewRegistration(r.id,"rejected"))
    );
  });
};
function renderAudit(){
  const list=document.getElementById("auditList");list.replaceChildren();
  const records=Storage.getAudit();
  if(!records.length){list.textContent="尚無操作紀錄。";return;}
  for(const r of records.slice(0,60)){
    const line=document.createElement("p");line.textContent=`${new Date(r.at).toLocaleString("zh-TW")} · ${r.action} · ${r.detail || ""}`;list.appendChild(line);
  }
}
document.getElementById("backupButton").addEventListener("click",()=>{
  const json=JSON.stringify(Storage.exportBackup(),null,2);
  const url=URL.createObjectURL(new Blob([json],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="EventFlow_V1.3_backup.json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  Storage.audit("匯出備份","JSON");renderAudit();
});
document.getElementById("restoreButton").addEventListener("click",async()=>{
  const file=document.getElementById("restoreFile").files[0];
  if(!file){feedback("backupFeedback","請選擇 JSON 檔案。",true);return;}
  if(file.size>15*1024*1024){feedback("backupFeedback","檔案超過 15 MB。",true);return;}
  if(!confirm("還原將覆蓋所有目前的活動、報名、主辦單位及操作紀錄。確定繼續？"))return;
  try{
    const data=JSON.parse(await file.text());
    Storage.restoreBackup(data);
    Storage.audit("還原備份","V1.3 JSON");
    location.href="admin.html";
  }catch(e){feedback("backupFeedback","還原失敗："+e.message,true);}
});
function applyDemoRole(){
  const staff=role()==="staff",owner=role()==="owner";
  for(const name of ["eventsPanel","settingsPanel","fieldsPanel","organizationPanel","backupPanel"]){
    const button=document.querySelector(`.admin-tab[data-panel="${name}"]`);
    button.hidden=staff || (name==="backupPanel"&&!owner) || (name==="organizationPanel"&&!owner);
  }
  if(staff){document.querySelector('.admin-tab[data-panel="registrationsPanel"]').click();}
  if(!owner && ["backupPanel","organizationPanel"].includes(document.querySelector(".admin-panel.active")?.id)){
    document.querySelector('.admin-tab[data-panel="registrationsPanel"]').click();
  }
}
roleSelect.addEventListener("change",applyDemoRole);
// Prevent clicking restricted UI actions. This is NOT a secure permission check.
document.addEventListener("click",e=>{
  if(role()==="owner")return;
  const restricted=e.target.closest("#backupPanel,#organizationPanel");
  const staffRestricted=role()==="staff" && e.target.closest("#eventsPanel,#settingsPanel,#fieldsPanel");
  if(restricted||staffRestricted){e.preventDefault();e.stopImmediatePropagation();}
},true);
settingsForm.addEventListener("submit",e=>{
  if(role()==="staff"){e.preventDefault();e.stopImmediatePropagation();}
},true);
syncExtraSettings();renderOrganizations();renderAudit();applyDemoRole();renderRegistrations();
