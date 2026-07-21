const { cpSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');

const dist = resolve('dist');

if(existsSync(dist)){
  rmSync(dist, {recursive:true, force:true});
}

mkdirSync(dist, {recursive:true});
readdirSync(resolve('.'))
  .filter(file => file.endsWith('.html'))
  .forEach(file => cpSync(resolve(file), resolve(dist, file)));
cpSync(resolve('src'), resolve(dist, 'src'), {recursive:true});
if(existsSync(resolve('assets'))){
  cpSync(resolve('assets'), resolve(dist, 'assets'), {recursive:true});
}
if(existsSync(resolve('vendor'))){
  cpSync(resolve('vendor'), resolve(dist, 'vendor'), {recursive:true});
}
if(existsSync(resolve('output'))){
  cpSync(resolve('output'), resolve(dist, 'output'), {recursive:true});
}
console.log('Built static project into dist/');
