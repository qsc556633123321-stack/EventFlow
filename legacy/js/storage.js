"use strict";
const Storage = {
  eventsKey: "eventflow_events_v12",
  eventKey: "eventflow_event_v1",
  registrationsKey: "eventflow_registrations_v1",
  organizationsKey: "eventflow_organizations_v13",
  auditKey: "eventflow_audit_v13",
  getOrganizations() { try { const v=JSON.parse(localStorage.getItem(this.organizationsKey)); if(Array.isArray(v)) return v; } catch {} return [{id:"org-default",name:"預設主辦單位",email:"",phone:""}]; },
  saveOrganizations(v) { localStorage.setItem(this.organizationsKey,JSON.stringify(v)); },
  getAudit() { try {const v=JSON.parse(localStorage.getItem(this.auditKey));return Array.isArray(v)?v:[];} catch{return [];} },
  audit(action,detail) {const v=this.getAudit();v.unshift({at:new Date().toISOString(),action,detail});localStorage.setItem(this.auditKey,JSON.stringify(v.slice(0,500)));},
  exportBackup() {return {format:"EventFlow",version:13,createdAt:new Date().toISOString(),events:this.getEvents(),registrations:this.getRegistrations(),organizations:this.getOrganizations(),audit:this.getAudit()};},
  restoreBackup(data) {if(!data || data.format!=="EventFlow" || data.version!==13 || !Array.isArray(data.events)||!Array.isArray(data.registrations)||!Array.isArray(data.organizations)||!Array.isArray(data.audit)) throw Error("備份格式不正確"); if(data.events.length>1000||data.registrations.length>100000||data.organizations.length>1000||data.audit.length>50000) throw Error("資料量超過限制"); if(data.events.some(e=>!e||typeof e.id!=="string"||!e.id||typeof e.title!=="string"||!Number.isInteger(Number(e.capacity))||Number(e.capacity)<1)||data.registrations.some(r=>!r||typeof r.id!=="string"||typeof r.eventId!=="string"||!["confirmed","pending","rejected","cancelled"].includes(r.status))||data.organizations.some(o=>!o||typeof o.id!=="string"||typeof o.name!=="string")) throw Error("備份資料內容不正確"); const payload=[[this.eventsKey,data.events],[this.registrationsKey,data.registrations],[this.organizationsKey,data.organizations],[this.auditKey,data.audit]];const old=payload.map(([k])=>[k,localStorage.getItem(k)]);try{for(const [k,v] of payload)localStorage.setItem(k,JSON.stringify(v));}catch(e){for(const [k,v] of old){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}throw e;} },
  getEvents() {
    let events;
    try { events = JSON.parse(localStorage.getItem(this.eventsKey)); } catch {}
    if (!Array.isArray(events)) {
      let legacy;
      try { legacy = JSON.parse(localStorage.getItem(this.eventKey)); } catch {}
      events = [{...DEFAULT_EVENT, ...(legacy && typeof legacy === "object" ? legacy : {})}];
      localStorage.setItem(this.eventsKey, JSON.stringify(events));
    }
    return events.map(e => ({...DEFAULT_EVENT, ...e, customFields: Array.isArray(e.customFields) ? e.customFields : []}));
  },
  getEvent(id) { return this.getEvents().find(e => e.id === id) || null; },
  getDefaultEvent() { return this.getEvent(DEFAULT_EVENT.id) || this.getEvents()[0] || null; },
  saveEvent(event) {
    const events = this.getEvents();
    const i = events.findIndex(e => e.id === event.id);
    if (i < 0) events.push(event); else events[i] = event;
    localStorage.setItem(this.eventsKey, JSON.stringify(events));
  },
  getRegistrations() {
    try { const data = JSON.parse(localStorage.getItem(this.registrationsKey)); return Array.isArray(data) ? data : []; }
    catch { return []; }
  },
  saveRegistrations(data) { localStorage.setItem(this.registrationsKey, JSON.stringify(data)); }
};
