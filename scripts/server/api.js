const { randomUUID } = require('node:crypto');
const {
  createToken,
  expiredSessionCookie,
  hashPassword,
  hashToken,
  normalizeEmail,
  passwordValidation,
  publicUser,
  SESSION_TTL_SECONDS,
  sessionCookie,
  sessionTokenFromRequest,
  validEmail,
  verifyPassword
} = require('./security');
const {
  readDatabase,
  resetDatabase,
  writeDatabase
} = require('./database');
const { createCheckoutSession, paymentConfiguration } = require('./payments');
const { notify, notifyMany } = require('./notifications');

const authAttempts = new Map();
const allowedPartnerRoles = new Set(['owner', 'manager', 'editor', 'viewer']);
const allowedPackageStatuses = new Set(['draft', 'active', 'paused', 'sold_out', 'archived']);
const manageableRoles = new Set(['guest', 'partner', 'admin']);
const manageableUserStatuses = new Set(['active', 'deactivated', 'suspended']);

function securityHeaders(){
  return {
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'referrer-policy':'same-origin',
    'permissions-policy':'geolocation=()',
    'content-security-policy':"frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  };
}

function sendJson(res, status, body, headers = {}){
  res.writeHead(status, {
    ...securityHeaders(),
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function readBody(req){
  return new Promise((resolveBody, rejectBody) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if(raw.length > 1_000_000){
        rejectBody(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if(!raw){
        resolveBody({});
        return;
      }
      try{ resolveBody(JSON.parse(raw)); }
      catch(error){ rejectBody(error); }
    });
    req.on('error', rejectBody);
  });
}

function asString(value, fallback = ''){
  return String(value ?? fallback).trim();
}

function asNumber(value, fallback = 0){
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(number, min, max){
  return Math.max(min, Math.min(max, number));
}

function asList(value){
  if(Array.isArray(value)) return value.map(item => asString(item)).filter(Boolean);
  return asString(value).split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
}

function asDates(value){
  return [...new Set(asList(value).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item)))].sort();
}

function slugify(value){
  return asString(value, 'smjestaj')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 42) || 'smjestaj';
}

function now(){
  return new Date().toISOString();
}

function clientIp(req){
  return asString(req.headers['x-forwarded-for']).split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'local';
}

function consumeRateLimit(key, limit, windowMs){
  const timestamp = Date.now();
  const current = authAttempts.get(key);
  if(!current || timestamp >= current.resetAt){
    authAttempts.set(key, { count:1, resetAt:timestamp + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function pruneTransientData(db){
  const timestamp = Date.now();
  const before = [db.sessions.length, db.passwordResets.length, db.invitations.length].join(':');
  db.sessions = db.sessions.filter(session => new Date(session.expiresAt).getTime() > timestamp);
  db.passwordResets = db.passwordResets.filter(item => !item.usedAt && new Date(item.expiresAt).getTime() > timestamp);
  db.invitations = db.invitations.filter(item => item.status !== 'expired' && new Date(item.expiresAt).getTime() > timestamp);
  return before !== [db.sessions.length, db.passwordResets.length, db.invitations.length].join(':');
}

function authContext(req, db){
  const token = sessionTokenFromRequest(req);
  if(!token) return { user:null, session:null };
  const tokenHash = hashToken(token);
  const session = db.sessions.find(item => item.tokenHash === tokenHash);
  if(!session || new Date(session.expiresAt).getTime() <= Date.now()) return { user:null, session:null };
  const user = db.users.find(item => item.id === session.userId && item.status === 'active');
  return user ? { user, session } : { user:null, session:null };
}

function sessionResponse(db, context){
  const partner = context.user?.partnerId
    ? db.partners.find(item => item.id === context.user.partnerId) || null
    : null;
  return {
    authenticated:Boolean(context.user),
    user:publicUser(context.user),
    partner,
    csrfToken:context.session?.csrfToken || ''
  };
}

function createSession(db, user, req){
  const rawToken = createToken();
  const createdAt = now();
  const session = {
    id:randomUUID(),
    userId:user.id,
    tokenHash:hashToken(rawToken),
    csrfToken:createToken(24),
    createdAt,
    lastSeenAt:createdAt,
    expiresAt:new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    ipHash:hashToken(clientIp(req)).slice(0, 16),
    userAgent:asString(req.headers['user-agent']).slice(0, 180)
  };
  const userSessions = db.sessions.filter(item => item.userId === user.id)
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  const retainedIds = new Set(userSessions.slice(0, 4).map(item => item.id));
  db.sessions = db.sessions.filter(item => item.userId !== user.id || retainedIds.has(item.id));
  db.sessions.push(session);
  return { rawToken, session };
}

function csrfAccepted(req, context){
  return Boolean(context.session)
    && asString(req.headers['x-csrf-token'])
    && asString(req.headers['x-csrf-token']) === context.session.csrfToken;
}

function requireUser(req, res, context, roles){
  if(!context.user){
    sendJson(res, 401, { error:'Prijavite se za nastavak.', code:'AUTH_REQUIRED' });
    return false;
  }
  if(Array.isArray(roles) && !roles.includes(context.user.role)){
    sendJson(res, 403, { error:'Nemate ovlasti za ovu radnju.', code:'FORBIDDEN' });
    return false;
  }
  if(!csrfAccepted(req, context)){
    sendJson(res, 403, { error:'Sigurnosna sesija je istekla. Osvježite stranicu.', code:'CSRF_INVALID' });
    return false;
  }
  return true;
}

function requirePartnerPermission(req, res, context, partnerRoles){
  if(!requireUser(req, res, context, ['partner', 'admin'])) return false;
  if(context.user.role === 'admin') return true;
  if(partnerRoles.includes(context.user.partnerRole)) return true;
  sendJson(res, 403, { error:'Vaša uloga nema ovlasti za ovu partnersku radnju.', code:'FORBIDDEN' });
  return false;
}

function audit(db, actor, action, entityType, entityId, metadata = {}){
  db.auditLog.unshift({
    id:randomUUID(),
    actorUserId:actor?.id || null,
    action,
    entityType,
    entityId:entityId || null,
    metadata,
    createdAt:now()
  });
  db.auditLog = db.auditLog.slice(0, 500);
}

function normalizeHotel(input, existing = {}, partnerId){
  const name = asString(input.name, existing.name || 'Novi smještaj');
  const totalRooms = clamp(Math.round(asNumber(input.totalRooms, existing.totalRooms || 21)), 1, 5000);
  const freeRooms = clamp(Math.round(asNumber(input.freeRooms, existing.freeRooms || 1)), 0, totalRooms);
  return {
    ...existing,
    id:existing.id || `${slugify(name)}-${Date.now()}`,
    partnerId:existing.partnerId || partnerId,
    name,
    city:asString(input.city, existing.city || 'Split'),
    street:asString(input.street, existing.street || ''),
    lat:asNumber(input.lat, existing.lat || 43.5081),
    lng:asNumber(input.lng, existing.lng || 16.4402),
    startPrice:clamp(Math.round(asNumber(input.startPrice, existing.startPrice || 50)), 10, 50000),
    duration:clamp(Math.round(asNumber(input.duration, existing.duration || 60)), 15, 1440),
    partnerType:input.partnerType === 'small' ? 'small' : (existing.partnerType || 'hotel'),
    freeRooms,
    totalRooms,
    dates:Object.prototype.hasOwnProperty.call(input, 'dates') ? asDates(input.dates) : existing.dates || [],
    images:Object.prototype.hasOwnProperty.call(input, 'images') ? asList(input.images).slice(0, 20) : existing.images || [],
    description:asString(input.description, existing.description || '').slice(0, 1600),
    amenities:Object.prototype.hasOwnProperty.call(input, 'amenities') ? asList(input.amenities).slice(0, 30) : existing.amenities || [],
    featured:Boolean(input.featured ?? existing.featured),
    status:['active', 'draft', 'archived'].includes(input.status) ? input.status : (existing.status || 'active'),
    createdAt:existing.createdAt || now(),
    updatedAt:now()
  };
}

function normalizePackage(input, existing = {}, hotel){
  const status = allowedPackageStatuses.has(input.status) ? input.status : (existing.status || 'draft');
  const dates = Object.prototype.hasOwnProperty.call(input, 'dates') ? asDates(input.dates) : existing.dates || [];
  return {
    ...existing,
    id:existing.id || `${slugify(input.name || 'paket')}-${Date.now()}`,
    hotelId:hotel.id,
    partnerId:hotel.partnerId,
    name:asString(input.name, existing.name || 'Novi aukcijski paket').slice(0, 120),
    roomType:asString(input.roomType, existing.roomType || 'Standardna soba').slice(0, 120),
    mealPlan:asString(input.mealPlan, existing.mealPlan || 'Bez obroka').slice(0, 120),
    dates,
    coldPrice:clamp(Math.round(asNumber(input.coldPrice, existing.coldPrice || hotel.startPrice || 50)), 10, 50000),
    duration:clamp(Math.round(asNumber(input.duration, existing.duration || hotel.duration || 60)), 15, 1440),
    units:clamp(Math.round(asNumber(input.units, existing.units ?? hotel.freeRooms ?? 1)), 0, 5000),
    maxGuests:clamp(Math.round(asNumber(input.maxGuests, existing.maxGuests || 2)), 1, 30),
    status,
    description:asString(input.description, existing.description || '').slice(0, 1000),
    createdAt:existing.createdAt || now(),
    updatedAt:now()
  };
}

function packageBids(db, packageId){
  return Array.isArray(db.bidsByPackage?.[packageId]) ? db.bidsByPackage[packageId] : [];
}

function highestPackageBid(db, auctionPackage){
  return Math.max(
    Number(auctionPackage.coldPrice) || 0,
    ...packageBids(db, auctionPackage.id).map(bid => Number(bid.amount) || 0)
  );
}

function commissionFor(hotel){
  return hotel.partnerType === 'small'
    ? { partner:60, platform:40, label:'60 / 40' }
    : { partner:70, platform:30, label:'70 / 30' };
}

function packageEconomy(db, auctionPackage, hotel){
  const coldPrice = Number(auctionPackage.coldPrice) || 0;
  const currentBid = highestPackageBid(db, auctionPackage);
  const difference = Math.max(0, currentBid - coldPrice);
  const commission = commissionFor(hotel);
  return {
    coldPrice,
    currentBid,
    difference,
    partnerBonus:difference * commission.partner / 100,
    partnerTotal:coldPrice + difference * commission.partner / 100,
    platformFee:difference * commission.platform / 100,
    commission
  };
}

function sanitizedBids(db, packages, user){
  return packages.reduce((result, auctionPackage) => {
    result[auctionPackage.id] = packageBids(db, auctionPackage.id)
      .slice()
      .sort((first, second) => new Date(first.createdAt) - new Date(second.createdAt))
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
  const hotels = db.hotels.filter(hotel => hotel.status === 'active');
  const hotelIds = new Set(hotels.map(hotel => hotel.id));
  const packages = db.packages.filter(item => item.status === 'active' && item.units > 0 && hotelIds.has(item.hotelId));
  return {
    hotels,
    packages,
    bidsByPackage:sanitizedBids(db, packages, user),
    watchedPackages:user ? (db.watchlists[user.id] || []) : [],
    user:publicUser(user),
    serverTime:now()
  };
}

function accessibleHotels(db, user){
  if(user.role === 'admin') return db.hotels;
  return db.hotels.filter(hotel => hotel.partnerId === user.partnerId);
}

function partnerState(db, user){
  const hotels = accessibleHotels(db, user);
  const hotelIds = new Set(hotels.map(hotel => hotel.id));
  const packages = db.packages.filter(item => hotelIds.has(item.hotelId));
  const packageIds = new Set(packages.map(item => item.id));
  const reservations = db.reservations.filter(item => packageIds.has(item.packageId));
  const teamPartnerId = user.role === 'admin' ? null : user.partnerId;
  const team = db.users
    .filter(item => teamPartnerId ? item.partnerId === teamPartnerId : item.role === 'admin')
    .map(publicUser);
  const invitations = db.invitations.filter(item => teamPartnerId ? item.partnerId === teamPartnerId : true);
  return {
    hotels,
    packages,
    bidsByPackage:sanitizedBids(db, packages, null),
    reservations,
    team,
    invitations,
    partner:user.partnerId ? db.partners.find(item => item.id === user.partnerId) || null : null,
    currentUser:publicUser(user),
    resetAllowed:user.role === 'admin',
    auditLog:db.auditLog.filter(entry => user.role === 'admin' || entry.actorUserId === user.id).slice(0, 40),
    serverTime:now()
  };
}

function hotelForUser(db, user, hotelId){
  const hotel = db.hotels.find(item => item.id === hotelId);
  if(!hotel) return null;
  if(user.role === 'admin' || hotel.partnerId === user.partnerId) return hotel;
  return false;
}

function packageForUser(db, user, packageId){
  const auctionPackage = db.packages.find(item => item.id === packageId);
  if(!auctionPackage) return null;
  const hotel = hotelForUser(db, user, auctionPackage.hotelId);
  if(!hotel) return hotel;
  return { auctionPackage, hotel };
}

function accountActivity(db, user){
  const bids = Object.entries(db.bidsByPackage).flatMap(([packageId, items]) =>
    (Array.isArray(items) ? items : [])
      .filter(bid => bid.userId === user.id)
      .map(bid => {
        const auctionPackage = db.packages.find(item => item.id === packageId);
        const hotel = db.hotels.find(item => item.id === auctionPackage?.hotelId);
        return {
          ...bid,
          packageName:auctionPackage?.name || 'Aukcijski paket',
          hotelName:hotel?.name || 'Smještaj',
          leading:auctionPackage ? highestPackageBid(db, auctionPackage) === Number(bid.amount) : false
        };
      })
  ).sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  const reservations = db.reservations.filter(item => item.userId === user.id);
  const watchedPackages = (db.watchlists[user.id] || []).map(packageId => {
    const auctionPackage = db.packages.find(item => item.id === packageId);
    const hotel = db.hotels.find(item => item.id === auctionPackage?.hotelId);
    return auctionPackage && hotel ? { package:auctionPackage, hotel } : null;
  }).filter(Boolean);
  return { user:publicUser(user), bids, reservations, watchedPackages };
}

function partnerRecipients(db, partnerId){
  return db.users.filter(user => user.role === 'partner' && user.partnerId === partnerId && user.status === 'active');
}

function operationsRecipient(){
  const email = normalizeEmail(process.env.NOTIFICATION_EMAIL);
  return email ? { id:'auction-split-operations', name:'Auction Split tim', email } : null;
}

function superAdminState(db, user){
  return {
    currentUser:publicUser(user),
    users:db.users.map(publicUser).sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt)),
    partners:db.partners.map(partner => ({
      id:partner.id,
      businessName:partner.businessName,
      city:partner.city,
      status:partner.status,
      partnerType:partner.partnerType
    })).sort((first, second) => first.businessName.localeCompare(second.businessName)),
    metrics:{
      totalUsers:db.users.length,
      activeUsers:db.users.filter(item => item.status === 'active').length,
      guests:db.users.filter(item => item.role === 'guest').length,
      partners:db.users.filter(item => item.role === 'partner').length
    },
    serverTime:now()
  };
}

async function handlePublicAuth(req, res, url, db, body){
  if(req.method === 'POST' && url.pathname === '/api/auth/register'){
    const email = normalizeEmail(body.email);
    const name = asString(body.name).slice(0, 100);
    const accountType = body.accountType === 'partner' ? 'partner' : 'guest';
    const rateKey = `register:${clientIp(req)}:${email}`;
    if(!consumeRateLimit(rateKey, 8, 15 * 60 * 1000)){
      sendJson(res, 429, { error:'Previše pokušaja. Pokušajte ponovno za nekoliko minuta.' });
      return true;
    }
    if(!name || !validEmail(email)){
      sendJson(res, 422, { error:'Unesite valjano ime i e-mail adresu.' });
      return true;
    }
    const passwordErrors = passwordValidation(body.password);
    if(passwordErrors.length){
      sendJson(res, 422, { error:passwordErrors[0] });
      return true;
    }
    if(db.users.some(user => normalizeEmail(user.email) === email)){
      sendJson(res, 409, { error:'Račun s ovom e-mail adresom već postoji.' });
      return true;
    }

    let role = accountType;
    let partnerId = null;
    let partnerRole = null;
    let invitation = null;
    if(body.invitationToken){
      invitation = db.invitations.find(item => item.tokenHash === hashToken(body.invitationToken) && item.status === 'pending');
      if(!invitation || normalizeEmail(invitation.email) !== email || new Date(invitation.expiresAt).getTime() <= Date.now()){
        sendJson(res, 422, { error:'Pozivnica nije valjana ili je istekla.' });
        return true;
      }
      role = 'partner';
      partnerId = invitation.partnerId;
      partnerRole = invitation.role;
    }else if(accountType === 'partner'){
      const businessName = asString(body.businessName).slice(0, 140);
      if(!businessName){
        sendJson(res, 422, { error:'Za partnerski račun unesite naziv poslovnog subjekta.' });
        return true;
      }
      partnerId = `partner-${Date.now()}`;
      partnerRole = 'owner';
      db.partners.push({
        id:partnerId,
        businessName,
        partnerType:body.partnerType === 'small' ? 'small' : 'hotel',
        ownerUserId:null,
        city:asString(body.city, 'Split'),
        taxId:asString(body.taxId).slice(0, 40),
        status:'active',
        createdAt:now()
      });
    }

    const user = {
      id:randomUUID(),
      name,
      email,
      phone:asString(body.phone).slice(0, 40),
      role,
      partnerId,
      partnerRole,
      status:'active',
      passwordHash:await hashPassword(body.password),
      emailVerifiedAt:now(),
      createdAt:now(),
      lastLoginAt:now()
    };
    db.users.push(user);
    if(partnerRole === 'owner'){
      const partner = db.partners.find(item => item.id === partnerId);
      if(partner) partner.ownerUserId = user.id;
    }
    if(invitation){
      invitation.status = 'accepted';
      invitation.acceptedAt = now();
      invitation.acceptedBy = user.id;
    }
    const createdSession = createSession(db, user, req);
    audit(db, user, 'auth.register', 'user', user.id, { role:user.role });
    await notify(db, {
      type:'account.registered',
      user,
      subject:'Dobro došli u Auction Split',
      title:'Vaš račun je spreman',
      body:'Registracija je uspješno dovršena. Sada možete pratiti aukcije, poslati ponudu i upravljati svojim rezervacijama.',
      ctaLabel:'Otvori račun'
    });
    await notify(db, {
      type:'account.registered.operations',
      user:operationsRecipient(),
      subject:'Novi račun na Auction Split',
      title:'Kreiran je novi korisnički račun',
      body:`${user.name} otvorio je ${user.role === 'partner' ? 'partnerski' : 'gostujući'} račun.`,
      detail:user.email,
      ctaLabel:'Otvori Superadmin',
      ctaPath:'/superadmin.html'
    });
    await writeDatabase(db);
    sendJson(res, 201, sessionResponse(db, { user, session:createdSession.session }), {
      'set-cookie':sessionCookie(createdSession.rawToken, req)
    });
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/auth/login'){
    const email = normalizeEmail(body.email);
    const rateKey = `login:${clientIp(req)}:${email}`;
    if(!consumeRateLimit(rateKey, 10, 15 * 60 * 1000)){
      sendJson(res, 429, { error:'Previše pokušaja prijave. Pokušajte ponovno kasnije.' });
      return true;
    }
    const user = db.users.find(item => normalizeEmail(item.email) === email);
    const verified = user && user.status === 'active' && await verifyPassword(body.password, user.passwordHash);
    if(!verified){
      sendJson(res, 401, { error:'E-mail ili lozinka nisu ispravni.' });
      return true;
    }
    if(body.requiredRole === 'superadmin' && user.role !== 'superadmin'){
      sendJson(res, 403, { error:'Ovaj račun nema Superadmin ovlast.', code:'FORBIDDEN' });
      return true;
    }
    user.lastLoginAt = now();
    const createdSession = createSession(db, user, req);
    audit(db, user, 'auth.login', 'session', createdSession.session.id);
    await writeDatabase(db);
    sendJson(res, 200, sessionResponse(db, { user, session:createdSession.session }), {
      'set-cookie':sessionCookie(createdSession.rawToken, req)
    });
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/auth/forgot-password'){
    const email = normalizeEmail(body.email);
    const rateKey = `forgot:${clientIp(req)}:${email}`;
    if(!consumeRateLimit(rateKey, 5, 30 * 60 * 1000)){
      sendJson(res, 429, { error:'Previše zahtjeva. Pokušajte ponovno kasnije.' });
      return true;
    }
    const user = db.users.find(item => normalizeEmail(item.email) === email && item.status === 'active');
    let demoResetToken = '';
    if(user){
      const rawToken = createToken();
      demoResetToken = rawToken;
      db.passwordResets = db.passwordResets.filter(item => item.userId !== user.id);
      db.passwordResets.push({
        id:randomUUID(),
        userId:user.id,
        tokenHash:hashToken(rawToken),
        createdAt:now(),
        expiresAt:new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        usedAt:null
      });
      audit(db, user, 'auth.password_reset_requested', 'user', user.id);
      await writeDatabase(db);
    }
    sendJson(res, 200, {
      message:'Ako račun postoji, poslali smo upute za promjenu lozinke.',
      demoResetToken:process.env.NODE_ENV === 'production' ? undefined : demoResetToken
    });
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/auth/reset-password'){
    const passwordErrors = passwordValidation(body.password);
    if(passwordErrors.length){
      sendJson(res, 422, { error:passwordErrors[0] });
      return true;
    }
    const reset = db.passwordResets.find(item => item.tokenHash === hashToken(body.token) && !item.usedAt);
    if(!reset || new Date(reset.expiresAt).getTime() <= Date.now()){
      sendJson(res, 422, { error:'Poveznica za promjenu lozinke nije valjana ili je istekla.' });
      return true;
    }
    const user = db.users.find(item => item.id === reset.userId);
    if(!user){
      sendJson(res, 422, { error:'Korisnički račun više ne postoji.' });
      return true;
    }
    user.passwordHash = await hashPassword(body.password);
    reset.usedAt = now();
    db.sessions = db.sessions.filter(item => item.userId !== user.id);
    audit(db, user, 'auth.password_reset_completed', 'user', user.id);
    await writeDatabase(db);
    sendJson(res, 200, { message:'Lozinka je promijenjena. Sada se možete prijaviti.' });
    return true;
  }

  return false;
}

async function handleApi(req, res, url){
  if(!url.pathname.startsWith('/api/')) return false;

  if(req.method === 'GET' && url.pathname === '/api/health'){
    try{
      const db = await readDatabase();
      sendJson(res, 200, { ok:true, database:'ready', schemaVersion:db.schemaVersion, auth:'ready' });
    }catch(error){
      sendJson(res, 500, { ok:false, database:'invalid', error:error.message });
    }
    return true;
  }

  const db = await readDatabase();
  if(pruneTransientData(db)) await writeDatabase(db);
  const context = authContext(req, db);

  if(req.method === 'GET' && url.pathname === '/api/auth/session'){
    sendJson(res, 200, sessionResponse(db, context));
    return true;
  }

  if(req.method === 'GET' && url.pathname === '/api/state'){
    sendJson(res, 200, publicState(db, context.user));
    return true;
  }

  if(req.method === 'GET' && url.pathname === '/api/partner/state'){
    if(!context.user){
      sendJson(res, 401, { error:'Prijavite se kao partner ili administrator.', code:'AUTH_REQUIRED' });
      return true;
    }
    if(!['partner', 'admin'].includes(context.user.role)){
      sendJson(res, 403, { error:'Partner centar nije dostupan gostujućem računu.', code:'FORBIDDEN' });
      return true;
    }
    sendJson(res, 200, partnerState(db, context.user));
    return true;
  }

  if(req.method === 'GET' && url.pathname === '/api/account/activity'){
    if(!context.user){
      sendJson(res, 401, { error:'Prijavite se za pregled računa.', code:'AUTH_REQUIRED' });
      return true;
    }
    sendJson(res, 200, accountActivity(db, context.user));
    return true;
  }

  if(req.method === 'GET' && url.pathname === '/api/superadmin/state'){
    if(!context.user || context.user.role !== 'superadmin'){
      sendJson(res, 403, { error:'Superadmin pristup nije dostupan.', code:'FORBIDDEN' });
      return true;
    }
    sendJson(res, 200, superAdminState(db, context.user));
    return true;
  }

  let body;
  try{ body = await readBody(req); }
  catch{
    sendJson(res, 400, { error:'Neispravan JSON zahtjev.' });
    return true;
  }

  if(await handlePublicAuth(req, res, url, db, body)) return true;

  if(req.method === 'POST' && url.pathname === '/api/auth/logout'){
    if(!requireUser(req, res, context)) return true;
    db.sessions = db.sessions.filter(item => item.id !== context.session.id);
    audit(db, context.user, 'auth.logout', 'session', context.session.id);
    await writeDatabase(db);
    sendJson(res, 200, { authenticated:false, user:null, csrfToken:'' }, {
      'set-cookie':expiredSessionCookie(req)
    });
    return true;
  }

  if(req.method === 'PATCH' && url.pathname === '/api/account/profile'){
    if(!requireUser(req, res, context)) return true;
    const name = asString(body.name).slice(0, 100);
    if(!name){
      sendJson(res, 422, { error:'Ime je obavezno.' });
      return true;
    }
    context.user.name = name;
    context.user.phone = asString(body.phone).slice(0, 40);
    audit(db, context.user, 'account.profile_updated', 'user', context.user.id);
    await writeDatabase(db);
    sendJson(res, 200, sessionResponse(db, context));
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/account/password'){
    if(!requireUser(req, res, context)) return true;
    if(!await verifyPassword(body.currentPassword, context.user.passwordHash)){
      sendJson(res, 422, { error:'Trenutačna lozinka nije ispravna.' });
      return true;
    }
    const validation = passwordValidation(body.newPassword);
    if(validation.length){
      sendJson(res, 422, { error:validation[0] });
      return true;
    }
    context.user.passwordHash = await hashPassword(body.newPassword);
    db.sessions = db.sessions.filter(item => item.id === context.session.id || item.userId !== context.user.id);
    audit(db, context.user, 'account.password_changed', 'user', context.user.id);
    await notify(db, {
      type:'account.password_changed',
      user:context.user,
      subject:'Lozinka je promijenjena',
      title:'Promijenili ste lozinku',
      body:'Lozinka za vaš Auction Split račun upravo je promijenjena. Ako to niste bili vi, javite se podršci.',
      ctaLabel:'Otvori račun'
    });
    await writeDatabase(db);
    sendJson(res, 200, { message:'Lozinka je uspješno promijenjena.' });
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/bids'){
    if(!requireUser(req, res, context, ['guest'])) return true;
    const auctionPackage = db.packages.find(item => item.id === body.packageId);
    const hotel = db.hotels.find(item => item.id === auctionPackage?.hotelId);
    if(!auctionPackage || !hotel || auctionPackage.status !== 'active' || hotel.status !== 'active'){
      sendJson(res, 404, { error:'Aktivni aukcijski paket nije pronađen.' });
      return true;
    }
    if(auctionPackage.units < 1){
      sendJson(res, 409, { error:'Ovaj paket više nema slobodnih jedinica.' });
      return true;
    }
    const selectedDates = asDates(body.dates);
    if(!selectedDates.length || selectedDates.some(date => !auctionPackage.dates.includes(date))){
      sendJson(res, 422, { error:'Odaberite barem jedan slobodan datum iz paketa.' });
      return true;
    }
    const openingBid = clamp(Math.round(asNumber(body.openingBid, auctionPackage.coldPrice)), 10, 50000);
    const minimum = highestPackageBid(db, auctionPackage) + 1;
    const amount = Math.round(asNumber(body.amount));
    if(!Number.isFinite(amount) || amount < minimum || amount > 50000){
      sendJson(res, 422, {
        error:amount > 50000 ? 'Ponuda ne može biti veća od 50.000 €.' : `Minimalna sljedeća ponuda je ${minimum} €.`,
        minimum
      });
      return true;
    }
    const bid = {
      id:randomUUID(),
      userId:context.user.id,
      packageId:auctionPackage.id,
      amount,
      openingBid,
      dates:selectedDates,
      duration:clamp(Math.round(asNumber(body.duration, auctionPackage.duration)), 15, 1440),
      createdAt:now()
    };
    db.bidsByPackage[auctionPackage.id] ||= [];
    const previousBidderIds = new Set(db.bidsByPackage[auctionPackage.id].map(item => item.userId).filter(userId => userId && userId !== context.user.id));
    db.bidsByPackage[auctionPackage.id].push(bid);
    audit(db, context.user, 'auction.bid_placed', 'package', auctionPackage.id, { amount });
    await notify(db, {
      type:'auction.bid_confirmed',
      user:context.user,
      subject:`Ponuda zaprimljena · ${hotel.name}`,
      title:'Vaša ponuda je zaprimljena',
      body:`Poslali ste ponudu od ${amount} € za ${auctionPackage.name}. Pratit ćemo tijek aukcije i javiti vam važne promjene.`,
      detail:`Odabrani termin: ${selectedDates.join(', ')}`,
      ctaLabel:'Pogledaj aukciju',
      ctaPath:`/demo.html?package=${encodeURIComponent(auctionPackage.id)}`
    });
    await notifyMany(db, db.users.filter(user => previousBidderIds.has(user.id) && user.status === 'active'), {
      type:'auction.bid_activity',
      subject:`Nova ponuda · ${hotel.name}`,
      title:'Aukcija koju pratite ima novu ponudu',
      body:`Na paket ${auctionPackage.name} stigla je nova ponuda. Provjerite trenutačno stanje svoje aukcije.`,
      ctaLabel:'Otvori aukciju',
      ctaPath:`/demo.html?package=${encodeURIComponent(auctionPackage.id)}`
    });
    await notifyMany(db, [...partnerRecipients(db, hotel.partnerId), operationsRecipient()], {
      type:'auction.bid_partner',
      subject:`Nova ponuda · ${hotel.name}`,
      title:'Stigla je nova ponuda',
      body:`Za paket ${auctionPackage.name} zaprimljena je ponuda od ${amount} € .`,
      detail:`Termin: ${selectedDates.join(', ')}`,
      ctaLabel:'Otvori Partner centar',
      ctaPath:'/partner.html'
    });
    await writeDatabase(db);
    sendJson(res, 201, { bid:{ ...bid, self:true, label:'Vi', meta:'Vaša ponuda' }, state:publicState(db, context.user) });
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/watch'){
    if(!requireUser(req, res, context, ['guest'])) return true;
    const auctionPackage = db.packages.find(item => item.id === body.packageId && item.status === 'active');
    if(!auctionPackage){
      sendJson(res, 404, { error:'Aukcijski paket nije pronađen.' });
      return true;
    }
    const watchlist = new Set(db.watchlists[context.user.id] || []);
    if(Boolean(body.watching)) watchlist.add(auctionPackage.id);
    else watchlist.delete(auctionPackage.id);
    db.watchlists[context.user.id] = [...watchlist];
    audit(db, context.user, Boolean(body.watching) ? 'watch.added' : 'watch.removed', 'package', auctionPackage.id);
    await writeDatabase(db);
    sendJson(res, 200, publicState(db, context.user));
    return true;
  }

  if(req.method === 'POST' && ['/api/confirms', '/api/reservations'].includes(url.pathname)){
    if(!requireUser(req, res, context, ['guest'])) return true;
    const auctionPackage = db.packages.find(item => item.id === body.packageId);
    const hotel = db.hotels.find(item => item.id === auctionPackage?.hotelId);
    if(!auctionPackage || !hotel){
      sendJson(res, 404, { error:'Aukcijski paket nije pronađen.' });
      return true;
    }
    const bids = packageBids(db, auctionPackage.id);
    const winningAmount = highestPackageBid(db, auctionPackage);
    const winningBid = bids.find(bid => bid.userId === context.user.id && Number(bid.amount) === winningAmount);
    if(!winningBid){
      sendJson(res, 409, { error:'Rezervaciju može potvrditi samo korisnik s vodećom ponudom.' });
      return true;
    }
    if(db.reservations.some(item => item.userId === context.user.id && item.packageId === auctionPackage.id && item.status !== 'cancelled')){
      sendJson(res, 409, { error:'Ova pobjednička rezervacija već je potvrđena.' });
      return true;
    }
    if(auctionPackage.units < 1){
      sendJson(res, 409, { error:'Paket više nema slobodnih jedinica.' });
      return true;
    }
    const reservation = {
      id:randomUUID(),
      bookingCode:`AS-${createToken(7).toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(7, '0').slice(0, 7)}`,
      userId:context.user.id,
      packageId:auctionPackage.id,
      hotelId:hotel.id,
      name:context.user.name,
      email:context.user.email,
      card:asString(body.card, 'Demo autorizacija').slice(0, 80),
      hotel:hotel.name,
      packageName:auctionPackage.name,
      dates:winningBid.dates.join(', '),
      amount:winningAmount,
      status:'confirmed',
      paymentStatus:'awaiting_payment',
      createdAt:now()
    };
    db.reservations.unshift(reservation);
    auctionPackage.units = Math.max(0, auctionPackage.units - 1);
    if(auctionPackage.units === 0) auctionPackage.status = 'sold_out';
    audit(db, context.user, 'reservation.confirmed', 'reservation', reservation.id, { amount:reservation.amount });
    await notify(db, {
      type:'reservation.confirmed',
      user:context.user,
      subject:`Rezervacija potvrđena · ${hotel.name}`,
      title:'Pobjednička rezervacija je potvrđena',
      body:`Potvrdili ste ${auctionPackage.name} za ${hotel.name}. Sljedeći korak je sigurno plaćanje.`,
      detail:`Kod rezervacije: ${reservation.bookingCode} · Iznos: ${reservation.amount} €`,
      ctaLabel:'Otvori rezervaciju'
    });
    await notifyMany(db, [...partnerRecipients(db, hotel.partnerId), operationsRecipient()], {
      type:'reservation.confirmed_partner',
      subject:`Potvrđena rezervacija · ${hotel.name}`,
      title:'Aukcija je pretvorena u rezervaciju',
      body:`Gost je potvrdio paket ${auctionPackage.name}.`,
      detail:`${reservation.bookingCode} · ${reservation.amount} €`,
      ctaLabel:'Otvori Partner centar',
      ctaPath:'/partner.html'
    });
    await writeDatabase(db);
    sendJson(res, 201, { confirmation:reservation, reservation, state:publicState(db, context.user) });
    return true;
  }

  if(req.method === 'GET' && url.pathname === '/api/payments/config'){
    sendJson(res, 200, paymentConfiguration());
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/payments/checkout'){
    if(!requireUser(req, res, context, ['guest'])) return true;
    const reservation = db.reservations.find(item => item.id === asString(body.reservationId));
    if(!reservation || reservation.userId !== context.user.id){
      sendJson(res, 404, { error:'Rezervacija nije pronađena.' });
      return true;
    }
    if(reservation.status === 'cancelled' || reservation.status === 'completed'){
      sendJson(res, 409, { error:'Za ovu rezervaciju plaćanje više nije dostupno.' });
      return true;
    }
    if(reservation.paymentStatus === 'paid'){
      sendJson(res, 409, { error:'Ova rezervacija je već plaćena.' });
      return true;
    }
    const auctionPackage = db.packages.find(item => item.id === reservation.packageId);
    const hotel = db.hotels.find(item => item.id === reservation.hotelId);
    if(!auctionPackage || !hotel){
      sendJson(res, 404, { error:'Podaci rezervacije više nisu dostupni.' });
      return true;
    }
    let checkout;
    try{
      checkout = await createCheckoutSession({ req, reservation, hotel, auctionPackage, customer:context.user });
    }catch(error){
      if(error.code === 'STRIPE_NOT_CONFIGURED'){
        sendJson(res, 503, { error:error.message, code:error.code });
        return true;
      }
      throw error;
    }
    reservation.paymentStatus = 'checkout_open';
    reservation.paymentProvider = 'stripe';
    reservation.checkoutSessionId = checkout.id;
    reservation.checkoutOpenedAt = now();
    audit(db, context.user, 'payment.checkout_created', 'reservation', reservation.id, { provider:'stripe', mode:checkout.mode });
    await notify(db, {
      type:'payment.checkout_opened',
      user:context.user,
      subject:`Plaćanje otvoreno · ${reservation.bookingCode}`,
      title:'Sigurno plaćanje je otvoreno',
      body:`Otvorili ste Stripe Checkout za rezervaciju u objektu ${hotel.name}.`,
      detail:`Iznos za plaćanje: ${reservation.amount} €`,
      ctaLabel:'Otvori račun'
    });
    await writeDatabase(db);
    sendJson(res, 201, { checkoutUrl:checkout.url, reservation });
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/superadmin/users'){
    if(!requireUser(req, res, context, ['superadmin'])) return true;
    const email = normalizeEmail(body.email);
    const role = manageableRoles.has(body.role) ? body.role : 'guest';
    const status = manageableUserStatuses.has(body.status) ? body.status : 'active';
    const name = asString(body.name).slice(0, 100);
    if(!name || !validEmail(email)){
      sendJson(res, 422, { error:'Ime i valjana e-mail adresa su obavezni.' });
      return true;
    }
    if(db.users.some(item => normalizeEmail(item.email) === email)){
      sendJson(res, 409, { error:'Račun s ovom e-mail adresom već postoji.' });
      return true;
    }
    const passwordErrors = passwordValidation(body.password);
    if(passwordErrors.length){
      sendJson(res, 422, { error:passwordErrors[0] });
      return true;
    }
    const partnerId = role === 'partner' ? asString(body.partnerId) : null;
    const partnerRole = role === 'partner' ? asString(body.partnerRole) : null;
    if(role === 'partner' && (!db.partners.some(item => item.id === partnerId) || !allowedPartnerRoles.has(partnerRole))){
      sendJson(res, 422, { error:'Partner i razina pristupa partnera moraju biti valjani.' });
      return true;
    }
    const user = {
      id:randomUUID(),
      name,
      email,
      phone:asString(body.phone).slice(0, 40),
      role,
      partnerId,
      partnerRole,
      status,
      passwordHash:await hashPassword(body.password),
      emailVerifiedAt:now(),
      createdAt:now(),
      lastLoginAt:null
    };
    db.users.push(user);
    audit(db, context.user, 'superadmin.user_created', 'user', user.id, { role, status, partnerId });
    await notify(db, {
      type:'account.created_by_admin',
      user,
      subject:'Vaš Auction Split račun je spreman',
      title:'Račun je kreiran',
      body:'Administrator je otvorio vaš Auction Split račun. Koristite početnu lozinku koju ste dobili sigurnim kanalom.',
      ctaLabel:'Prijavi se',
      ctaPath:'/'
    });
    await writeDatabase(db);
    sendJson(res, 201, superAdminState(db, context.user));
    return true;
  }

  const superAdminUserMatch = url.pathname.match(/^\/api\/superadmin\/users\/([^/]+)$/);
  const superAdminPasswordResetMatch = url.pathname.match(/^\/api\/superadmin\/users\/([^/]+)\/password-reset$/);
  if(superAdminPasswordResetMatch && req.method === 'POST'){
    if(!requireUser(req, res, context, ['superadmin'])) return true;
    const user = db.users.find(item => item.id === decodeURIComponent(superAdminPasswordResetMatch[1]));
    if(!user){
      sendJson(res, 404, { error:'Korisnik nije pronađen.' });
      return true;
    }
    if(user.role === 'superadmin'){
      sendJson(res, 403, { error:'God-mode lozinku promijenite kroz vlastiti račun.', code:'SUPERADMIN_PROTECTED' });
      return true;
    }
    const temporaryPassword = `AS-${createToken(9)}-a1`;
    user.passwordHash = await hashPassword(temporaryPassword);
    user.passwordChangedAt = now();
    user.updatedAt = now();
    db.sessions = db.sessions.filter(session => session.userId !== user.id);
    audit(db, context.user, 'superadmin.user_password_reset', 'user', user.id);
    await notify(db, {
      type:'account.password_reset_by_admin',
      user,
      subject:'Administrator je resetirao vašu lozinku',
      title:'Lozinka je resetirana',
      body:'Administrator je postavio novu privremenu lozinku za vaš račun. Preuzmite je sigurnim kanalom i promijenite nakon prijave.',
      ctaLabel:'Prijavi se',
      ctaPath:'/'
    });
    await writeDatabase(db);
    sendJson(res, 200, { state:superAdminState(db, context.user), temporaryPassword });
    return true;
  }
  if(superAdminUserMatch && req.method === 'PATCH'){
    if(!requireUser(req, res, context, ['superadmin'])) return true;
    const user = db.users.find(item => item.id === decodeURIComponent(superAdminUserMatch[1]));
    if(!user){
      sendJson(res, 404, { error:'Korisnik nije pronađen.' });
      return true;
    }
    const email = normalizeEmail(body.email || user.email);
    const role = manageableRoles.has(body.role) ? body.role : user.role;
    const status = manageableUserStatuses.has(body.status) ? body.status : user.status;
    const sensitiveSuperAdminChange = user.role === 'superadmin'
      && (email !== user.email || role !== user.role || status !== user.status);
    if(sensitiveSuperAdminChange || role === 'superadmin'){
      sendJson(res, 403, { error:'God-mode račun nije moguće mijenjati kroz upravljanje korisnicima.', code:'SUPERADMIN_PROTECTED' });
      return true;
    }
    if(!validEmail(email)){
      sendJson(res, 422, { error:'Unesite valjanu e-mail adresu.' });
      return true;
    }
    if(db.users.some(item => item.id !== user.id && normalizeEmail(item.email) === email)){
      sendJson(res, 409, { error:'Račun s ovom e-mail adresom već postoji.' });
      return true;
    }
    const partnerId = role === 'partner' ? asString(body.partnerId) : null;
    const partnerRole = role === 'partner' ? asString(body.partnerRole) : null;
    if(role === 'partner' && (!db.partners.some(item => item.id === partnerId) || !allowedPartnerRoles.has(partnerRole))){
      sendJson(res, 422, { error:'Partner i razina pristupa partnera moraju biti valjani.' });
      return true;
    }
    user.name = asString(body.name, user.name).slice(0, 100) || user.name;
    user.email = email;
    user.phone = asString(body.phone, user.phone).slice(0, 40);
    user.role = role;
    user.status = status;
    user.partnerId = partnerId;
    user.partnerRole = partnerRole;
    const nextPassword = asString(body.password);
    if(nextPassword){
      const passwordErrors = passwordValidation(nextPassword);
      if(passwordErrors.length){
        sendJson(res, 422, { error:passwordErrors[0] });
        return true;
      }
      user.passwordHash = await hashPassword(nextPassword);
      user.passwordChangedAt = now();
      db.sessions = db.sessions.filter(session => session.userId !== user.id);
    }
    user.updatedAt = now();
    if(status !== 'active') db.sessions = db.sessions.filter(session => session.userId !== user.id);
    audit(db, context.user, 'superadmin.user_updated', 'user', user.id, { role, status, partnerId });
    await writeDatabase(db);
    sendJson(res, 200, superAdminState(db, context.user));
    return true;
  }

  const reservationMatch = url.pathname.match(/^\/api\/reservations\/([^/]+)$/);
  if(reservationMatch && req.method === 'PATCH'){
    if(!requireUser(req, res, context)) return true;
    const reservation = db.reservations.find(item => item.id === decodeURIComponent(reservationMatch[1]));
    const auctionPackage = db.packages.find(item => item.id === reservation?.packageId);
    const hotel = db.hotels.find(item => item.id === reservation?.hotelId);
    if(!reservation || !auctionPackage || !hotel){
      sendJson(res, 404, { error:'Rezervacija nije pronađena.' });
      return true;
    }
    const guestOwnsReservation = context.user.role === 'guest' && reservation.userId === context.user.id;
    const partnerOwnsReservation = ['partner', 'admin'].includes(context.user.role)
      && (context.user.role === 'admin' || hotel.partnerId === context.user.partnerId);
    if(!guestOwnsReservation && !partnerOwnsReservation){
      sendJson(res, 403, { error:'Nemate ovlasti za ovu rezervaciju.', code:'FORBIDDEN' });
      return true;
    }
    const nextStatus = asString(body.status, reservation.status);
    const previousStatus = reservation.status;
    const previousPaymentStatus = reservation.paymentStatus;
    const allowedStatuses = new Set(['confirmed', 'checked_in', 'completed', 'cancelled']);
    if(!allowedStatuses.has(nextStatus) || (guestOwnsReservation && nextStatus !== 'cancelled')){
      sendJson(res, 422, { error:'Odabrani status rezervacije nije dopušten.' });
      return true;
    }
    if(context.user.role === 'partner' && !['owner', 'manager'].includes(context.user.partnerRole)){
      sendJson(res, 403, { error:'Vaša uloga nema ovlasti mijenjati rezervacije.', code:'FORBIDDEN' });
      return true;
    }
    if(reservation.status !== 'cancelled' && nextStatus === 'cancelled'){
      auctionPackage.units += 1;
      if(auctionPackage.status === 'sold_out') auctionPackage.status = 'active';
    }else if(reservation.status === 'cancelled' && nextStatus !== 'cancelled'){
      if(auctionPackage.units < 1){
        sendJson(res, 409, { error:'Paket više nema slobodnih jedinica za ponovno aktiviranje rezervacije.' });
        return true;
      }
      auctionPackage.units -= 1;
      if(auctionPackage.units === 0) auctionPackage.status = 'sold_out';
    }
    reservation.status = nextStatus;
    if(partnerOwnsReservation && ['awaiting_payment', 'checkout_open', 'demo_authorized', 'paid', 'refunded'].includes(body.paymentStatus)){
      reservation.paymentStatus = body.paymentStatus;
    }
    reservation.updatedAt = now();
    audit(db, context.user, 'reservation.updated', 'reservation', reservation.id, { status:reservation.status, paymentStatus:reservation.paymentStatus });
    const reservationUser = db.users.find(user => user.id === reservation.userId);
    if(previousStatus !== 'cancelled' && reservation.status === 'cancelled'){
      await notify(db, {
        type:'reservation.cancelled',
        user:reservationUser,
        subject:`Rezervacija otkazana · ${hotel.name}`,
        title:'Rezervacija je otkazana',
        body:`Rezervacija ${reservation.bookingCode} za ${hotel.name} je otkazana.`,
        detail:'Kapacitet je vraćen u aukcijski paket.',
        ctaLabel:'Otvori račun'
      });
      await notifyMany(db, [...partnerRecipients(db, hotel.partnerId), operationsRecipient()], {
        type:'reservation.cancelled_partner',
        subject:`Otkazana rezervacija · ${hotel.name}`,
        title:'Rezervacija je otkazana',
        body:`Rezervacija ${reservation.bookingCode} vraćena je u raspoloživi kapacitet.`,
        ctaLabel:'Otvori Partner centar',
        ctaPath:'/partner.html'
      });
    }
    if(previousPaymentStatus !== 'paid' && reservation.paymentStatus === 'paid'){
      await notify(db, {
        type:'payment.paid',
        user:reservationUser,
        subject:`Plaćanje potvrđeno · ${reservation.bookingCode}`,
        title:'Plaćanje je potvrđeno',
        body:`Plaćanje za rezervaciju u objektu ${hotel.name} evidentirano je kao uspješno.`,
        detail:`Iznos: ${reservation.amount} €`,
        ctaLabel:'Otvori račun'
      });
    }
    await writeDatabase(db);
    sendJson(res, 200, context.user.role === 'guest' ? accountActivity(db, context.user) : partnerState(db, context.user));
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/hotels'){
    if(!requirePartnerPermission(req, res, context, ['owner', 'manager', 'editor'])) return true;
    const partnerId = context.user.role === 'admin'
      ? asString(body.partnerId, db.partners[0]?.id)
      : context.user.partnerId;
    if(!partnerId || !db.partners.some(item => item.id === partnerId)){
      sendJson(res, 422, { error:'Odaberite valjanog partnera za smještaj.' });
      return true;
    }
    const hotel = normalizeHotel(body, {}, partnerId);
    db.hotels.push(hotel);
    audit(db, context.user, 'hotel.created', 'hotel', hotel.id);
    await writeDatabase(db);
    sendJson(res, 201, { hotel, state:partnerState(db, context.user) });
    return true;
  }

  const hotelMatch = url.pathname.match(/^\/api\/hotels\/([^/]+)$/);
  if(hotelMatch && ['PUT', 'PATCH', 'DELETE'].includes(req.method)){
    const roles = req.method === 'DELETE' ? ['owner', 'manager'] : ['owner', 'manager', 'editor'];
    if(!requirePartnerPermission(req, res, context, roles)) return true;
    const hotelId = decodeURIComponent(hotelMatch[1]);
    const hotel = hotelForUser(db, context.user, hotelId);
    if(hotel === null){
      sendJson(res, 404, { error:'Smještaj nije pronađen.' });
      return true;
    }
    if(hotel === false){
      sendJson(res, 403, { error:'Ne možete upravljati tuđim smještajem.' });
      return true;
    }
    if(req.method === 'DELETE'){
      const relatedPackages = db.packages.filter(item => item.hotelId === hotel.id);
      const hasActivity = relatedPackages.some(item => packageBids(db, item.id).length)
        || db.reservations.some(item => item.hotelId === hotel.id);
      if(hasActivity){
        sendJson(res, 409, { error:'Smještaj s ponudama ili rezervacijama nije moguće obrisati. Arhivirajte ga.' });
        return true;
      }
      db.hotels = db.hotels.filter(item => item.id !== hotel.id);
      db.packages = db.packages.filter(item => item.hotelId !== hotel.id);
      audit(db, context.user, 'hotel.deleted', 'hotel', hotel.id);
      await writeDatabase(db);
      sendJson(res, 200, partnerState(db, context.user));
      return true;
    }
    const updated = normalizeHotel(body, hotel, hotel.partnerId);
    db.hotels[db.hotels.findIndex(item => item.id === hotel.id)] = updated;
    audit(db, context.user, 'hotel.updated', 'hotel', hotel.id);
    await writeDatabase(db);
    sendJson(res, 200, { hotel:updated, state:partnerState(db, context.user) });
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/packages'){
    if(!requirePartnerPermission(req, res, context, ['owner', 'manager', 'editor'])) return true;
    const hotel = hotelForUser(db, context.user, asString(body.hotelId));
    if(hotel === null){
      sendJson(res, 404, { error:'Smještaj nije pronađen.' });
      return true;
    }
    if(hotel === false){
      sendJson(res, 403, { error:'Ne možete dodati paket tuđem smještaju.' });
      return true;
    }
    const auctionPackage = normalizePackage(body, {}, hotel);
    if(!auctionPackage.dates.length){
      sendJson(res, 422, { error:'Paket mora imati najmanje jedan raspoloživ datum.' });
      return true;
    }
    db.packages.push(auctionPackage);
    db.bidsByPackage[auctionPackage.id] = [];
    audit(db, context.user, 'package.created', 'package', auctionPackage.id);
    await writeDatabase(db);
    sendJson(res, 201, { package:auctionPackage, state:partnerState(db, context.user) });
    return true;
  }

  const packageMatch = url.pathname.match(/^\/api\/packages\/([^/]+)$/);
  if(packageMatch && ['PUT', 'PATCH', 'DELETE'].includes(req.method)){
    const roles = req.method === 'DELETE' ? ['owner', 'manager'] : ['owner', 'manager', 'editor'];
    if(!requirePartnerPermission(req, res, context, roles)) return true;
    const packageId = decodeURIComponent(packageMatch[1]);
    const access = packageForUser(db, context.user, packageId);
    if(access === null){
      sendJson(res, 404, { error:'Paket nije pronađen.' });
      return true;
    }
    if(access === false){
      sendJson(res, 403, { error:'Ne možete upravljati tuđim paketom.' });
      return true;
    }
    const { auctionPackage, hotel } = access;
    if(req.method === 'DELETE'){
      const hasActivity = packageBids(db, auctionPackage.id).length
        || db.reservations.some(item => item.packageId === auctionPackage.id);
      if(hasActivity){
        sendJson(res, 409, { error:'Paket s ponudama ili rezervacijama nije moguće obrisati. Postavite status Arhiviran.' });
        return true;
      }
      db.packages = db.packages.filter(item => item.id !== auctionPackage.id);
      delete db.bidsByPackage[auctionPackage.id];
      Object.keys(db.watchlists).forEach(userId => {
        db.watchlists[userId] = db.watchlists[userId].filter(id => id !== auctionPackage.id);
      });
      audit(db, context.user, 'package.deleted', 'package', auctionPackage.id);
      await writeDatabase(db);
      sendJson(res, 200, partnerState(db, context.user));
      return true;
    }
    const updated = normalizePackage(body, auctionPackage, hotel);
    if(!updated.dates.length){
      sendJson(res, 422, { error:'Paket mora imati najmanje jedan raspoloživ datum.' });
      return true;
    }
    db.packages[db.packages.findIndex(item => item.id === auctionPackage.id)] = updated;
    audit(db, context.user, 'package.updated', 'package', auctionPackage.id, { status:updated.status });
    await writeDatabase(db);
    sendJson(res, 200, { package:updated, state:partnerState(db, context.user) });
    return true;
  }

  if(req.method === 'POST' && ['/api/team/invitations', '/api/admins'].includes(url.pathname)){
    if(!requirePartnerPermission(req, res, context, ['owner', 'manager'])) return true;
    const partnerId = context.user.role === 'admin' ? asString(body.partnerId, db.partners[0]?.id) : context.user.partnerId;
    const email = normalizeEmail(body.email);
    const role = allowedPartnerRoles.has(body.role) && body.role !== 'owner' ? body.role : 'manager';
    if(!partnerId || !validEmail(email) || !asString(body.name)){
      sendJson(res, 422, { error:'Ime, valjan e-mail i partner su obavezni.' });
      return true;
    }
    if(db.users.some(user => normalizeEmail(user.email) === email && user.partnerId === partnerId)){
      sendJson(res, 409, { error:'Ova osoba je već član tima.' });
      return true;
    }
    if(db.invitations.some(item => item.email === email && item.partnerId === partnerId && item.status === 'pending')){
      sendJson(res, 409, { error:'Aktivna pozivnica za ovu adresu već postoji.' });
      return true;
    }
    const token = createToken();
    const invitation = {
      id:randomUUID(),
      partnerId,
      name:asString(body.name).slice(0, 100),
      email,
      phone:asString(body.phone).slice(0, 40),
      role,
      tokenHash:hashToken(token),
      status:'pending',
      invitedBy:context.user.id,
      createdAt:now(),
      expiresAt:new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    db.invitations.push(invitation);
    audit(db, context.user, 'team.invitation_created', 'invitation', invitation.id, { email, role });
    await notify(db, {
      type:'partner.invitation',
      user:{ id:invitation.id, name:invitation.name, email:invitation.email },
      subject:'Pozvani ste u Partner centar',
      title:'Stigla vam je partnerska pozivnica',
      body:'Pozvani ste da se pridružite partnerskom timu na Auction Split platformi.',
      detail:`Razina pristupa: ${role}`,
      ctaLabel:'Otvori Auction Split',
      ctaPath:process.env.NODE_ENV === 'production' ? '/' : `/?invite=${encodeURIComponent(token)}`
    });
    await writeDatabase(db);
    sendJson(res, 201, {
      invitation:{ ...invitation, tokenHash:undefined, demoInvitationToken:process.env.NODE_ENV === 'production' ? undefined : token },
      state:partnerState(db, context.user)
    });
    return true;
  }

  const invitationMatch = url.pathname.match(/^\/api\/team\/invitations\/([^/]+)$/);
  if(invitationMatch && req.method === 'DELETE'){
    if(!requirePartnerPermission(req, res, context, ['owner', 'manager'])) return true;
    const invitation = db.invitations.find(item => item.id === decodeURIComponent(invitationMatch[1]));
    if(!invitation){
      sendJson(res, 404, { error:'Pozivnica nije pronađena.' });
      return true;
    }
    if(context.user.role !== 'admin' && invitation.partnerId !== context.user.partnerId){
      sendJson(res, 403, { error:'Ne možete upravljati tuđom pozivnicom.' });
      return true;
    }
    invitation.status = 'revoked';
    invitation.revokedAt = now();
    audit(db, context.user, 'team.invitation_revoked', 'invitation', invitation.id);
    await writeDatabase(db);
    sendJson(res, 200, partnerState(db, context.user));
    return true;
  }

  if(req.method === 'POST' && url.pathname === '/api/reset'){
    if(!requireUser(req, res, context, ['admin'])) return true;
    const adminId = context.user.id;
    const freshDb = await resetDatabase();
    const admin = freshDb.users.find(item => item.id === adminId && item.role === 'admin')
      || freshDb.users.find(item => item.role === 'admin');
    const createdSession = createSession(freshDb, admin, req);
    audit(freshDb, admin, 'demo.reset', 'database', 'demo-db');
    await writeDatabase(freshDb);
    sendJson(res, 200, partnerState(freshDb, admin), {
      'set-cookie':sessionCookie(createdSession.rawToken, req)
    });
    return true;
  }

  sendJson(res, 404, { error:'API ruta nije pronađena.' });
  return true;
}

module.exports = {
  handleApi,
  securityHeaders,
  sendJson
};
