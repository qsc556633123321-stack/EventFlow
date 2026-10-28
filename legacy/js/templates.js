"use strict";
const EVENT_TEMPLATES = {
  general: {name:"一般活動", fields:[]},
  travel: {name:"旅遊團", fields:[
    {label:"接送地點",type:"select",required:true,options:["台北車站","板橋車站","自行前往"]},
    {label:"飲食需求",type:"text",required:false,options:[]},
    {label:"緊急聯絡人",type:"text",required:true,options:[]}
  ]},
  seminar: {name:"研討會", fields:[
    {label:"公司／單位",type:"text",required:false,options:[]},
    {label:"職稱",type:"text",required:false,options:[]},
    {label:"參加場次",type:"select",required:true,options:["上午場","下午場"]}
  ]},
  course: {name:"課程報名", fields:[
    {label:"學習程度",type:"select",required:true,options:["初學","有基礎","進階"]},
    {label:"學習目標",type:"textarea",required:false,options:[]}
  ]}
};
function templateFields(key) {
  return (EVENT_TEMPLATES[key] || EVENT_TEMPLATES.general).fields.map((field, i) => ({
    ...field, id:"field_" + Date.now().toString(36) + "_" + i + "_" + Math.random().toString(36).slice(2,7), visible:true
  }));
}
