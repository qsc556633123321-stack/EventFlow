let scanStream=null,scanFrame=null,scanBusy=false,scanGeneration=0;
const checkinMessage=s=>document.getElementById('checkinResult').textContent=s;
async function loadStats(){
 try{const rows=await api('/api/admin/stats');const table=document.createElement('table');const head=document.createElement('tr');for(const label of ['活動','已確認人數','待審核人數','候補人數','剩餘名額']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);
 for(const r of rows){const tr=document.createElement('tr');for(const value of [r.title,r.people.confirmed,r.people.pending,r.people.waitlisted||0,r.remaining]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);}document.getElementById('statsResult').replaceChildren(table);
 }catch(e){document.getElementById('statsResult').textContent=e.message;}
}
async function loadCheckinEvents(){const select=document.getElementById('checkinEvent');const old=select.value;const events=await api('/api/admin/events');select.replaceChildren();for(const e of events){const o=document.createElement('option');o.value=e.id;o.textContent=e.title+(e.archived?'（已封存）':'');select.append(o);}if(events.some(e=>e.id===old))select.value=old;await loadCheckins();}
async function loadCheckins(){const id=document.getElementById('checkinEvent').value;const body=document.getElementById('checkinRows');body.replaceChildren();document.getElementById('checkinCount').textContent='';if(!id)return;
 try{const d=await api('/api/admin/events/'+encodeURIComponent(id)+'/checkins');document.getElementById('checkinCount').textContent=`已簽到 ${d.registrations} 筆，共 ${d.people} 人`;for(const r of d.rows){const tr=document.createElement('tr');for(const v of [r.name,r.participants,new Date(r.checkin_time).toLocaleString('zh-TW'),{camera:'相機',manual:'手動',image:'圖片'}[r.method]||r.method,r.operator,r.status]){const td=document.createElement('td');td.textContent=v;tr.append(td);}body.append(tr);}}catch(e){checkinMessage(e.message);}
}
async function redeem(payload,method){if(scanBusy)return;const id=document.getElementById('checkinEvent').value;if(!id)return checkinMessage('請先選擇活動');scanBusy=true;
 try{const d=await post('/api/admin/events/'+encodeURIComponent(id)+'/checkins',{payload,method});checkinMessage(`✓ ${d.name}，${d.participants} 人簽到成功`);document.getElementById('checkinPayload').value='';}catch(e){checkinMessage(e.message);}finally{scanBusy=false;await loadCheckins();}
}
function stopScanner(){scanGeneration++;if(scanFrame)cancelAnimationFrame(scanFrame);scanFrame=null;scanStream?.getTracks().forEach(t=>t.stop());scanStream=null;const video=document.getElementById('scanVideo');video.srcObject=null;video.hidden=true;}
async function startScanner(){stopScanner();const generation=scanGeneration;try{
 if(!document.getElementById('checkinEvent').value)throw Error('請先選擇活動');
 if(!navigator.mediaDevices?.getUserMedia)throw Error('相機需 localhost 或 HTTPS；請改用圖片或手動輸入');
 const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});if(generation!==scanGeneration){stream.getTracks().forEach(t=>t.stop());return;}
 scanStream=stream;const video=document.getElementById('scanVideo');video.srcObject=stream;video.hidden=false;await video.play();
 checkinMessage('請將 QR Code 對準相機；讀取後會自動停止並核銷。');
 const scan=()=>{if(generation!==scanGeneration)return;if(video.readyState>=2){const canvas=document.getElementById('scanCanvas');const scale=Math.min(1,960/video.videoWidth);canvas.width=video.videoWidth*scale;canvas.height=video.videoHeight*scale;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0,canvas.width,canvas.height);const data=ctx.getImageData(0,0,canvas.width,canvas.height);const code=jsQR(data.data,data.width,data.height);if(code){stopScanner();void redeem(code.data,'camera');return;}}scanFrame=requestAnimationFrame(scan);};scan();
 }catch(e){stopScanner();checkinMessage('無法開啟相機：'+e.message);}
}
document.getElementById('statsRefresh').onclick=loadStats;
document.getElementById('cameraStart').onclick=startScanner;document.getElementById('cameraStop').onclick=stopScanner;
document.getElementById('checkinRefresh').onclick=loadCheckins;
document.getElementById('checkinEvent').onchange=()=>{stopScanner();checkinMessage('');void loadCheckins();};
document.getElementById('checkinForm').onsubmit=e=>{e.preventDefault();stopScanner();void redeem(document.getElementById('checkinPayload').value.trim(),'manual');};
document.getElementById('scanImage').onchange=async e=>{stopScanner();const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error('圖片需小於 10 MB');const bitmap=await createImageBitmap(file);const canvas=document.getElementById('scanCanvas');const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const qr=jsQR(pixels.data,pixels.width,pixels.height);if(!qr)throw Error('圖片內找不到 QR Code');await redeem(qr.data,'image');}catch(err){checkinMessage(err.message);}finally{e.target.value='';}};
window.addEventListener('hashchange',()=>{if(location.hash!=='#checkinPanel')stopScanner();});
document.querySelectorAll('.sidebar nav a').forEach(a=>a.addEventListener('click',()=>{if(a.hash!=='#checkinPanel')stopScanner();}));
document.getElementById('logout').addEventListener('click',stopScanner);
window.addEventListener('pagehide',stopScanner);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopScanner();});

async function adminTicket(id){try{const d=await api('/api/admin/registrations/'+encodeURIComponent(id)+'/ticket');document.getElementById('adminTicketTitle').textContent=d.title+(d.checkedIn?'（已簽到）':'（尚未簽到）');document.getElementById('adminTicketImage').src=d.qr;const a=document.getElementById('adminTicketSave');a.href=d.qr;a.download='EventFlow-ticket-'+id+'.png';document.getElementById('adminTicketDialog').showModal();}catch(e){msg(e.message);}}
