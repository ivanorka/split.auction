const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { migrateDatabase } = require('./server/database');

function createStaticSeed(){
  const sourceSeed = JSON.parse(readFileSync(resolve('data/seed-db.json'), 'utf8'));
  const staticSeed = migrateDatabase(sourceSeed);
  staticSeed.staticSeedVersion = 4;
  staticSeed.users = staticSeed.users.map(({ passwordHash, passwordDigest, ...user }) => user);
  staticSeed.sessions = [];
  staticSeed.passwordResets = [];
  return staticSeed;
}

function writeStaticSeed(){
  const staticSeed = createStaticSeed();
  const serialized = JSON.stringify(staticSeed, null, 2);
  mkdirSync(resolve('assets'), { recursive:true });
  writeFileSync(resolve('assets/static-api-seed.json'), `${serialized}\n`);
  writeFileSync(resolve('src/static-api-seed.js'), `// Generated from data/seed-db.json. Do not edit manually.\nexport const staticSeed = ${serialized};\n`);
  return staticSeed;
}

if(require.main === module){
  writeStaticSeed();
  console.log('Generated static demo seed.');
}

module.exports = { createStaticSeed, writeStaticSeed };
