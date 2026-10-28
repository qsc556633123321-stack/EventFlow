// All rendering uses textContent for organization and account data.
let organizations=[];
const roleNames={owner:'系統管理員',admin:'組織管理員',staff:'工作人員'};
function cell(row,value){const td=document.createElement('td');td.textContent=String(value??'—');row.append(td);return td}
function option(select,value,text){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o)}
async function loadGovernance(){
 organizations=await api('/api/organizations');
 const scope=$('orgContext');scope.replaceChildren();
 if(me.role==='owner')option(scope,'','所有組織 · 跨組織總覽');
 for(const o of organizations)option(scope,o.id,o.name);
 scope.value=me.role==='owner'?(me.scopeOrganizationId||''):me.organization_id;scope.disabled=me.role!=='owner';
 for(const id of ['userOrg','eventOrg']){const select=$(id);select.replaceChildren();for(const o of organizations)option(select,o.id,o.name);select.value=me.organization_id||organizations[0]?.id||'';}
 document.querySelectorAll('[data-owner-only]').forEach(x=>x.hidden=me.role!=='owner');
 document.querySelectorAll('[data-manager-only]').forEach(x=>x.hidden=me.role==='staff');
 for(const id of ['createPanel','brandingPanel','backupPanel','organizationPanel','usersPanel','auditPanel']){
 const a=document.querySelector('a[href="#'+id+'"]');if(a)a.hidden=(me.role==='staff'&&id!=='organizationPanel')||(id==='backupPanel'&&me.role!=='owner');
 }
 if(me.role==='admin'){const o=organizations[0];if(o){const f=$('orgForm');for(const k of ['id','name','email','phone'])f.elements[k].value=o[k]||'';$('orgFormTitle').textContent='編輯我的組織';$('orgReset').hidden=true;}}
 const table=$('orgRows');table.replaceChildren();
 for(const o of organizations){const tr=document.createElement('tr');cell(tr,o.name);cell(tr,o.email||'未設定');cell(tr,o.phone||'未設定');const td=cell(tr,'');const preview=document.createElement('a');preview.href='/?org='+encodeURIComponent(o.id);preview.target='_blank';preview.rel='noopener';preview.textContent='公開首頁 ↗';td.append(preview);
 if(me.role!=='staff'){const edit=document.createElement('button');edit.className='secondary';edit.textContent='編輯';edit.onclick=()=>{const f=$('orgForm');f.elements.id.value=o.id;f.elements.name.value=o.name;f.elements.email.value=o.email||'';f.elements.phone.value=o.phone||'';$('orgFormTitle').textContent='編輯組織';f.scrollIntoView({behavior:'smooth'})};td.append(edit)}table.append(tr)}
 if(me.role!=='staff')await Promise.all([loadUsers(),loadAudit(),loadNotifications()]);
 if(me.role==='staff'&&['createPanel','brandingPanel','backupPanel','usersPanel','auditPanel'].includes(location.hash.slice(1)))showPanel('dashboardPanel');
}
async function loadUsers(){const rows=await api('/api/admin/users');$('userRows').replaceChildren();for(const u of rows){const tr=document.createElement('tr');cell(tr,u.email);cell(tr,roleNames[u.role]);cell(tr,organizations.find(o=>o.id===u.organization_id)?.name||u.organization_id);cell(tr,u.disabled?'已停用':'使用中');const td=cell(tr,'');if(me.role==='owner'&&u.role!=='owner'){const b=document.createElement('button');b.className='secondary';b.textContent='編輯帳號';b.onclick=()=>{const f=$('userForm');f.elements.id.value=u.id;f.elements.email.value=u.email;f.elements.email.disabled=true;f.elements.role.value=u.role;f.elements.organizationId.value=u.organization_id;f.elements.disabled.checked=!!u.disabled;f.elements.password.required=false;f.elements.password.value='';$('userFormTitle').textContent='編輯帳號（變更後會登出該帳號）';f.scrollIntoView({behavior:'smooth'})};td.append(b)}$('userRows').append(tr)}}
async function loadAudit(){const rows=await api('/api/admin/audit');$('auditRows').replaceChildren();for(const r of rows){const tr=document.createElement('tr');cell(tr,new Date(r.at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}));cell(tr,r.actor_email||'歷史紀錄');cell(tr,r.action);cell(tr,organizations.find(o=>o.id===r.organization_id)?.name||(r.organization_id||'歷史／系統'));cell(tr,r.detail);$('auditRows').append(tr)}$('auditCount').textContent='最近 '+rows.length+' 筆 · 台北時間'}
async function loadNotifications(){const d=await api('/api/admin/notifications');$('mailMode').textContent=d.mode==='smtp'?'SMTP 模式':'預覽模式（尚未設定 SMTP）';$('mailRows').replaceChildren();for(const r of d.rows){const tr=document.createElement('tr');cell(tr,r.email);cell(tr,r.subject);cell(tr,r.status);cell(tr,r.attempts);const td=cell(tr,r.last_error||'');if(me.role!=='staff'&&['failed','preview','retry'].includes(r.status)){const b=document.createElement('button');b.textContent='重試';b.onclick=async()=>{try{await post('/api/admin/notifications/'+encodeURIComponent(r.id)+'/retry',{});await loadNotifications();msg('已加入發送佇列')}catch(e){msg(e.message)}};td.append(b)}$('mailRows').append(tr)}}
$('orgContext').onchange=async()=>{try{await post('/api/admin/context',{organizationId:$('orgContext').value});stopScanner();resetEventEditor();$('reportEvent').replaceChildren(new Option('全部活動',''));active=null;$('registrations').replaceChildren();$('selected').textContent='請先選擇活動';await init();msg('已切換組織範圍')}catch(e){msg(e.message)}};
$('orgForm').onsubmit=async e=>{e.preventDefault();const f=e.target;const d=Object.fromEntries(new FormData(f));try{await post(d.id?'/api/organizations/'+encodeURIComponent(d.id):'/api/organizations',d,d.id?'PUT':'POST');f.reset();$('orgFormTitle').textContent='建立組織';await loadGovernance();msg('組織資料已儲存')}catch(e){msg(e.message)}};
$('orgReset').onclick=()=>{$('orgForm').reset();$('orgForm').elements.id.value='';$('orgFormTitle').textContent='建立組織'};
$('userForm').onsubmit=async e=>{e.preventDefault();const f=e.target;const d={email:f.elements.email.value,password:f.elements.password.value,role:f.elements.role.value,organizationId:f.elements.organizationId.value,disabled:f.elements.disabled.checked};if(!d.password)delete d.password;const id=f.elements.id.value;try{await post(id?'/api/admin/users/'+encodeURIComponent(id):'/api/users',d,id?'PUT':'POST');resetUserForm();await loadUsers();await loadAudit();msg('帳號資料已儲存')}catch(e){msg(e.message)}};
function resetUserForm(){const f=$('userForm');f.reset();f.elements.id.value='';f.elements.email.disabled=false;f.elements.password.required=true;$('userFormTitle').textContent='建立帳號'}
$('userReset').onclick=resetUserForm;
$('auditRefresh').onclick=()=>loadAudit().catch(e=>msg(e.message));
$('mailRefresh').onclick=()=>loadNotifications().catch(e=>msg(e.message));
