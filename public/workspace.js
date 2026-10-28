// Small UI components shared by dashboard and governance; no authority is inferred here.
window.statusLabel=value=>({pending:'待審核',confirmed:'已確認',waitlisted:'候補中',rejected:'未通過',cancelled:'已取消',open:'開放報名',closed:'暫停報名',draft:'草稿'})[value]||value;
window.renderOperations=d=>{
 const host=document.getElementById('opsQueue');if(!host)return;host.replaceChildren();
 for(const [key,label,hint] of [['pending','待審核','優先回覆報名者'],['waitlisted','候補人數','依剩餘名額安排'],['checkedIn','已簽到','掌握現場出席']]){
  const card=document.createElement('div');card.className='ops-card';const small=document.createElement('span');small.textContent=label;const value=document.createElement('strong');value.textContent=d.totals[key];const note=document.createElement('p');note.textContent=hint;card.append(small,value,note);
  const target=d.comparison.find(e=>key==='checkedIn'?e.checkedIn>0:e[key]>0);
  if(target){const b=document.createElement('button');b.className='secondary';b.textContent=key==='checkedIn'?'查看簽到':'處理報名';b.onclick=()=>{if(key==='checkedIn'){document.getElementById('checkinEvent').value=target.id;showPanel('checkinPanel');loadCheckins()}else{registrations(target.id,target.title);showPanel('registrationPanel');document.getElementById('regFilter').value=key;filterRegistrations()}};card.append(b)}else{const empty=document.createElement('small');empty.textContent='目前無待處理資料';card.append(empty)}host.append(card);
 }
};
document.getElementById('navToggle').onclick=()=>{const side=document.querySelector('.sidebar'),open=side.classList.toggle('nav-open');document.getElementById('navToggle').setAttribute('aria-expanded',String(open))};
document.querySelectorAll('.sidebar nav a').forEach(a=>a.addEventListener('click',()=>{document.querySelector('.sidebar').classList.remove('nav-open');document.getElementById('navToggle').setAttribute('aria-expanded','false')}));
// A searchable event table avoids scanning a long list of management rows.
document.getElementById('eventSearch').oninput=()=>{const q=document.getElementById('eventSearch').value.trim().toLowerCase();for(const row of document.querySelectorAll('#events .event-row'))row.hidden=!!q&&!row.textContent.toLowerCase().includes(q)};
