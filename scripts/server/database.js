const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} = require('node:fs');
const { join, resolve } = require('node:path');

const projectRoot = resolve(__dirname, '../..');
const seedDir = join(projectRoot, 'data');
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(projectRoot, 'data');
const seedPath = join(seedDir, 'seed-db.json');
const authSeedPath = join(seedDir, 'auth-seed.json');
const dbPath = join(dataDir, 'demo-db.json');
const databaseUrl = process.env.DATABASE_URL || '';
let postgresClient;

function usesPostgres(){
  return Boolean(databaseUrl);
}

function sql(){
  if(!usesPostgres()) return null;
  if(!postgresClient){
    const postgres = require('postgres');
    postgresClient = postgres(databaseUrl, {
      max:1,
      prepare:false,
      idle_timeout:20,
      connect_timeout:15
    });
  }
  return postgresClient;
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath){
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function defaultPackages(hotel){
  const base = {
    id:`pkg-${hotel.id}`,
    hotelId:hotel.id,
    partnerId:hotel.partnerId || 'partner-demo',
    name:'Fleksibilna soba',
    roomType:hotel.partnerType === 'small' ? 'Cijeli apartman' : 'Standardna dvokrevetna soba',
    mealPlan:hotel.partnerType === 'small' ? 'Bez obroka' : 'Doručak uključen',
    dates:Array.isArray(hotel.dates) ? hotel.dates : [],
    coldPrice:Number(hotel.startPrice) || 50,
    duration:Number(hotel.duration) || 60,
    units:Number(hotel.freeRooms) || 1,
    maxGuests:hotel.partnerType === 'small' ? 4 : 2,
    status:'active',
    description:'Paket slobodnog kapaciteta spreman za aukciju.',
    createdAt:'2026-07-07T08:00:00.000Z',
    updatedAt:'2026-07-07T08:00:00.000Z'
  };
  const packages = [base];
  if((hotel.dates || []).length >= 4){
    packages.push({
      ...base,
      id:`pkg-${hotel.id}-last-minute`,
      name:hotel.partnerType === 'small' ? 'Last minute cijeli smještaj' : 'Last minute s doručkom',
      roomType:hotel.partnerType === 'small' ? 'Cijeli smještaj' : 'Comfort dvokrevetna soba',
      dates:hotel.dates.slice(-3),
      coldPrice:Math.max(10, Math.round((Number(hotel.startPrice) || 50) * 1.1)),
      duration:[30, 60, 120, 180][packages.length % 4],
      units:Math.max(1, Math.ceil((Number(hotel.freeRooms) || 1) / 2)),
      description:'Kraći prodajni prozor za termine koji bi inače ostali nepopunjeni.'
    });
  }
  if(hotel.featured){
    packages.push({
      ...base,
      id:`pkg-${hotel.id}-premium`,
      name:'Premium paket u pripremi',
      roomType:hotel.partnerType === 'small' ? 'Cijeli smještaj s kasnom odjavom' : 'Superior soba',
      mealPlan:hotel.partnerType === 'small' ? 'Košarica dobrodošlice' : 'Polupansion',
      dates:hotel.dates.slice(0, 2),
      coldPrice:Math.max(10, Math.round((Number(hotel.startPrice) || 50) * 1.35)),
      duration:240,
      units:Math.max(1, Math.floor((Number(hotel.freeRooms) || 1) / 3)),
      status:'draft',
      description:'Primjer paketa koji partner još uređuje prije objave gostima.'
    });
  }
  return packages;
}

function migrateDatabase(input){
  const db = input && typeof input === 'object' ? input : {};
  const authSeed = existsSync(authSeedPath) ? readJson(authSeedPath) : {};

  db.schemaVersion = 2;
  db.hotels = Array.isArray(db.hotels) ? db.hotels : [];
  db.users = Array.isArray(db.users) && db.users.length ? db.users : clone(authSeed.users || []);
  db.partners = Array.isArray(db.partners) && db.partners.length ? db.partners : clone(authSeed.partners || []);
  db.sessions = Array.isArray(db.sessions) ? db.sessions : [];
  db.passwordResets = Array.isArray(db.passwordResets) ? db.passwordResets : [];
  db.invitations = Array.isArray(db.invitations) ? db.invitations : [];
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];

  db.hotels = db.hotels.map(hotel => {
    const images = Array.isArray(hotel.images) ? hotel.images.filter(Boolean).slice(0, 20) : [];
    const gallery = [...images];
    for(let index = gallery.length; index < 20; index += 1){
      gallery.push(`https://picsum.photos/seed/${encodeURIComponent(hotel.id || hotel.name || 'auction-split')}-gallery-${index + 1}/1200/760`);
    }
    return {
      ...hotel,
      images:gallery,
      partnerId:hotel.partnerId || 'partner-demo',
      status:hotel.status || 'active'
    };
  });

  db.packages = Array.isArray(db.packages) && db.packages.length
    ? db.packages
    : db.hotels.flatMap(defaultPackages);

  db.bidsByPackage = db.bidsByPackage && typeof db.bidsByPackage === 'object'
    ? db.bidsByPackage
    : {};
  if(Object.keys(db.bidsByPackage).length === 0 && db.bidsByHotel){
    db.hotels.forEach(hotel => {
      const packageId = `pkg-${hotel.id}`;
      const legacyBids = Array.isArray(db.bidsByHotel[hotel.id]) ? db.bidsByHotel[hotel.id] : [];
      db.bidsByPackage[packageId] = legacyBids.map(bid => ({
        ...bid,
        userId:bid.userId || (bid.self ? 'user-guest-demo' : null),
        packageId,
        openingBid:Number(bid.openingBid) || Number(bid.amount) || Number(hotel.startPrice) || 0
      }));
    });
  }

  db.watchlists = db.watchlists && typeof db.watchlists === 'object' ? db.watchlists : {};
  if(!db.watchlists['user-guest-demo']){
    db.watchlists['user-guest-demo'] = (Array.isArray(db.watchedHotels) ? db.watchedHotels : [])
      .map(hotelId => `pkg-${hotelId}`);
  }

  db.reservations = Array.isArray(db.reservations) ? db.reservations : [];
  if(db.reservations.length === 0 && Array.isArray(db.confirms)){
    db.reservations = db.confirms.map(confirm => ({
      ...confirm,
      userId:confirm.userId || 'legacy-guest-record',
      packageId:confirm.packageId || `pkg-${confirm.hotelId}`,
      status:confirm.status || 'confirmed',
      paymentStatus:confirm.paymentStatus || 'demo_authorized',
      bookingCode:confirm.bookingCode || `AS-${String(confirm.id || '').slice(-6).toUpperCase()}`
    }));
  }

  return db;
}

function writeFileDatabase(db){
  mkdirSync(dataDir, { recursive:true });
  const temporaryPath = `${dbPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(db, null, 2)}\n`, { mode:0o600 });
  renameSync(temporaryPath, dbPath);
}

async function writeDatabase(db){
  if(!usesPostgres()){
    writeFileDatabase(db);
    return db;
  }
  const client = sql();
  await client`
    INSERT INTO auction_split_state (id, payload, updated_at)
    VALUES ('primary', ${client.json(db)}, now())
    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
  `;
  return db;
}

function resetFileDatabase(){
  mkdirSync(dataDir, { recursive:true });
  const seed = readJson(seedPath);
  const db = migrateDatabase(seed);
  writeFileDatabase(db);
  return db;
}

async function resetDatabase(){
  if(!usesPostgres()) return resetFileDatabase();
  const db = migrateDatabase(readJson(seedPath));
  await writeDatabase(db);
  return db;
}

function ensureFileDatabase(){
  mkdirSync(dataDir, { recursive:true });
  if(!existsSync(dbPath)){
    return resetFileDatabase();
  }
  const original = readJson(dbPath);
  const before = JSON.stringify(original);
  const migrated = migrateDatabase(original);
  if(JSON.stringify(migrated) !== before) writeFileDatabase(migrated);
  return migrated;
}

async function ensureDatabase(){
  if(!usesPostgres()) return ensureFileDatabase();
  const client = sql();
  await client`
    CREATE TABLE IF NOT EXISTS auction_split_state (
      id text PRIMARY KEY,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const rows = await client`SELECT payload FROM auction_split_state WHERE id = 'primary'`;
  if(!rows.length) return resetDatabase();
  const original = rows[0].payload;
  const before = JSON.stringify(original);
  const migrated = migrateDatabase(original);
  if(JSON.stringify(migrated) !== before) await writeDatabase(migrated);
  return migrated;
}

async function readDatabase(){
  return ensureDatabase();
}

module.exports = {
  authSeedPath,
  dbPath,
  ensureDatabase,
  migrateDatabase,
  readDatabase,
  resetDatabase,
  usesPostgres,
  writeDatabase
};
