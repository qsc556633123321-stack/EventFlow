import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {spawnSync} from 'node:child_process';
const root=process.cwd();let count=0;
for(const dir of ['modules','public','scripts','test'])for(const name of fs.readdirSync(path.join(root,dir))){
 const file=path.join(root,dir,name);
 if(/\.(js|mjs)$/.test(name)){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status){process.stderr.write(result.stderr);process.exit(1)}count++;}
 if(name.endsWith('.html')){const html=fs.readFileSync(file,'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);if(new Set(ids).size!==ids.length)throw Error('Duplicate id in '+file);for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);count++;}
}
const result=spawnSync(process.execPath,['--check','server.js'],{encoding:'utf8'});if(result.status)throw Error(result.stderr);console.log('Syntax and HTML identifier checks passed ('+(count+1)+' files).');
