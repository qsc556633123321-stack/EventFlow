window.showTicket=async function(id,code,target){
 target.replaceChildren();
 const note=document.createElement('p');target.append(note);
 const labels={confirmed:'已確認',pending:'待審核',waitlisted:'候補中',cancelled:'已取消',rejected:'已拒絕'};
 try{
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,code})};
  const response=await fetch('/api/registrations/lookup',options);const state=await response.json();if(!response.ok)throw Error(state.error);
  note.textContent='目前狀態：'+(labels[state.status]||state.status);
  if(!state.ticket){note.append('；確認報名後即可在此取得 QR Code 憑證。');return;}
  const res=await fetch('/api/registrations/ticket',options);const ticket=await res.json();if(!res.ok)throw Error(ticket.error);
  const title=document.createElement('h3');title.textContent=ticket.title+'｜報名憑證';
  const image=document.createElement('img');image.src=ticket.qr;image.alt='EventFlow 報名 QR Code';image.width=280;image.style.maxWidth='100%';
  const detail=document.createElement('p');detail.textContent=[ticket.date,ticket.location,ticket.participants+' 人',ticket.checkedIn?'已簽到':'尚未簽到'].filter(Boolean).join(' · ');
  const save=document.createElement('a');save.href=ticket.qr;save.download='EventFlow-ticket-'+id+'.png';save.textContent='下載 QR Code 圖片';
  const payload=document.createElement('details');const summary=document.createElement('summary');summary.textContent='顯示手動核銷內容';const content=document.createElement('p');content.textContent=ticket.payload;content.style.overflowWrap='anywhere';payload.append(summary,content);
  const warning=document.createElement('p');warning.textContent='請保存報名編號與查詢碼，並妥善保管憑證。每筆報名整組核銷一次；下載圖片的狀態以現場系統為準。';
  target.append(title,image,detail,save,payload,warning);
 }catch(e){note.textContent=e.message;}
};
document.getElementById('lookupForm').onsubmit=async e=>{e.preventDefault();const f=e.target;document.getElementById('lookupResult').textContent='';await window.showTicket(f.elements.id.value.trim(),f.elements.code.value.trim(),document.getElementById('lookupTicket'));};
