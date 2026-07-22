import { staticSeed } from './static-api-seed.js';

const STORAGE_KEY = 'auction-split-static-api-v4';
const SESSION_KEY = 'auction-split-static-session-v4';
const DEMO_PASSWORDS = {
  'gost@auction.split':'Demo123!',
  'partner@auction.split':'Partner123!',
  'admin@auction.split':'Admin123!',
  'manager@auction.split':'Partner123!',
  'editor@auction.split':'Partner123!',
  'adriatic@auction.split':'Partner123!',
  'host@auction.split':'Partner123!'
};

const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
const clean = value => String(value ?? '').trim();
const emailOf = value => clean(value).toLowerCase();
const listOf = value => (Array.isArray(value) ? value : clean(value).split(/[\n,]+/)).map(clean).filter(Boolean);
const datesOf = value => [...new Set(listOf(value).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item)))].sort();
const numberOf = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function apiError(message, status = 400, code = ''){
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.payload = { error:message, code };
  return error;
}

async function loadSeed(){
  // The seed ships with the app, so a static host cannot leave the demo empty.
  return clone(staticSeed);
}

function isUsableDemoDatabase(value, seed){
  return value?.staticSeedVersion === seed.staticSeedVersion
    && Array.isArray(value.hotels) && value.hotels.length > 0
    && Array.isArray(value.packages) && value.packages.length > 0
    && Array.isArray(value.users) && value.users.length > 0;
}

async function readDb(){
  const seed = await loadSeed();
  try{
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(isUsableDemoDatabase(saved, seed)) return saved;
  }catch{}
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  return seed;
}

function writeDb(db){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function readSession(){
  try{ return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null; }
  catch{ return null; }
}

function writeSession(userId){
  const session = userId ? { userId, csrfToken:uid('csrf'), createdAt:now() } : null;
  if(session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
  return session;
}

function publicUser(user){
  if(!user) return null;
  const { passwordHash, passwordDigest, ...safe } = user;
  return safe;
}

function context(db){
  const session = readSession();
  const user = session ? db.users.find(item => item.id === session.userId && item.status === 'active') : null;
  return { session:user ? session : null, user:user || null };
}

function sessionPayload(db, auth = context(db)){
  return {
    authenticated:Boolean(auth.user),
    user:publicUser(auth.user),
    partner:auth.user?.partnerId ? db.partners.find(item => item.id === auth.user.partnerId) || null : null,
    csrfToken:auth.session?.csrfToken || '',
    transport:'browser-demo'
  };
}

function requireUser(db, options, roles){
  const auth = context(db);
  if(!auth.user) throw apiError('Prijavite se za nastavak.', 401, 'AUTH_REQUIRED');
  if(roles && !roles.includes(auth.user.role)) throw apiError('Nemate ovlasti za ovu radnju.', 403, 'FORBIDDEN');
  const csrf = options.headers?.['x-csrf-token'] || options.headers?.get?.('x-csrf-token');
  if(!csrf || csrf !== auth.session.csrfToken) throw apiError('Sigurnosna sesija je istekla. Osvježite stranicu.', 403, 'CSRF_INVALID');
  return auth.user;
}

function requirePartner(db, options, roles){
  const user = requireUser(db, options, ['partner', 'admin']);
  if(user.role !== 'admin' && !roles.includes(user.partnerRole)){
    throw apiError('Vaša uloga nema ovlasti za ovu partnersku radnju.', 403, 'FORBIDDEN');
  }
  return user;
}

function audit(db, user, action, entityType, entityId, metadata = {}){
  db.auditLog ||= [];
  db.auditLog.unshift({ id:uid('audit'), actorUserId:user?.id || null, action, entityType, entityId, metadata, createdAt:now() });
  db.auditLog = db.auditLog.slice(0, 300);
}

function packageBids(db, packageId){
  return Array.isArray(db.bidsByPackage?.[packageId]) ? db.bidsByPackage[packageId] : [];
}

function highestBid(db, auctionPackage){
  return Math.max(Number(auctionPackage.coldPrice) || 0, ...packageBids(db, auctionPackage.id).map(item => Number(item.amount) || 0));
}

function sanitizedBids(db, packages, user){
  return packages.reduce((result, auctionPackage) => {
    result[auctionPackage.id] = packageBids(db, auctionPackage.id)
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(bid => ({
        id:bid.id,
        amount:bid.amount,
        openingBid:bid.openingBid,
        dates:bid.dates || [],
        duration:bid.duration,
        self:Boolean(user && bid.userId === user.id),
        label:user && bid.userId === user.id ? 'Vi' : 'Gost',
        meta:user && bid.userId === user.id ? 'Vaša ponuda' : 'Anonimni sudionik',
        createdAt:bid.createdAt
      }));
    return result;
  }, {});
}

function publicState(db, user){
  const hotels = db.hotels.filter(item => item.status === 'active');
  const hotelIds = new Set(hotels.map(item => item.id));
  const packages = db.packages.filter(item => item.status === 'active' && item.units > 0 && hotelIds.has(item.hotelId));
  return {
    hotels,
    packages,
    bidsByPackage:sanitizedBids(db, packages, user),
    watchedPackages:user ? db.watchlists[user.id] || [] : [],
    user:publicUser(user),
    serverTime:now(),
    transport:'browser-demo'
  };
}

function accountActivity(db, user){
  const bids = Object.entries(db.bidsByPackage || {}).flatMap(([packageId, entries]) => (entries || [])
    .filter(item => item.userId === user.id)
    .map(item => {
      const auctionPackage = db.packages.find(pkg => pkg.id === packageId);
      const hotel = db.hotels.find(candidate => candidate.id === auctionPackage?.hotelId);
      return { ...item, packageName:auctionPackage?.name || 'Aukcijski paket', hotelName:hotel?.name || 'Smještaj', leading:auctionPackage ? highestBid(db, auctionPackage) === Number(item.amount) : false };
    }));
  bids.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const reservations = db.reservations.filter(item => item.userId === user.id);
  const watchedPackages = (db.watchlists[user.id] || []).map(packageId => {
    const auctionPackage = db.packages.find(item => item.id === packageId);
    const hotel = db.hotels.find(item => item.id === auctionPackage?.hotelId);
    return auctionPackage && hotel ? { package:auctionPackage, hotel } : null;
  }).filter(Boolean);
  return { user:publicUser(user), bids, reservations, watchedPackages, transport:'browser-demo' };
}

function accessibleHotels(db, user){
  return user.role === 'admin' ? db.hotels : db.hotels.filter(item => item.partnerId === user.partnerId);
}

function partnerState(db, user){
  const hotels = accessibleHotels(db, user);
  const hotelIds = new Set(hotels.map(item => item.id));
  const packages = db.packages.filter(item => hotelIds.has(item.hotelId));
  const packageIds = new Set(packages.map(item => item.id));
  const partnerId = user.role === 'admin' ? null : user.partnerId;
  return {
    hotels,
    packages,
    bidsByPackage:sanitizedBids(db, packages, null),
    reservations:db.reservations.filter(item => packageIds.has(item.packageId)),
    team:db.users.filter(item => partnerId ? item.partnerId === partnerId : item.role === 'admin').map(publicUser),
    invitations:db.invitations.filter(item => partnerId ? item.partnerId === partnerId : true),
    partner:user.partnerId ? db.partners.find(item => item.id === user.partnerId) || null : null,
    currentUser:publicUser(user),
    resetAllowed:user.role === 'admin',
    auditLog:(db.auditLog || []).filter(item => user.role === 'admin' || item.actorUserId === user.id).slice(0, 40),
    serverTime:now(),
    transport:'browser-demo'
  };
}

async function passwordDigest(password){
  const bytes = new TextEncoder().encode(String(password));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function passwordMatches(user, password){
  if(user.passwordDigest) return user.passwordDigest === await passwordDigest(password);
  return DEMO_PASSWORDS[user.email] === password;
}

function validPassword(password){
  return String(password).length >= 8 && /[A-Za-zČĆŽŠĐčćžšđ]/.test(password) && /\d/.test(password);
}

function hotelForUser(db, user, hotelId){
  const hotel = db.hotels.find(item => item.id === hotelId);
  if(!hotel) return null;
  return user.role === 'admin' || hotel.partnerId === user.partnerId ? hotel : false;
}

function normalizeHotel(input, existing, partnerId){
  const totalRooms = clamp(Math.round(numberOf(input.totalRooms, existing.totalRooms || 21)), 1, 5000);
  return {
    ...existing,
    id:existing.id || uid('hotel'),
    partnerId:existing.partnerId || partnerId,
    name:clean(input.name || existing.name || 'Novi smještaj').slice(0, 120),
    city:clean(input.city || existing.city || 'Split').slice(0, 80),
    street:clean(input.street || existing.street).slice(0, 180),
    lat:numberOf(input.lat, existing.lat || 43.5081),
    lng:numberOf(input.lng, existing.lng || 16.4402),
    startPrice:clamp(Math.round(numberOf(input.startPrice, existing.startPrice || 50)), 10, 50000),
    duration:clamp(Math.round(numberOf(input.duration, existing.duration || 60)), 15, 1440),
    partnerType:input.partnerType === 'small' ? 'small' : existing.partnerType || 'hotel',
    freeRooms:clamp(Math.round(numberOf(input.freeRooms, existing.freeRooms || 1)), 0, totalRooms),
    totalRooms,
    dates:Object.hasOwn(input, 'dates') ? datesOf(input.dates) : existing.dates || [],
    images:Object.hasOwn(input, 'images') ? listOf(input.images).slice(0, 12) : existing.images || [],
    description:clean(input.description || existing.description).slice(0, 1600),
    amenities:Object.hasOwn(input, 'amenities') ? listOf(input.amenities).slice(0, 30) : existing.amenities || [],
    featured:Boolean(input.featured ?? existing.featured),
    status:['active', 'draft', 'archived'].includes(input.status) ? input.status : existing.status || 'active',
    createdAt:existing.createdAt || now(),
    updatedAt:now()
  };
}

function normalizePackage(input, existing, hotel){
  return {
    ...existing,
    id:existing.id || uid('package'),
    hotelId:hotel.id,
    partnerId:hotel.partnerId,
    name:clean(input.name || existing.name || 'Novi aukcijski paket').slice(0, 120),
    roomType:clean(input.roomType || existing.roomType || 'Standardna soba').slice(0, 120),
    mealPlan:clean(input.mealPlan || existing.mealPlan || 'Bez obroka').slice(0, 120),
    dates:Object.hasOwn(input, 'dates') ? datesOf(input.dates) : existing.dates || [],
    coldPrice:clamp(Math.round(numberOf(input.coldPrice, existing.coldPrice || hotel.startPrice || 50)), 10, 50000),
    duration:clamp(Math.round(numberOf(input.duration, existing.duration || hotel.duration || 60)), 15, 1440),
    units:clamp(Math.round(numberOf(input.units, existing.units ?? hotel.freeRooms ?? 1)), 0, 5000),
    maxGuests:clamp(Math.round(numberOf(input.maxGuests, existing.maxGuests || 2)), 1, 30),
    status:['draft', 'active', 'paused', 'sold_out', 'archived'].includes(input.status) ? input.status : existing.status || 'draft',
    description:clean(input.description || existing.description).slice(0, 1000),
    createdAt:existing.createdAt || now(),
    updatedAt:now()
  };
}

export async function staticApi(path, options = {}){
  const method = String(options.method || 'GET').toUpperCase();
  const route = new URL(path, location.origin).pathname;
  const body = typeof options.body === 'string' ? JSON.parse(options.body || '{}') : options.body || {};
  let db = await readDb();

  if(method === 'GET' && route === '/api/health') return { ok:true, database:'browser', schemaVersion:db.schemaVersion, auth:'ready', transport:'browser-demo' };
  if(method === 'GET' && route === '/api/auth/session') return sessionPayload(db);
  if(method === 'GET' && route === '/api/state') return publicState(db, context(db).user);

  if(method === 'POST' && route === '/api/auth/login'){
    const user = db.users.find(item => item.email === emailOf(body.email) && item.status === 'active');
    if(!user || !await passwordMatches(user, body.password)) throw apiError('E-mail ili lozinka nisu ispravni.', 401, 'INVALID_CREDENTIALS');
    const session = writeSession(user.id);
    audit(db, user, 'auth.login', 'user', user.id);
    writeDb(db);
    return sessionPayload(db, { user, session });
  }

  if(method === 'POST' && route === '/api/auth/register'){
    const email = emailOf(body.email);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw apiError('Unesite ispravnu e-mail adresu.', 422);
    if(!validPassword(body.password)) throw apiError('Lozinka mora imati najmanje 8 znakova, slovo i broj.', 422);
    if(db.users.some(item => item.email === email)) throw apiError('Račun s ovom e-mail adresom već postoji.', 409);
    const invitation = body.invitationToken ? db.invitations.find(item => item.token === body.invitationToken && item.status === 'pending') : null;
    let role = body.accountType === 'partner' ? 'partner' : 'guest';
    let partnerId = null;
    let partnerRole = null;
    if(invitation){
      if(invitation.email !== email) throw apiError('Pozivnica je namijenjena drugoj e-mail adresi.', 422);
      role = 'partner';
      partnerId = invitation.partnerId;
      partnerRole = invitation.role;
      invitation.status = 'accepted';
      invitation.acceptedAt = now();
    }else if(role === 'partner'){
      partnerId = uid('partner');
      partnerRole = 'owner';
    }
    const user = {
      id:uid('user'), name:clean(body.name).slice(0, 100), email, phone:'', role, partnerId, partnerRole,
      passwordDigest:await passwordDigest(body.password), status:'active', createdAt:now(), updatedAt:now()
    };
    db.users.push(user);
    db.watchlists[user.id] = [];
    if(role === 'partner' && !invitation){
      db.partners.push({ id:partnerId, businessName:clean(body.businessName || `${user.name} smještaj`), partnerType:body.partnerType === 'small' ? 'small' : 'hotel', city:clean(body.city || 'Split'), taxId:clean(body.taxId), ownerUserId:user.id, status:'active', createdAt:now() });
    }
    const session = writeSession(user.id);
    audit(db, user, 'auth.register', 'user', user.id, { role });
    writeDb(db);
    return sessionPayload(db, { user, session });
  }

  if(method === 'POST' && route === '/api/auth/forgot-password'){
    const user = db.users.find(item => item.email === emailOf(body.email));
    const token = uid('reset');
    if(user){
      db.passwordResets ||= [];
      db.passwordResets.push({ token, userId:user.id, createdAt:now(), usedAt:null });
      writeDb(db);
    }
    return { message:'Ako račun postoji, upute za promjenu lozinke su pripremljene.', demoResetToken:user ? token : undefined };
  }

  if(method === 'POST' && route === '/api/auth/reset-password'){
    if(!validPassword(body.password)) throw apiError('Lozinka mora imati najmanje 8 znakova, slovo i broj.', 422);
    const reset = (db.passwordResets || []).find(item => item.token === body.token && !item.usedAt);
    const user = reset && db.users.find(item => item.id === reset.userId);
    if(!user) throw apiError('Poveznica za promjenu lozinke nije ispravna ili je istekla.', 422);
    user.passwordDigest = await passwordDigest(body.password);
    reset.usedAt = now();
    writeDb(db);
    return { message:'Nova lozinka je spremljena. Možete se prijaviti.' };
  }

  if(method === 'POST' && route === '/api/auth/logout'){
    requireUser(db, options);
    writeSession(null);
    return { authenticated:false, user:null, partner:null, csrfToken:'', transport:'browser-demo' };
  }

  if(method === 'GET' && route === '/api/account/activity'){
    const user = context(db).user;
    if(!user) throw apiError('Prijavite se za nastavak.', 401, 'AUTH_REQUIRED');
    return accountActivity(db, user);
  }

  if(method === 'PATCH' && route === '/api/account/profile'){
    const user = requireUser(db, options);
    user.name = clean(body.name || user.name).slice(0, 100);
    user.phone = clean(body.phone).slice(0, 40);
    user.updatedAt = now();
    audit(db, user, 'account.updated', 'user', user.id);
    writeDb(db);
    return sessionPayload(db, context(db));
  }

  if(method === 'POST' && route === '/api/account/password'){
    const user = requireUser(db, options);
    if(!await passwordMatches(user, body.currentPassword)) throw apiError('Trenutačna lozinka nije ispravna.', 422);
    if(!validPassword(body.newPassword)) throw apiError('Lozinka mora imati najmanje 8 znakova, slovo i broj.', 422);
    user.passwordDigest = await passwordDigest(body.newPassword);
    user.updatedAt = now();
    audit(db, user, 'account.password_changed', 'user', user.id);
    writeDb(db);
    return { message:'Lozinka je uspješno promijenjena.' };
  }

  if(method === 'POST' && route === '/api/bids'){
    const user = requireUser(db, options, ['guest']);
    const auctionPackage = db.packages.find(item => item.id === body.packageId && item.status === 'active');
    const hotel = db.hotels.find(item => item.id === auctionPackage?.hotelId && item.status === 'active');
    if(!auctionPackage || !hotel) throw apiError('Aktivni aukcijski paket nije pronađen.', 404);
    if(auctionPackage.units < 1) throw apiError('Ovaj paket više nema slobodnih jedinica.', 409);
    const selectedDates = datesOf(body.dates);
    if(!selectedDates.length || selectedDates.some(date => !auctionPackage.dates.includes(date))) throw apiError('Odaberite barem jedan slobodan datum iz paketa.', 422);
    const openingBid = clamp(Math.round(numberOf(body.openingBid, auctionPackage.coldPrice)), 10, 50000);
    const minimum = highestBid(db, auctionPackage) + 5;
    const amount = Math.round(numberOf(body.amount));
    if(amount < minimum || amount > 50000) throw apiError(amount > 50000 ? 'Ponuda ne može biti veća od 50.000 €.' : `Minimalna sljedeća ponuda je ${minimum} €.`, 422);
    const bid = { id:uid('bid'), userId:user.id, packageId:auctionPackage.id, amount, openingBid, dates:selectedDates, duration:clamp(Math.round(numberOf(body.duration, auctionPackage.duration)), 15, 1440), createdAt:now() };
    db.bidsByPackage[auctionPackage.id] ||= [];
    db.bidsByPackage[auctionPackage.id].push(bid);
    audit(db, user, 'auction.bid_placed', 'package', auctionPackage.id, { amount });
    writeDb(db);
    return { bid:{ ...bid, self:true, label:'Vi', meta:'Vaša ponuda' }, state:publicState(db, user) };
  }

  if(method === 'POST' && route === '/api/watch'){
    const user = requireUser(db, options, ['guest']);
    if(!db.packages.some(item => item.id === body.packageId && item.status === 'active')) throw apiError('Aukcijski paket nije pronađen.', 404);
    const watchlist = new Set(db.watchlists[user.id] || []);
    body.watching ? watchlist.add(body.packageId) : watchlist.delete(body.packageId);
    db.watchlists[user.id] = [...watchlist];
    writeDb(db);
    return publicState(db, user);
  }

  if(method === 'POST' && ['/api/reservations', '/api/confirms'].includes(route)){
    const user = requireUser(db, options, ['guest']);
    const auctionPackage = db.packages.find(item => item.id === body.packageId);
    const hotel = db.hotels.find(item => item.id === auctionPackage?.hotelId);
    if(!auctionPackage || !hotel) throw apiError('Aukcijski paket nije pronađen.', 404);
    const winningAmount = highestBid(db, auctionPackage);
    const winningBid = packageBids(db, auctionPackage.id).find(item => item.userId === user.id && Number(item.amount) === winningAmount);
    if(!winningBid) throw apiError('Rezervaciju može potvrditi samo korisnik s vodećom ponudom.', 409);
    if(db.reservations.some(item => item.userId === user.id && item.packageId === auctionPackage.id && item.status !== 'cancelled')) throw apiError('Ova pobjednička rezervacija već je potvrđena.', 409);
    if(auctionPackage.units < 1) throw apiError('Paket više nema slobodnih jedinica.', 409);
    const reservation = {
      id:uid('reservation'), bookingCode:`AS-${crypto.randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`,
      userId:user.id, packageId:auctionPackage.id, hotelId:hotel.id, name:user.name, email:user.email,
      card:clean(body.card || 'Demo autorizacija').slice(0, 80), hotel:hotel.name, packageName:auctionPackage.name,
      dates:winningBid.dates.join(', '), amount:winningAmount, status:'confirmed', paymentStatus:'demo_authorized', createdAt:now()
    };
    db.reservations.unshift(reservation);
    auctionPackage.units -= 1;
    if(auctionPackage.units === 0) auctionPackage.status = 'sold_out';
    audit(db, user, 'reservation.confirmed', 'reservation', reservation.id, { amount:reservation.amount });
    writeDb(db);
    return { confirmation:reservation, reservation, state:publicState(db, user) };
  }

  const reservationMatch = route.match(/^\/api\/reservations\/([^/]+)$/);
  if(method === 'PATCH' && reservationMatch){
    const user = requireUser(db, options);
    const reservation = db.reservations.find(item => item.id === decodeURIComponent(reservationMatch[1]));
    const auctionPackage = db.packages.find(item => item.id === reservation?.packageId);
    const hotel = db.hotels.find(item => item.id === reservation?.hotelId);
    if(!reservation || !auctionPackage || !hotel) throw apiError('Rezervacija nije pronađena.', 404);
    const guestOwns = user.role === 'guest' && reservation.userId === user.id;
    const partnerOwns = ['partner', 'admin'].includes(user.role) && (user.role === 'admin' || hotel.partnerId === user.partnerId);
    if(!guestOwns && !partnerOwns) throw apiError('Nemate ovlasti za ovu rezervaciju.', 403, 'FORBIDDEN');
    const nextStatus = clean(body.status || reservation.status);
    if(!['confirmed', 'checked_in', 'completed', 'cancelled'].includes(nextStatus) || (guestOwns && nextStatus !== 'cancelled')) throw apiError('Odabrani status rezervacije nije dopušten.', 422);
    if(user.role === 'partner' && !['owner', 'manager'].includes(user.partnerRole)) throw apiError('Vaša uloga nema ovlasti mijenjati rezervacije.', 403, 'FORBIDDEN');
    if(reservation.status !== 'cancelled' && nextStatus === 'cancelled'){
      auctionPackage.units += 1;
      if(auctionPackage.status === 'sold_out') auctionPackage.status = 'active';
    }else if(reservation.status === 'cancelled' && nextStatus !== 'cancelled'){
      if(auctionPackage.units < 1) throw apiError('Paket više nema slobodnih jedinica za ponovno aktiviranje rezervacije.', 409);
      auctionPackage.units -= 1;
      if(auctionPackage.units === 0) auctionPackage.status = 'sold_out';
    }
    reservation.status = nextStatus;
    if(partnerOwns && ['demo_authorized', 'paid', 'refunded'].includes(body.paymentStatus)) reservation.paymentStatus = body.paymentStatus;
    reservation.updatedAt = now();
    audit(db, user, 'reservation.updated', 'reservation', reservation.id, { status:reservation.status, paymentStatus:reservation.paymentStatus });
    writeDb(db);
    return user.role === 'guest' ? accountActivity(db, user) : partnerState(db, user);
  }

  if(method === 'GET' && route === '/api/partner/state'){
    const user = context(db).user;
    if(!user) throw apiError('Prijavite se za nastavak.', 401, 'AUTH_REQUIRED');
    if(!['partner', 'admin'].includes(user.role)) throw apiError('Partner centar nije dostupan gostujućem računu.', 403, 'FORBIDDEN');
    return partnerState(db, user);
  }

  if(method === 'POST' && route === '/api/hotels'){
    const user = requirePartner(db, options, ['owner', 'manager', 'editor']);
    const partnerId = user.role === 'admin' ? clean(body.partnerId || db.partners[0]?.id) : user.partnerId;
    const hotel = normalizeHotel(body, {}, partnerId);
    db.hotels.push(hotel);
    audit(db, user, 'hotel.created', 'hotel', hotel.id);
    writeDb(db);
    return { hotel, state:partnerState(db, user) };
  }

  const hotelMatch = route.match(/^\/api\/hotels\/([^/]+)$/);
  if(hotelMatch && ['PUT', 'DELETE'].includes(method)){
    const user = requirePartner(db, options, method === 'DELETE' ? ['owner', 'manager'] : ['owner', 'manager', 'editor']);
    const hotel = hotelForUser(db, user, decodeURIComponent(hotelMatch[1]));
    if(hotel === false) throw apiError('Ne možete uređivati tuđi smještaj.', 403, 'FORBIDDEN');
    if(!hotel) throw apiError('Smještaj nije pronađen.', 404);
    if(method === 'DELETE'){
      const packageIds = db.packages.filter(item => item.hotelId === hotel.id).map(item => item.id);
      if(packageIds.some(id => packageBids(db, id).length) || db.reservations.some(item => packageIds.includes(item.packageId))) throw apiError('Smještaj s ponudama ili rezervacijama nije moguće obrisati.', 409);
      db.hotels = db.hotels.filter(item => item.id !== hotel.id);
      db.packages = db.packages.filter(item => item.hotelId !== hotel.id);
    }else Object.assign(hotel, normalizeHotel(body, hotel, hotel.partnerId));
    writeDb(db);
    return method === 'DELETE' ? partnerState(db, user) : { hotel, state:partnerState(db, user) };
  }

  if(method === 'POST' && route === '/api/packages'){
    const user = requirePartner(db, options, ['owner', 'manager', 'editor']);
    const hotel = hotelForUser(db, user, body.hotelId);
    if(hotel === false) throw apiError('Ne možete dodati paket tuđem smještaju.', 403, 'FORBIDDEN');
    if(!hotel) throw apiError('Smještaj nije pronađen.', 404);
    const auctionPackage = normalizePackage(body, {}, hotel);
    if(!auctionPackage.dates.length) throw apiError('Dodajte barem jedan raspoloživi datum.', 422);
    db.packages.push(auctionPackage);
    db.bidsByPackage[auctionPackage.id] = [];
    writeDb(db);
    return { package:auctionPackage, state:partnerState(db, user) };
  }

  const packageMatch = route.match(/^\/api\/packages\/([^/]+)$/);
  if(packageMatch && ['PUT', 'DELETE'].includes(method)){
    const user = requirePartner(db, options, method === 'DELETE' ? ['owner', 'manager'] : ['owner', 'manager', 'editor']);
    const auctionPackage = db.packages.find(item => item.id === decodeURIComponent(packageMatch[1]));
    const hotel = auctionPackage && hotelForUser(db, user, auctionPackage.hotelId);
    if(hotel === false) throw apiError('Ne možete uređivati tuđi paket.', 403, 'FORBIDDEN');
    if(!auctionPackage || !hotel) throw apiError('Aukcijski paket nije pronađen.', 404);
    if(method === 'DELETE'){
      if(packageBids(db, auctionPackage.id).length || db.reservations.some(item => item.packageId === auctionPackage.id)) throw apiError('Paket s ponudama ili rezervacijama nije moguće obrisati.', 409);
      db.packages = db.packages.filter(item => item.id !== auctionPackage.id);
      delete db.bidsByPackage[auctionPackage.id];
    }else Object.assign(auctionPackage, normalizePackage(body, auctionPackage, hotel));
    writeDb(db);
    return method === 'DELETE' ? partnerState(db, user) : { package:auctionPackage, state:partnerState(db, user) };
  }

  if(method === 'POST' && ['/api/team/invitations', '/api/admins'].includes(route)){
    const user = requirePartner(db, options, ['owner', 'manager']);
    const email = emailOf(body.email);
    if(!email) throw apiError('Unesite e-mail člana tima.', 422);
    const token = uid('invite');
    const invitation = { id:uid('invitation'), name:clean(body.name).slice(0, 100), email, phone:clean(body.phone).slice(0, 40), role:['manager', 'editor', 'viewer'].includes(body.role) ? body.role : 'viewer', partnerId:user.role === 'admin' ? clean(body.partnerId || db.partners[0]?.id) : user.partnerId, invitedByUserId:user.id, status:'pending', token, createdAt:now(), expiresAt:new Date(Date.now() + 7 * 86400000).toISOString() };
    db.invitations.unshift(invitation);
    writeDb(db);
    return { invitation:{ ...invitation, demoInvitationToken:token }, state:partnerState(db, user) };
  }

  const inviteMatch = route.match(/^\/api\/team\/invitations\/([^/]+)$/);
  if(method === 'DELETE' && inviteMatch){
    const user = requirePartner(db, options, ['owner', 'manager']);
    const invitation = db.invitations.find(item => item.id === decodeURIComponent(inviteMatch[1]));
    if(!invitation) throw apiError('Pozivnica nije pronađena.', 404);
    if(user.role !== 'admin' && invitation.partnerId !== user.partnerId) throw apiError('Nemate ovlasti za ovu pozivnicu.', 403, 'FORBIDDEN');
    invitation.status = 'revoked';
    invitation.revokedAt = now();
    writeDb(db);
    return partnerState(db, user);
  }

  if(method === 'POST' && route === '/api/reset'){
    const user = requireUser(db, options, ['admin']);
    db = await loadSeed();
    const admin = db.users.find(item => item.email === user.email && item.role === 'admin');
    writeDb(db);
    const session = writeSession(admin.id);
    return { ...partnerState(db, admin), session:sessionPayload(db, { user:admin, session }) };
  }

  throw apiError('API ruta nije pronađena.', 404, 'NOT_FOUND');
}
