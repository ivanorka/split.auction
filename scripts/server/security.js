const {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual
} = require('node:crypto');

const SESSION_COOKIE = 'auction_split_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLength: 64 };

function normalizeEmail(value){
  return String(value || '').trim().toLowerCase();
}

function validEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function passwordValidation(password){
  const value = String(password || '');
  const errors = [];
  if(value.length < 8) errors.push('Lozinka mora imati najmanje 8 znakova.');
  if(value.length > 128) errors.push('Lozinka može imati najviše 128 znakova.');
  if(!/[a-zčćžšđ]/i.test(value)) errors.push('Lozinka mora sadržavati slovo.');
  if(!/\d/.test(value)) errors.push('Lozinka mora sadržavati broj.');
  return errors;
}

function encodeToken(buffer){
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createToken(bytes = 32){
  return encodeToken(randomBytes(bytes));
}

function hashToken(token){
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function scryptAsync(password, salt, options){
  return new Promise((resolve, reject) => {
    scrypt(password, salt, options.keyLength, options, (error, key) => {
      if(error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password){
  const validation = passwordValidation(password);
  if(validation.length) throw new Error(validation[0]);
  const salt = createToken(18);
  const key = await scryptAsync(String(password), salt, SCRYPT_PARAMS);
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt,
    key.toString('hex')
  ].join('$');
}

async function verifyPassword(password, storedHash){
  const parts = String(storedHash || '').split('$');
  if(parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, rawN, rawR, rawP, salt, expectedHex] = parts;
  const options = {
    N: Number(rawN),
    r: Number(rawR),
    p: Number(rawP),
    keyLength: expectedHex.length / 2
  };
  if(!options.N || !options.r || !options.p || !options.keyLength) return false;
  try{
    const actual = await scryptAsync(String(password || ''), salt, options);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }catch{
    return false;
  }
}

function parseCookies(header){
  return String(header || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if(separator === -1) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if(name){
      try{ cookies[name] = decodeURIComponent(value); }
      catch{ cookies[name] = value; }
    }
    return cookies;
  }, {});
}

function sessionTokenFromRequest(req){
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || '';
}

function shouldUseSecureCookie(req){
  return process.env.NODE_ENV === 'production'
    || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
}

function sessionCookie(token, req){
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if(shouldUseSecureCookie(req)) attributes.push('Secure');
  return attributes.join('; ');
}

function expiredSessionCookie(req){
  const attributes = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if(shouldUseSecureCookie(req)) attributes.push('Secure');
  return attributes.join('; ');
}

function publicUser(user){
  if(!user) return null;
  return {
    id:user.id,
    name:user.name,
    email:user.email,
    phone:user.phone || '',
    role:user.role,
    partnerId:user.partnerId || null,
    partnerRole:user.partnerRole || null,
    status:user.status,
    emailVerified:Boolean(user.emailVerifiedAt),
    createdAt:user.createdAt
  };
}

module.exports = {
  SESSION_TTL_SECONDS,
  createToken,
  expiredSessionCookie,
  hashPassword,
  hashToken,
  normalizeEmail,
  passwordValidation,
  publicUser,
  sessionCookie,
  sessionTokenFromRequest,
  validEmail,
  verifyPassword
};
