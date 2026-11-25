export const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
export const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function fieldsValid(fields){
 if(!Array.isArray(fields)||fields.length>30)return false;
 const ids=new Set();
 return fields.every(f=>{
  if(!record(f)||!identifier(f.id)||['__proto__','constructor','prototype'].includes(f.id)||ids.has(f.id)||!text(f.label,100,true)||!['text','textarea','number','date','select','radio','multiselect','consent'].includes(f.type))return false;
  ids.add(f.id);
  if(f.required!==undefined&&typeof f.required!=='boolean'||f.visible!==undefined&&typeof f.visible!=='boolean')return false;
  if(f.hint!==undefined&&!text(f.hint,500)||f.placeholder!==undefined&&!text(f.placeholder,200))return false;
  if(f.validation!==undefined){if(!record(f.validation)||Object.keys(f.validation).some(k=>!['min','max','minLength','maxLength'].includes(k))||Object.entries(f.validation).some(([k,v])=>!Number.isFinite(v)||k.endsWith('Length')&&(!Number.isInteger(v)||v<0||v>500))||f.validation.min!==undefined&&f.validation.max!==undefined&&f.validation.min>f.validation.max||f.validation.minLength!==undefined&&f.validation.maxLength!==undefined&&f.validation.minLength>f.validation.maxLength)return false;}
  if(['select','radio','multiselect'].includes(f.type)&&(!Array.isArray(f.options)||!f.options.length||f.options.length>50||!f.options.every(o=>text(o,100,true))))return false;
  if(f.defaultValue!==undefined){const d=f.defaultValue;if(f.type==='consent'){if(typeof d!=='boolean')return false}else if(f.type==='multiselect'){if(!Array.isArray(d)||d.length>50||!d.every(v=>typeof v==='string'&&f.options.includes(v)))return false}else if(f.type==='number'){if(typeof d!=='string'&&typeof d!=='number'||d!==''&&!Number.isFinite(Number(d)))return false}else if(!text(d,500)||['select','radio'].includes(f.type)&&d!==''&&!f.options.includes(d)||f.type==='date'&&d!==''&&!date(d))return false;}
  return true;
 });
}

// One validator serves event registration and template validation. Historical snapshots remain untouched.
export function validateAnswers(fields,answers={}){
 if(!record(answers))return '自訂欄位資料格式不正確';
 const visible=fields.filter(f=>f.visible!==false);
 if(Object.keys(answers).some(k=>['__proto__','constructor','prototype'].includes(k)||!visible.some(f=>f.id===k)))return '包含未定義的報名欄位';
 for(const f of visible){
  const raw=answers[f.id],rules=f.validation||{};let value;
  if(f.type==='multiselect'){
   if(raw===undefined||raw===''){if(f.required)return '請填寫：'+f.label;continue}
   if(!Array.isArray(raw)||raw.length>50||new Set(raw).size!==raw.length||!raw.every(x=>typeof x==='string'&&f.options?.includes(x)))return '選項不正確：'+f.label;
   if(f.required&&!raw.length)return '請填寫：'+f.label;continue;
  }
  if(f.type==='consent'){
   if(raw!==undefined&&typeof raw!=='boolean')return '請確認同意欄位：'+f.label;
   if(f.required&&raw!==true)return '請勾選同意：'+f.label;continue;
  }
  if(raw!==undefined&&!['string','number'].includes(typeof raw))return '欄位資料格式不正確：'+f.label;
  value=String(raw??'').trim();if(f.required&&!value)return '請填寫：'+f.label;if(!value)continue;
  if(!text(value,500)||value.length<(rules.minLength??0)||value.length>(rules.maxLength??500))return '文字長度不符：'+f.label;
  if(['select','radio'].includes(f.type)&&!f.options?.includes(value))return '選項不正確：'+f.label;
  if(f.type==='number'&&(!Number.isFinite(Number(value))||rules.min!==undefined&&Number(value)<rules.min||rules.max!==undefined&&Number(value)>rules.max))return '數值不符：'+f.label;
  if(f.type==='date'&&!date(value))return '日期不正確：'+f.label;
 }
 return null;
}

export function settingsValid(settings){
 if(!record(settings)||JSON.stringify(settings).length>50000)return false;
 if(settings.system!==undefined){
  if(!record(settings.system)||Object.keys(settings.system).some(k=>!['name','phone','email','participants','notes'].includes(k)))return false;
  for(const [key,value] of Object.entries(settings.system)){
   if(!record(value)||Object.keys(value).some(k=>!['hint','placeholder','defaultValue'].includes(k)))return false;
   if(value.hint!==undefined&&!text(value.hint,500)||value.placeholder!==undefined&&!text(value.placeholder,200))return false;
   if(value.defaultValue!==undefined&&(key==='participants'?!Number.isSafeInteger(Number(value.defaultValue))||Number(value.defaultValue)<1||Number(value.defaultValue)>100:!text(value.defaultValue,key==='notes'?1000:254)))return false;
  }
 }
 return true;
}
