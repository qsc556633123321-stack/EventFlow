
(()=>{
const el=id=>document.getElementById(id),labels={confirmed:'已確認',pending:'待審核',waitlisted:'候補',rejected:'已拒絕',cancelled:'已取消'};
function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
function bars(host,rows){host.replaceChildren();const max=Math.max(1,...rows.map(r=>r[1]));if(!rows.length)host.append(text('p','目前沒有資料'));for(const [label,n] of rows){const row=text('div','');row.className='report-bar';row.append(text('span',label),text('strong',n));const meter=document.createElement('meter');meter.min=0;meter.max=max;meter.value=n;meter.setAttribute('aria-label',label);row.append(meter);host.append(row);}}
window.loadReports=async()=>{try{
 const select=el('reportEvent');if(select.options.length===1){for(const e of await api('/api/admin/events')){const o=text('option',e.title);o.value=e.id;select.append(o);}}
 const q=new URLSearchParams();for(const [key,id] of [['eventId','reportEvent'],['from','reportFrom'],['to','reportTo']])if(el(id).value)q.set(key,el(id).value);
 const d=await api('/api/admin/reports?'+q);el('reportDownloads').replaceChildren();for(const [kind,label] of [['registrations','報名資料 CSV'],['events','活動統計 CSV'],['checkins','簽到紀錄 CSV']]){const a=text('a',label+' ↓');a.href='/api/admin/reports/'+kind+'.csv?'+q;el('reportDownloads').append(a);}
 el('reportMetrics').replaceChildren();for(const [label,value] of [['報名筆數',d.totals.registrations],['報名人數',d.totals.people],['已確認出席人數',d.totals.checkedIn],['出席率',d.totals.attendanceRate===null?'—':d.totals.attendanceRate+'%']]){const card=text('div','');card.className='metric';card.append(text('span',label),text('strong',value));el('reportMetrics').append(card);}
 bars(el('reportTrend'),d.trend.map(x=>[x.day+' · '+x.registrations+' 筆',x.people]));bars(el('reportStatus'),Object.entries(labels).map(([key,label])=>[label,d.totals[key]]));
 const table=document.createElement('table'),head=document.createElement('tr');for(const label of ['活動','報名筆數','已確認','待審核','候補','已出席','出席率'])head.append(text('th',label));table.append(head);for(const e of d.comparison){const tr=document.createElement('tr');for(const v of [e.title,e.registrations,e.confirmed,e.pending,e.waitlisted,e.checkedIn,e.attendanceRate===null?'—':e.attendanceRate+'%'])tr.append(text('td',v));table.append(tr);}el('statsResult').replaceChildren(table);
 }catch(e){el('statsResult').textContent=e.message;el('reportDownloads').replaceChildren();el('reportMetrics').replaceChildren();el('reportTrend').replaceChildren();el('reportStatus').replaceChildren();}};
el('reportFilters').onsubmit=e=>{e.preventDefault();window.loadReports();};
})();
