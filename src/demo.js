import {
  api,
  byId,
  closeModal,
  escapeAttribute,
  escapeHtml,
  formatDuration,
  formatFullDate,
  formatMoney,
  formatShortDate,
  highestPackageBid,
  notify,
  openModal,
  packageBids,
  packageEconomy,
  refreshIcons,
  setBusy
} from './shared.js';
import {
  getAuthSession,
  initAuthUI,
  requireAuthenticatedUser
} from './auth.js';
import {croatianCities} from './locale.js';

const state = {
  hotels:[],
  packages:[],
  bidsByPackage:{},
  watchedPackages:new Set(),
  selectedDates:new Set(),
  city:'',
  openingBid:40,
  duration:60,
  activePackageId:'',
  requestedHotelId:'',
  requestedPackageId:'',
  map:null,
  mapLayer:null
};

const durationOptions = [15, 30, 60, 120, 180, 360, 720, 1440];
const month = { year:2026, index:7, label:'Kolovoz 2026.' };

function applyServerState(payload){
  state.hotels = Array.isArray(payload.hotels) ? payload.hotels : [];
  state.packages = Array.isArray(payload.packages) ? payload.packages : [];
  state.bidsByPackage = payload.bidsByPackage || {};
  state.watchedPackages = new Set(Array.isArray(payload.watchedPackages) ? payload.watchedPackages : []);
}

function parseQuery(){
  const params = new URLSearchParams(window.location.search);
  const bid = Number(params.get('bid'));
  const duration = Number(params.get('duration'));
  if(Number.isFinite(bid) && bid >= 10 && bid <= 600) state.openingBid = Math.round(bid);
  if(durationOptions.includes(duration)) state.duration = duration;
  state.city = params.get('city') || '';
  state.requestedHotelId = params.get('hotel') || '';
  state.requestedPackageId = params.get('package') || '';
}

function hotelById(hotelId){
  return state.hotels.find(item => item.id === hotelId);
}

function offerForPackage(auctionPackage){
  const hotel = hotelById(auctionPackage.hotelId);
  return hotel ? { hotel, package:auctionPackage } : null;
}

function allOffers(){
  return state.packages.map(offerForPackage).filter(Boolean);
}

function offerByPackageId(packageId){
  const auctionPackage = state.packages.find(item => item.id === packageId);
  return auctionPackage ? offerForPackage(auctionPackage) : null;
}

function packagePriceFit(auctionPackage){
  const gap = Number(auctionPackage.coldPrice) - state.openingBid;
  if(gap <= 0) return { rank:0, tone:'success', label:'U vašem budžetu' };
  if(gap <= 30) return { rank:1, tone:'warning', label:`Početna cijena +${formatMoney(gap)}` };
  return { rank:2, tone:'neutral', label:`Iznad budžeta +${formatMoney(gap)}` };
}

function packageMatchesDate(auctionPackage){
  if(!state.selectedDates.size) return true;
  return [...state.selectedDates].some(date => auctionPackage.dates.includes(date));
}

function visibleOffers(){
  return allOffers()
    .filter(({hotel, package:auctionPackage}) =>
      (!state.city || hotel.city === state.city) && packageMatchesDate(auctionPackage)
    )
    .filter(({package:auctionPackage}) => Number(auctionPackage.coldPrice) - state.openingBid <= 80)
    .sort((first, second) => {
      const priceFit = packagePriceFit(first.package).rank - packagePriceFit(second.package).rank;
      if(priceFit) return priceFit;
      const featured = Number(Boolean(second.hotel.featured)) - Number(Boolean(first.hotel.featured));
      if(featured) return featured;
      return Number(first.package.coldPrice) - Number(second.package.coldPrice);
    });
}

function availableDates(auctionPackage){
  const selected = [...state.selectedDates].filter(date => auctionPackage.dates.includes(date));
  return selected.length ? selected : auctionPackage.dates.slice(0, 1);
}

function nextBid(auctionPackage){
  return highestPackageBid(state, auctionPackage) + 1;
}

function populateControls(){
  const activeHotelIds = new Set(state.packages.map(item => item.hotelId));
  const activeCities = new Set(state.hotels.filter(hotel => activeHotelIds.has(hotel.id)).map(hotel => hotel.city).filter(Boolean));
  const cities = [...new Set([...croatianCities, ...activeCities])];
  byId('destinationSelect').innerHTML = [
    '<option value="">Cijela Hrvatska</option>',
    ...cities.map(city => `<option value="${escapeAttribute(city)}">${escapeHtml(city)}</option>`)
  ].join('');
  if(cities.includes(state.city)) byId('destinationSelect').value = state.city;
  else state.city = '';

  byId('durationSelect').innerHTML = durationOptions
    .map(value => `<option value="${value}">${formatDuration(value)}</option>`)
    .join('');
  byId('durationSelect').value = String(state.duration);
  byId('openingBidRange').value = String(state.openingBid);
  updateSearchLabels();
}

function minimumForDate(iso){
  const matches = allOffers().filter(({hotel, package:auctionPackage}) =>
    auctionPackage.dates.includes(iso) && (!state.city || hotel.city === state.city)
  );
  if(!matches.length) return null;
  return Math.min(...matches.map(({package:auctionPackage}) => Number(auctionPackage.coldPrice) || 0));
}

function renderCalendar(){
  const grid = byId('calendarGrid');
  const weekdays = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned'];
  const firstDay = new Date(month.year, month.index, 1);
  const daysInMonth = new Date(month.year, month.index + 1, 0).getDate();
  const offset = (firstDay.getDay() + 6) % 7;
  const cells = weekdays.map(day => `<span class="calendar-weekday">${day}</span>`);

  for(let index = 0; index < offset; index += 1){
    cells.push('<span class="calendar-spacer" aria-hidden="true"></span>');
  }
  for(let day = 1; day <= daysInMonth; day += 1){
    const iso = `${month.year}-${String(month.index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const minimum = minimumForDate(iso);
    const selected = state.selectedDates.has(iso);
    cells.push(`
      <button class="calendar-day${selected ? ' selected' : ''}${minimum === null ? ' unavailable' : ''}" type="button" data-date="${iso}" aria-pressed="${selected}">
        <span>${day}</span><small>${minimum === null ? '—' : `od ${formatMoney(minimum)}`}</small>
      </button>`);
  }
  grid.innerHTML = cells.join('');

  const dates = [...state.selectedDates].sort();
  byId('selectedDateChips').innerHTML = dates.length
    ? dates.map(date => `<button class="filter-chip selected" type="button" data-remove-date="${date}">${escapeHtml(formatFullDate(date))}<i data-lucide="x"></i></button>`).join('')
    : '<span class="empty-selection">Fleksibilni datumi: prikazujemo sve aktivne termine.</span>';
  updateSearchLabels();
  refreshIcons();
}

function updateSearchLabels(){
  const dates = [...state.selectedDates].sort();
  byId('openingBidOutput').textContent = formatMoney(state.openingBid);
  byId('openingBidLarge').textContent = formatMoney(state.openingBid);
  byId('dateSummary').textContent = dates.length ? dates.map(formatShortDate).join(', ') : 'Fleksibilno';
  byId('durationSummary').textContent = formatDuration(state.duration);
}

function resultSummary(){
  const place = state.city || 'Hrvatskoj';
  const dateText = state.selectedDates.size
    ? `za ${state.selectedDates.size === 1 ? 'odabrani datum' : `${state.selectedDates.size} odabrana datuma`}`
    : 'sa slobodnim terminima';
  return `${place} · ${dateText} · početna ponuda ${formatMoney(state.openingBid)}`;
}

function offerCard({hotel, package:auctionPackage}, index){
  const economy = packageEconomy(state, auctionPackage, hotel);
  const fit = packagePriceFit(auctionPackage);
  const watched = state.watchedPackages.has(auctionPackage.id);
  const image = hotel.images?.[0];
  const dates = auctionPackage.dates.slice(0, 4).map(formatShortDate).join(' · ');
  const amenities = (hotel.amenities || []).slice(0, 3);
  return `
    <article class="auction-card${index === 0 ? ' featured' : ''}" data-package-card="${escapeAttribute(auctionPackage.id)}">
      <div class="auction-card-media">
        ${image ? `<img src="${escapeAttribute(image)}" alt="${escapeAttribute(hotel.name)}" loading="lazy">` : '<div class="media-placeholder"><i data-lucide="image"></i><span>Fotografija stiže uskoro</span></div>'}
        <button class="save-button${watched ? ' active' : ''}" type="button" data-watch="${escapeAttribute(auctionPackage.id)}" aria-pressed="${watched}" title="${watched ? 'Ukloni iz praćenja' : 'Prati aukciju'}">
          <i data-lucide="heart"${watched ? ' class="filled-icon"' : ''}></i><span class="sr-only">${watched ? 'Ukloni iz praćenja' : 'Prati aukciju'}</span>
        </button>
        ${index === 0 ? '<span class="top-match-badge"><i data-lucide="sparkles"></i> Najbolji odabir</span>' : ''}
      </div>
      <div class="auction-card-content">
        <div class="card-heading-row">
          <div>
            <div class="status-line"><span class="status-dot live"></span>${escapeHtml(auctionPackage.name)} · ${escapeHtml(hotel.city)}</div>
            <h2>${escapeHtml(hotel.name)}</h2>
            <p class="location-line"><i data-lucide="map-pin"></i>${escapeHtml(hotel.street)}</p>
          </div>
          <span class="price-fit ${fit.tone}">${escapeHtml(fit.label)}</span>
        </div>
        <p class="hotel-summary">${escapeHtml(auctionPackage.description || hotel.description)}</p>
        <div class="amenity-list">
          <span><i data-lucide="bed-double"></i>${escapeHtml(auctionPackage.roomType)}</span>
          <span><i data-lucide="utensils"></i>${escapeHtml(auctionPackage.mealPlan)}</span>
          ${amenities.slice(0, 1).map(item => `<span><i data-lucide="check"></i>${escapeHtml(item)}</span>`).join('')}
        </div>
        <div class="availability-line"><i data-lucide="calendar-days"></i><span>${escapeHtml(dates || 'Datumi se ažuriraju')}</span></div>
        <div class="auction-card-footer">
          <div class="price-pair">
            <span>Hladna cijena <strong>${formatMoney(economy.coldPrice)}</strong></span>
            <span>Trenutna ponuda <strong>${formatMoney(economy.currentBid)}</strong></span>
          </div>
          <div class="card-action-block">
            <span>${auctionPackage.units} ${auctionPackage.units === 1 ? 'slobodna jedinica' : 'slobodne jedinice'} · do ${auctionPackage.maxGuests} gostiju</span>
            <button class="button primary" type="button" data-open-auction="${escapeAttribute(auctionPackage.id)}">Licitiraj <i data-lucide="arrow-right"></i></button>
          </div>
        </div>
      </div>
    </article>`;
}

function renderResults(){
  const results = visibleOffers();
  byId('resultCount').textContent = `${results.length} ${results.length === 1 ? 'aukcijski paket' : 'aukcijskih paketa'}`;
  byId('resultSummary').textContent = resultSummary();
  byId('hotelResults').innerHTML = results.length
    ? results.map(offerCard).join('')
    : `<div class="empty-results"><i data-lucide="search-x"></i><h2>Nema točnog matcha za ove uvjete</h2><p>Povećajte početnu ponudu, uklonite datum ili odaberite cijelu Hrvatsku.</p><button class="button secondary" type="button" data-clear-search>Očisti filtre</button></div>`;
  refreshIcons();
  refreshMapMarkers();
}

function auctionModalMarkup({hotel, package:auctionPackage}){
  const economy = packageEconomy(state, auctionPackage, hotel);
  const bids = packageBids(state, auctionPackage).slice().sort((first, second) => Number(second.amount) - Number(first.amount));
  const minimum = nextBid(auctionPackage);
  const watched = state.watchedPackages.has(auctionPackage.id);
  const image = hotel.images?.[0];
  const selectedDates = availableDates(auctionPackage);
  const user = getAuthSession().user;
  const isLeading = bids.some(bid => bid.self && Number(bid.amount) === economy.currentBid);
  return `
    <div class="auction-modal-layout">
      <div class="auction-modal-property">
        <div class="modal-property-image">${image ? `<img src="${escapeAttribute(image)}" alt="${escapeAttribute(hotel.name)}">` : '<div class="media-placeholder">Bez fotografije</div>'}</div>
        <div class="modal-property-copy">
          <span class="eyebrow">${escapeHtml(auctionPackage.name)}</span>
          <h2 id="auctionModalTitle">${escapeHtml(hotel.name)}</h2>
          <p><i data-lucide="map-pin"></i>${escapeHtml(hotel.street)}</p>
          <div class="package-specs"><span><i data-lucide="bed-double"></i>${escapeHtml(auctionPackage.roomType)}</span><span><i data-lucide="utensils"></i>${escapeHtml(auctionPackage.mealPlan)}</span><span><i data-lucide="users"></i>do ${auctionPackage.maxGuests} gostiju</span></div>
          <div class="modal-date-list"><i data-lucide="calendar-days"></i><span>${selectedDates.map(formatFullDate).join(' · ')}</span></div>
          <button class="text-button" type="button" data-watch="${escapeAttribute(auctionPackage.id)}"><i data-lucide="heart"${watched ? ' class="filled-icon"' : ''}></i>${watched ? 'Pratim ovu aukciju' : 'Prati ovu aukciju'}</button>
        </div>
      </div>
      <div class="auction-bid-panel">
        <div class="live-heading"><span class="status-dot live"></span><span>Bidanje je otvoreno</span><strong>${formatDuration(state.duration)}</strong></div>
        <div class="bid-price-grid">
          <div><span>Hladna cijena</span><strong>${formatMoney(economy.coldPrice)}</strong></div>
          <div><span>Trenutna ponuda</span><strong>${formatMoney(economy.currentBid)}</strong></div>
          <div><span>Razlika</span><strong class="positive">+${formatMoney(economy.difference)}</strong></div>
        </div>
        <form id="bidForm" class="bid-form" data-package-id="${escapeAttribute(auctionPackage.id)}">
          <label for="bidAmount">Vaša sljedeća ponuda</label>
          <div class="money-input">
            <input id="bidAmount" name="amount" type="number" min="${minimum}" max="50000" step="1" value="${minimum}" required data-autofocus>
            <div class="money-stepper" aria-label="Kontrole iznosa ponude">
              <button type="button" data-bid-step="1" aria-label="Povećaj ponudu za 1 euro" title="Povećaj ponudu za 1 euro"><i data-lucide="chevron-up"></i></button>
              <button type="button" data-bid-step="-5" aria-label="Smanji ponudu za 5 eura" title="Smanji ponudu za 5 eura"><i data-lucide="chevron-down"></i></button>
            </div>
            <span>€</span>
          </div>
          <small>${user ? `Prijavljeni ste kao ${escapeHtml(user.name)}.` : 'Za slanje ponude potrebna je prijava gosta.'} Minimalno ${formatMoney(minimum)}.</small>
          <button class="button primary wide" id="submitBidButton" type="submit">${user ? 'Pošalji ponudu' : 'Prijava i ponuda'} <i data-lucide="gavel"></i></button>
        </form>
        <div class="economy-strip">
          <div><span>Partner prima</span><strong>${formatMoney(economy.partnerTotal, 2)}</strong></div>
          <div><span>Platforma prima</span><strong>${formatMoney(economy.platformFee, 2)}</strong></div>
          <small>Podjela ${economy.commission.label} primjenjuje se samo na razliku iznad hladne cijene.</small>
        </div>
        <div class="bid-history">
          <div class="section-heading compact"><div><span class="eyebrow">Tijek aukcije</span><h3>${bids.length} ${bids.length === 1 ? 'ponuda' : 'ponude'}</h3></div></div>
          ${bids.length ? bids.map((bid, index) => `<div class="bid-history-row${bid.self ? ' self' : ''}"><span class="bid-avatar">${bid.self ? 'VI' : 'G'}</span><span><strong>${bid.self ? 'Vaša ponuda' : 'Anonimni gost'}</strong><small>${index === 0 ? 'Vodeća ponuda' : escapeHtml(bid.meta)}</small></span><strong>${formatMoney(bid.amount)}</strong></div>`).join('') : '<p class="empty-inline">Budite prvi gost koji će poslati ponudu.</p>'}
        </div>
        ${isLeading ? `<button class="button ghost wide" type="button" data-start-confirm="${escapeAttribute(auctionPackage.id)}">Potvrdi pobjedničku rezervaciju</button>` : '<p class="winner-note"><i data-lucide="shield-check"></i> Potvrda je dostupna korisniku s vodećom ponudom.</p>'}
      </div>
    </div>`;
}

function openAuction(packageId){
  const offer = offerByPackageId(packageId);
  if(!offer) return;
  state.activePackageId = packageId;
  byId('auctionModalBody').innerHTML = auctionModalMarkup(offer);
  openModal(byId('auctionModal'));
  refreshIcons();
}

async function submitBid(event){
  event.preventDefault();
  if(!requireAuthenticatedUser('guest')) return;
  const form = event.target.closest('form');
  const offer = offerByPackageId(form.dataset.packageId);
  if(!offer) return;
  const button = byId('submitBidButton');
  setBusy(button, true, 'Šaljem ponudu...');
  try{
    const payload = await api('/api/bids', {
      method:'POST',
      body:JSON.stringify({
        packageId:offer.package.id,
        amount:Number(form.amount.value),
        openingBid:state.openingBid,
        dates:availableDates(offer.package),
        duration:state.duration
      })
    });
    applyServerState(payload.state);
    renderResults();
    openAuction(offer.package.id);
    notify(`Ponuda od ${formatMoney(payload.bid.amount)} uspješno je spremljena.`);
  }catch(error){
    notify(error.message, 'error');
    if(error.code === 'AUTH_REQUIRED') requireAuthenticatedUser('guest');
    setBusy(button, false);
  }
}

async function toggleWatch(packageId){
  if(!requireAuthenticatedUser('guest')) return;
  const watching = !state.watchedPackages.has(packageId);
  try{
    const payload = await api('/api/watch', {
      method:'POST',
      body:JSON.stringify({ packageId, watching })
    });
    applyServerState(payload);
    renderResults();
    if(state.activePackageId === packageId && !byId('auctionModal').hidden) openAuction(packageId);
    notify(watching ? 'Aukcija je dodana u praćenje.' : 'Aukcija je uklonjena iz praćenja.');
  }catch(error){
    notify(error.message, 'error');
  }
}

function openConfirmation(packageId){
  if(!requireAuthenticatedUser('guest')) return;
  const offer = offerByPackageId(packageId);
  if(!offer) return;
  const economy = packageEconomy(state, offer.package, offer.hotel);
  const user = getAuthSession().user;
  byId('confirmPackageId').value = offer.package.id;
  byId('confirmationSummary').innerHTML = `
    <div><span>Smještaj</span><strong>${escapeHtml(offer.hotel.name)}</strong></div>
    <div><span>Paket i termin</span><strong>${escapeHtml(offer.package.name)} · ${availableDates(offer.package).map(formatShortDate).join(', ')}</strong></div>
    <div><span>Pobjednička ponuda</span><strong>${formatMoney(economy.currentBid)}</strong></div>`;
  const form = byId('confirmBookingForm');
  form.name.value = user.name;
  form.email.value = user.email;
  openModal(byId('confirmationModal'));
  refreshIcons();
}

async function submitConfirmation(event){
  event.preventDefault();
  if(!requireAuthenticatedUser('guest')) return;
  const form = event.currentTarget;
  const offer = offerByPackageId(form.packageId.value);
  if(!offer) return;
  const button = byId('confirmSubmitButton');
  setBusy(button, true, 'Potvrđujem...');
  try{
    const payload = await api('/api/reservations', {
      method:'POST',
      body:JSON.stringify({ packageId:offer.package.id, card:form.card.value })
    });
    applyServerState(payload.state);
    closeModal(byId('confirmationModal'));
    closeModal(byId('auctionModal'));
    renderResults();
    notify(`Rezervacija ${payload.reservation.bookingCode} je potvrđena.`);
  }catch(error){
    notify(error.message, 'error');
  }finally{
    setBusy(button, false);
  }
}

function clearSearch(){
  state.city = '';
  state.openingBid = 40;
  state.duration = 60;
  state.selectedDates.clear();
  populateControls();
  renderCalendar();
  renderResults();
}

function initMap(){
  if(state.map || !window.L || !byId('map')) return;
  state.map = L.map('map').setView([44.3, 16.5], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18, attribution:'&copy; OpenStreetMap' }).addTo(state.map);
  state.mapLayer = L.layerGroup().addTo(state.map);
}

function refreshMapMarkers(){
  if(!state.mapLayer) return;
  state.mapLayer.clearLayers();
  const cheapestByHotel = new Map();
  visibleOffers().forEach(offer => {
    const current = cheapestByHotel.get(offer.hotel.id);
    if(!current || offer.package.coldPrice < current.package.coldPrice) cheapestByHotel.set(offer.hotel.id, offer);
  });
  cheapestByHotel.forEach(({hotel, package:auctionPackage}) => {
    L.marker([hotel.lat, hotel.lng])
      .bindPopup(`<strong>${escapeHtml(hotel.name)}</strong><br>${escapeHtml(auctionPackage.name)} · ${formatMoney(auctionPackage.coldPrice)}`)
      .addTo(state.mapLayer);
  });
}

function openMap(){
  openModal(byId('mapModal'));
  initMap();
  refreshMapMarkers();
  window.setTimeout(() => state.map?.invalidateSize(), 50);
}

function bindEvents(){
  byId('destinationSelect').addEventListener('change', event => {
    state.city = event.target.value;
    renderCalendar();
    renderResults();
  });
  byId('openingBidRange').addEventListener('input', event => {
    state.openingBid = Number(event.target.value);
    updateSearchLabels();
    renderResults();
  });
  byId('durationSelect').addEventListener('change', event => {
    state.duration = Number(event.target.value);
    updateSearchLabels();
    renderResults();
  });
  byId('applySearchButton').addEventListener('click', () => {
    renderResults();
    byId('resultsSection').scrollIntoView({ behavior:'smooth', block:'start' });
  });
  byId('clearSearchButton').addEventListener('click', clearSearch);
  byId('openMapButton').addEventListener('click', openMap);
  byId('confirmBookingForm').addEventListener('submit', submitConfirmation);

  byId('calendarGrid').addEventListener('click', event => {
    const button = event.target.closest('[data-date]');
    if(!button || button.classList.contains('unavailable')) return;
    const date = button.dataset.date;
    if(state.selectedDates.has(date)) state.selectedDates.delete(date);
    else state.selectedDates.add(date);
    renderCalendar();
    renderResults();
  });
  byId('selectedDateChips').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-date]');
    if(!button) return;
    state.selectedDates.delete(button.dataset.removeDate);
    renderCalendar();
    renderResults();
  });
  document.addEventListener('click', event => {
    const openButton = event.target.closest('[data-open-auction]');
    if(openButton) openAuction(openButton.dataset.openAuction);
    const watchButton = event.target.closest('[data-watch]');
    if(watchButton) toggleWatch(watchButton.dataset.watch);
    const confirmButton = event.target.closest('[data-start-confirm]');
    if(confirmButton) openConfirmation(confirmButton.dataset.startConfirm);
    if(event.target.closest('[data-clear-search]')) clearSearch();
  });
  byId('auctionModalBody').addEventListener('submit', event => {
    if(event.target.id === 'bidForm') submitBid(event);
  });
  byId('auctionModalBody').addEventListener('click', event => {
    const button = event.target.closest('[data-bid-step]');
    if(!button) return;
    const input = byId('bidAmount');
    if(!input) return;
    const step = Number(button.dataset.bidStep) || 5;
    const minimum = Number(input.min) || 0;
    const maximum = Number(input.max) || 50000;
    const current = Number(input.value) || minimum;
    input.value = String(Math.max(minimum, Math.min(maximum, current + step)));
    input.focus();
  });
  window.addEventListener('auction:auth-changed', loadState);
}

async function loadState(){
  try{
    const payload = await api('/api/state');
    applyServerState(payload);
    const transportLabel = payload.transport === 'browser-demo' ? ' Prezentacijska baza aktivna' : ' Sustav aktivan';
    byId('backendIndicator').innerHTML = `<span class="status-dot live"></span>${payload.user ? ` Prijavljen: ${escapeHtml(payload.user.name)}` : transportLabel}`;
    populateControls();
    renderCalendar();
    renderResults();
    if(state.activePackageId && !byId('auctionModal').hidden) openAuction(state.activePackageId);
  }catch(error){
    byId('backendIndicator').innerHTML = '<span class="status-dot error"></span> Aukcije se trenutačno ne mogu učitati';
    notify(error.message || 'Aukcije se trenutačno ne mogu učitati. Pokušajte ponovno.', 'error');
  }
}

async function init(){
  parseQuery();
  bindEvents();
  await initAuthUI();
  await loadState();
  const requestedOffer = state.requestedPackageId
    ? offerByPackageId(state.requestedPackageId)
    : allOffers().find(offer => offer.hotel.id === state.requestedHotelId);
  if(requestedOffer) openAuction(requestedOffer.package.id);
}

init();
