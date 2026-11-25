import {EventEmitter} from 'node:events';
export const platformEvents=new EventEmitter();
platformEvents.setMaxListeners(32);
