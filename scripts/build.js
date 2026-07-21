const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { extname, join, resolve } = require('node:path');
const { migrateDatabase } = require('./server/database');

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

const sourceSeed = JSON.parse(readFileSync(resolve('data/seed-db.json'), 'utf8'));
const staticSeed = migrateDatabase(sourceSeed);
staticSeed.staticSeedVersion = 4;
staticSeed.users = staticSeed.users.map(({ passwordHash, ...user }) => user);
staticSeed.sessions = [];
staticSeed.passwordResets = [];
writeFileSync(resolve(dist, 'assets/static-api-seed.json'), `${JSON.stringify(staticSeed, null, 2)}\n`);

const basePath = String(process.env.BASE_PATH || '').replace(/\/$/, '');
if(basePath){
  const appPathPattern = /(["'`])\/(?=(?:assets\/|src\/|vendor\/|output\/|favicon\.svg|index\.html|demo\.html|account\.html|partner\.html|koncept\.html|brosura-korisnici\.html|brosura-partneri\.html|["'`]))/g;
  const rewriteDirectory = directory => {
    readdirSync(directory).forEach(name => {
      const filePath = join(directory, name);
      if(statSync(filePath).isDirectory()){
        rewriteDirectory(filePath);
        return;
      }
      if(!['.html', '.js', '.json', '.css'].includes(extname(filePath))) return;
      const source = readFileSync(filePath, 'utf8');
      writeFileSync(filePath, source.replace(appPathPattern, `$1${basePath}/`));
    });
  };
  rewriteDirectory(dist);
}

writeFileSync(resolve(dist, '.nojekyll'), '');
console.log('Built static project into dist/');
