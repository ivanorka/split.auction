const { spawn } = require('node:child_process');
const http = require('node:http');

const port = Number(process.env.TEST_PORT || 5199);
const host = '127.0.0.1';
const baseOptions = { host, port };
let server;

function request(method, path, body, cookie = '', csrf = ''){
  return new Promise((resolve, reject) => {
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const headers = {};
    if(rawBody) headers['content-type'] = 'application/json';
    if(cookie) headers.cookie = cookie;
    if(csrf) headers['x-csrf-token'] = csrf;
    const req = http.request({ ...baseOptions, method, path, headers }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let json = {};
        try{ json = raw ? JSON.parse(raw) : {}; }
        catch{ json = { raw }; }
        resolve({
          status:res.statusCode,
          body:json,
          cookie:String(res.headers['set-cookie']?.[0] || '').split(';')[0]
        });
      });
    });
    req.on('error', reject);
    if(rawBody) req.write(rawBody);
    req.end();
  });
}

function assert(condition, message){
  if(!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function waitForServer(){
  for(let attempt = 0; attempt < 40; attempt += 1){
    try{
      const health = await request('GET', '/api/health');
      if(health.status === 200) return health;
    }catch{}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server se nije pokrenuo.');
}

async function login(email, password){
  const response = await request('POST', '/api/auth/login', { email, password });
  assert(response.status === 200, `prijava ${email}`);
  return { cookie:response.cookie, csrf:response.body.csrfToken, user:response.body.user };
}

async function resetWithAdmin(){
  let admin = await login('admin@auction.split', 'Admin123!');
  const reset = await request('POST', '/api/reset', {}, admin.cookie, admin.csrf);
  assert(reset.status === 200 && reset.body.hotels.length === 16, 'admin reset demo baze');
}

async function run(){
  server = spawn(process.execPath, ['scripts/dev-server.js'], {
    cwd:process.cwd(),
    env:{ ...process.env, PORT:String(port) },
    stdio:['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', chunk => process.stderr.write(chunk));

  const health = await waitForServer();
  assert(health.body.auth === 'ready' && health.body.schemaVersion === 2, 'health i auth schema');
  await resetWithAdmin();

  const guest = await login('gost@auction.split', 'Demo123!');
  assert(guest.user.role === 'guest', 'gostujuća uloga');
  const state = await request('GET', '/api/state', undefined, guest.cookie);
  assert(state.status === 200 && state.body.packages.length === 32, 'javni paketni katalog');
  const forbiddenPartner = await request('GET', '/api/partner/state', undefined, guest.cookie);
  assert(forbiddenPartner.status === 403, 'gost ne može u Partner centar');
  const missingCsrf = await request('POST', '/api/watch', { packageId:'pkg-st-marjan-demo', watching:true }, guest.cookie);
  assert(missingCsrf.status === 403, 'CSRF zaštita mutacija');

  const bid = await request('POST', '/api/bids', {
    packageId:'pkg-st-marjan-demo',
    amount:85,
    openingBid:40,
    dates:['2026-08-02'],
    duration:60
  }, guest.cookie, guest.csrf);
  assert(bid.status === 201 && bid.body.bid.amount === 85, 'autorizirana ponuda');
  const reservation = await request('POST', '/api/reservations', {
    packageId:'pkg-st-marjan-demo',
    card:'Demo Visa ···· 4242'
  }, guest.cookie, guest.csrf);
  assert(reservation.status === 201 && reservation.body.reservation.bookingCode.startsWith('AS-'), 'potvrda vodeće ponude');
  const activity = await request('GET', '/api/account/activity', undefined, guest.cookie);
  assert(activity.body.reservations.length === 1 && activity.body.bids.length >= 2, 'korisnički račun i aktivnost');
  const cancelled = await request('PATCH', `/api/reservations/${reservation.body.reservation.id}`, { status:'cancelled' }, guest.cookie, guest.csrf);
  assert(cancelled.status === 200 && cancelled.body.reservations[0].status === 'cancelled', 'gost otkazuje rezervaciju');
  const restoredState = await request('GET', '/api/state', undefined, guest.cookie);
  assert(restoredState.body.packages.find(item => item.id === 'pkg-st-bacvice-apartment').units === 2, 'otkazivanje vraća jedinicu u inventar');

  const partner = await login('partner@auction.split', 'Partner123!');
  const partnerState = await request('GET', '/api/partner/state', undefined, partner.cookie);
  assert(partnerState.status === 200 && partnerState.body.hotels.length === 6 && partnerState.body.packages.length === 14, 'partnersko vlasništvo portfolija');
  const createdHotel = await request('POST', '/api/hotels', {
    name:'API Test Hotel', city:'Split', street:'Test 1', partnerType:'hotel', totalRooms:10
  }, partner.cookie, partner.csrf);
  assert(createdHotel.status === 201, 'partnersko stvaranje smještaja');
  const hotelId = createdHotel.body.hotel.id;
  const createdPackage = await request('POST', '/api/packages', {
    hotelId,
    name:'API Test Paket',
    roomType:'Standardna soba',
    mealPlan:'Doručak',
    dates:['2026-08-30'],
    coldPrice:60,
    duration:120,
    units:2,
    maxGuests:2,
    status:'active'
  }, partner.cookie, partner.csrf);
  assert(createdPackage.status === 201, 'partnersko stvaranje paketa');
  const packageId = createdPackage.body.package.id;
  assert((await request('DELETE', `/api/packages/${encodeURIComponent(packageId)}`, {}, partner.cookie, partner.csrf)).status === 200, 'brisanje paketa bez aktivnosti');
  assert((await request('DELETE', `/api/hotels/${encodeURIComponent(hotelId)}`, {}, partner.cookie, partner.csrf)).status === 200, 'brisanje smještaja bez aktivnosti');

  const blockedData = await request('GET', '/data/demo-db.json');
  assert(blockedData.status === 404, 'baza nije dostupna statički');

  await resetWithAdmin();
}

run()
  .then(() => console.log('API integration suite passed.'))
  .catch(error => {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if(server) server.kill('SIGTERM');
  });
