const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { extname, join, resolve } = require('node:path');

function assert(condition, message){
  if(!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

execFileSync(process.execPath, ['scripts/build.js'], {
  cwd:resolve('.'),
  env:{ ...process.env, BASE_PATH:'/split.auction' },
  stdio:'inherit'
});

const dist = resolve('dist');
assert(!existsSync(join(dist, 'assets', 'static-api-seed.json')), 'statički seed nije dio produkcijskog builda');
assert(!existsSync(join(dist, 'src', 'static-api.js')) && !existsSync(join(dist, 'src', 'static-api-seed.js')), 'browser API adapter nije dio produkcijskog builda');
const sharedApi = readFileSync(join(dist, 'src', 'shared.js'), 'utf8');
assert(!sharedApi.includes('static-api.js') && !sharedApi.includes('browser-demo'), 'aplikacija koristi samo serverski API');
assert(existsSync(join(dist, 'output', 'pdf', 'auction-split-brosura.pdf')), 'PDF brošura je uključena u javni build');
assert(existsSync(join(dist, '.nojekyll')), 'GitHub Pages marker');
assert(!existsSync(join(dist, 'data')) && !existsSync(join(dist, 'scripts')), 'serverski podaci nisu u statičkom buildu');

const files = [];
function collect(directory){
  readdirSync(directory).forEach(name => {
    const filePath = join(directory, name);
    if(statSync(filePath).isDirectory()) collect(filePath);
    else if(['.html', '.js', '.json', '.css'].includes(extname(filePath))) files.push(filePath);
  });
}
collect(dist);

const unprefixedPath = /["'`]\/(?:assets\/|src\/|vendor\/|output\/|favicon\.svg|demo\.html|partner\.html|account\.html|superadmin\.html|koncept\.html|brosura-)/;
const offending = files.filter(file => unprefixedPath.test(readFileSync(file, 'utf8')));
assert(offending.length === 0, 'sve aplikacijske putanje podržavaju Pages podputanju');
console.log('Static production build suite passed.');
