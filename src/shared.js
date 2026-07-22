export const byId = id => document.getElementById(id);

const localeKey = 'auction-split:locale';
export function getLocale(){
  return localStorage.getItem(localeKey) || 'hr-HR';
}
export function setLocale(locale){
  localStorage.setItem(localeKey, locale);
  document.documentElement.lang = locale;
}

let csrfToken = '';
let apiTransport = 'server';

export function getApiTransport(){
  return apiTransport;
}

function setApiTransport(value){
  if(apiTransport === value) return;
  apiTransport = value;
  window.dispatchEvent(new CustomEvent('auction-split:transport', { detail:{ transport:value } }));
}

export function setCsrfToken(value){
  csrfToken = String(value || '');
}

export function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#039;'
  }[character]));
}

export function escapeAttribute(value){
  return escapeHtml(value).replace(/`/g, '&#096;');
}

export function asList(value){
  if(Array.isArray(value)){
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export async function api(path, options = {}){
  const method = String(options.method || 'GET').toUpperCase();
  const requestOptions = {
    ...options,
    credentials:'same-origin',
    headers:{
      'content-type':'application/json',
      ...(csrfToken && !['GET', 'HEAD'].includes(method) ? {'x-csrf-token':csrfToken} : {}),
      ...(options.headers || {})
    }
  };
  let response;
  try{
    response = await fetch(path, requestOptions);
  }catch{
    throw new Error('API nije dostupan. Pokrenite lokalni server ili otvorite split.auction.');
  }
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  let payload = {};
  if(contentType.includes('application/json')){
    try{ payload = raw ? JSON.parse(raw) : {}; }
    catch{ payload = {}; }
  }else if(path.startsWith('/api/') && (response.status === 404 || response.status === 405 || contentType.includes('text/html'))){
    throw new Error('API ruta nije dostupna na ovom hostu. Otvorite aplikaciju preko lokalnog servera ili split.auction.');
  }
  if(!response.ok){
    const error = new Error(payload.error || 'Server nije prihvatio zahtjev.');
    error.status = response.status;
    error.code = payload.code || '';
    error.payload = payload;
    throw error;
  }
  setApiTransport('server');
  return payload;
}

export function formatMoney(value, digits = 0){
  return new Intl.NumberFormat(getLocale(), {
    style:'currency',
    currency:'EUR',
    minimumFractionDigits:digits,
    maximumFractionDigits:digits
  }).format(Number(value) || 0);
}

export function formatShortDate(iso){
  const [year, month, day] = String(iso).split('-').map(Number);
  if(!year || !month || !day) return String(iso || '');
  return new Intl.DateTimeFormat(getLocale(), {day:'numeric',month:'short'}).format(new Date(year, month - 1, day));
}

export function formatFullDate(iso){
  const [year, month, day] = String(iso).split('-').map(Number);
  if(!year || !month || !day) return String(iso || '');
  return new Intl.DateTimeFormat(getLocale(), {weekday:'short',day:'numeric',month:'long'}).format(new Date(year, month - 1, day));
}

export function formatDuration(minutes){
  const value = Number(minutes) || 0;
  if(value < 60) return `${value} min`;
  if(value === 60) return '1 sat';
  if(value === 120) return '2 sata';
  if(value === 180) return '3 sata';
  if(value === 1440) return '24 sata';
  if(value % 60 === 0) return `${value / 60} sati`;
  return `${value} min`;
}

export function commissionFor(hotel){
  return hotel.partnerType === 'small'
    ? {partner:60, platform:40, label:'60 / 40'}
    : {partner:70, platform:30, label:'70 / 30'};
}

export function hotelBids(state, hotel){
  return Array.isArray(state.bidsByHotel?.[hotel.id]) ? state.bidsByHotel[hotel.id] : [];
}

export function highestBid(state, hotel){
  return Math.max(
    Number(hotel.startPrice) || 0,
    ...hotelBids(state, hotel).map(bid => Number(bid.amount) || 0)
  );
}

export function auctionEconomy(state, hotel){
  const coldPrice = Number(hotel.startPrice) || 0;
  const currentBid = highestBid(state, hotel);
  const difference = Math.max(0, currentBid - coldPrice);
  const commission = commissionFor(hotel);
  const partnerBonus = difference * commission.partner / 100;
  const platformFee = difference * commission.platform / 100;
  return {
    coldPrice,
    currentBid,
    difference,
    partnerBonus,
    partnerTotal:coldPrice + partnerBonus,
    platformFee,
    commission
  };
}

export function packageBids(state, auctionPackage){
  return Array.isArray(state.bidsByPackage?.[auctionPackage.id]) ? state.bidsByPackage[auctionPackage.id] : [];
}

export function highestPackageBid(state, auctionPackage){
  return Math.max(
    Number(auctionPackage.coldPrice) || 0,
    ...packageBids(state, auctionPackage).map(bid => Number(bid.amount) || 0)
  );
}

export function packageEconomy(state, auctionPackage, hotel){
  const coldPrice = Number(auctionPackage.coldPrice) || 0;
  const currentBid = highestPackageBid(state, auctionPackage);
  const difference = Math.max(0, currentBid - coldPrice);
  const commission = commissionFor(hotel);
  const partnerBonus = difference * commission.partner / 100;
  const platformFee = difference * commission.platform / 100;
  return {
    coldPrice,
    currentBid,
    difference,
    partnerBonus,
    partnerTotal:coldPrice + partnerBonus,
    platformFee,
    commission
  };
}

export function refreshIcons(){
  if(window.lucide?.createIcons){
    window.lucide.createIcons({attrs:{'aria-hidden':'true','stroke-width':'1.8'}});
  }
}

export function notify(message, tone = 'default'){
  let region = document.querySelector('[data-toast-region]');
  if(!region){
    region = document.createElement('div');
    region.className = 'toast-region';
    region.dataset.toastRegion = '';
    region.setAttribute('aria-live','polite');
    document.body.appendChild(region);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.innerHTML = `<i data-lucide="${tone === 'error' ? 'circle-alert' : 'circle-check'}"></i><span>${escapeHtml(message)}</span>`;
  region.appendChild(toast);
  refreshIcons();
  window.setTimeout(() => toast.remove(), 4200);
}

export function openModal(modal){
  if(!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const focusTarget = modal.querySelector('[data-autofocus],button,input,select,textarea');
  window.setTimeout(() => focusTarget?.focus(), 0);
}

export function closeModal(modal){
  if(!modal) return;
  modal.hidden = true;
  if(!document.querySelector('.modal-backdrop:not([hidden])')){
    document.body.classList.remove('modal-open');
  }
}

export function setBusy(button, busy, busyLabel = 'Spremanje...'){
  if(!button) return;
  if(busy){
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(busyLabel)}`;
  }else{
    button.disabled = false;
    button.innerHTML = button.dataset.label || button.innerHTML;
    delete button.dataset.label;
    refreshIcons();
  }
}
