import {
  api,
  asList,
  byId,
  closeModal,
  escapeAttribute,
  escapeHtml,
  formatDuration,
  formatMoney,
  formatShortDate,
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
  openAuthDialog,
  refreshAuthSession
} from './auth.js';

const state = {
  hotels:[],
  packages:[],
  team:[],
  invitations:[],
  reservations:[],
  bidsByPackage:{},
  currentUser:null,
  partner:null,
  resetAllowed:false,
  activeHotelId:'',
  activePackageId:'',
  deleteHotelArmed:false,
  deletePackageArmed:false,
  resetArmed:false
};

const defaultDates = ['2026-08-24', '2026-08-25'];
const defaultImages = ['/assets/media/split-city-hotel.jpg'];

function updateGalleryImageCount(){
  const form = byId('propertyForm');
  const count = asList(form.images.value).slice(0, 20).length;
  byId('galleryImageCount').textContent = `${count} / 20 fotografija`;
}

function applyServerState(payload){
  state.hotels = Array.isArray(payload.hotels) ? payload.hotels : [];
  state.packages = Array.isArray(payload.packages) ? payload.packages : [];
  state.team = Array.isArray(payload.team) ? payload.team : [];
  state.invitations = Array.isArray(payload.invitations) ? payload.invitations : [];
  state.reservations = Array.isArray(payload.reservations) ? payload.reservations : [];
  state.bidsByPackage = payload.bidsByPackage || {};
  state.currentUser = payload.currentUser || null;
  state.partner = payload.partner || null;
  state.resetAllowed = Boolean(payload.resetAllowed);
}

function hotelById(hotelId){
  return state.hotels.find(item => item.id === hotelId);
}

function totalPartnerRevenue(){
  return state.reservations.reduce((sum, reservation) => {
    const auctionPackage = state.packages.find(item => item.id === reservation.packageId);
    const hotel = hotelById(reservation.hotelId);
    if(!auctionPackage || !hotel) return sum;
    const difference = Math.max(0, Number(reservation.amount) - Number(auctionPackage.coldPrice));
    const partnerShare = hotel.partnerType === 'small' ? .6 : .7;
    return sum + Number(auctionPackage.coldPrice) + difference * partnerShare;
  }, 0);
}

function statusLabel(status){
  return ({ draft:'Skica', active:'Aktivan', paused:'Pauziran', sold_out:'Rasprodano', archived:'Arhiviran' })[status] || status;
}

function renderMetrics(){
  const freeUnits = state.packages.filter(item => item.status === 'active').reduce((sum, item) => sum + Number(item.units || 0), 0);
  const activePackages = state.packages.filter(item => item.status === 'active').length;
  const totalBids = Object.values(state.bidsByPackage).reduce((sum, bids) => sum + (Array.isArray(bids) ? bids.length : 0), 0);
  byId('metricInventory').textContent = String(freeUnits);
  byId('metricAuctions').textContent = String(activePackages);
  byId('metricBids').textContent = String(totalBids);
  byId('metricRevenue').textContent = formatMoney(totalPartnerRevenue(), 2);
  byId('partnerPropertyCount').textContent = `${state.hotels.length} ${state.hotels.length === 1 ? 'objekt' : 'objekata'}`;
  byId('partnerBookingCount').textContent = `${state.reservations.length} potvrda`;
  byId('partnerPackageCount').textContent = `${state.packages.length}`;
}

function renderRevenueChart(){
  const rows = state.packages
    .map(auctionPackage => {
      const hotel = hotelById(auctionPackage.hotelId);
      return hotel ? { auctionPackage, hotel, fee:packageEconomy(state, auctionPackage, hotel).platformFee } : null;
    })
    .filter(Boolean)
    .sort((first, second) => second.fee - first.fee)
    .slice(0, 6);
  const max = Math.max(1, ...rows.map(row => row.fee));
  byId('revenueChart').innerHTML = rows.length
    ? rows.map(({auctionPackage, hotel, fee}) => `
        <div class="chart-row">
          <span title="${escapeAttribute(`${hotel.name} · ${auctionPackage.name}`)}">${escapeHtml(auctionPackage.name)}</span>
          <div class="chart-track"><div class="chart-fill" style="width:${Math.max(4, fee / max * 100)}%"></div></div>
          <strong>${formatMoney(fee, 2)}</strong>
        </div>`).join('')
    : '<p class="empty-inline">Nema podataka za prikaz.</p>';
}

function renderRecentActivity(){
  const bidEvents = state.packages.flatMap(auctionPackage => {
    const hotel = hotelById(auctionPackage.hotelId);
    return packageBids(state, auctionPackage).map(bid => ({
      type:'bid',
      title:`Nova ponuda · ${hotel?.name || 'Smještaj'}`,
      meta:`${auctionPackage.name} · ${formatMoney(bid.amount)}`,
      time:bid.createdAt
    }));
  });
  const bookingEvents = state.reservations.map(reservation => ({
    type:'booking',
    title:`Potvrđen ${reservation.hotel}`,
    meta:`${reservation.bookingCode} · ${formatMoney(reservation.amount)}`,
    time:reservation.createdAt
  }));
  const events = [...bidEvents, ...bookingEvents]
    .sort((first, second) => new Date(second.time) - new Date(first.time))
    .slice(0, 6);
  byId('activityList').innerHTML = events.length
    ? events.map(event => `<div class="activity-row"><span class="activity-icon"><i data-lucide="${event.type === 'bid' ? 'gavel' : 'badge-check'}"></i></span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.meta)}</small></div></div>`).join('')
    : '<p class="empty-inline">Aktivnosti će se pojaviti nakon prve ponude.</p>';
}

function propertyRows(){
  return state.hotels.map(hotel => {
    const image = hotel.images?.[0];
    const packageCount = state.packages.filter(item => item.hotelId === hotel.id).length;
    return `
      <tr>
        <td><button class="property-cell" type="button" data-edit-hotel="${escapeAttribute(hotel.id)}">${image ? `<img src="${escapeAttribute(image)}" alt="">` : '<span class="table-image-placeholder"><i data-lucide="building-2"></i></span>'}<span><strong>${escapeHtml(hotel.name)}</strong><small>${escapeHtml(hotel.city)} · ${escapeHtml(hotel.street)}</small></span></button></td>
        <td><span class="partner-type">${hotel.partnerType === 'small' ? 'Apartman 60/40' : 'Hotel 70/30'}</span></td>
        <td><strong>${packageCount}</strong><small class="table-note">aukcijskih paketa</small></td>
        <td><strong>${hotel.totalRooms}</strong><small class="table-note">ukupno jedinica</small></td>
        <td><span class="status-badge ${hotel.status === 'active' ? 'active' : ''}"><span class="status-dot ${hotel.status === 'active' ? 'live' : ''}"></span>${hotel.status === 'active' ? 'Aktivan' : hotel.status === 'draft' ? 'Skica' : 'Arhiviran'}</span></td>
        <td class="table-actions"><button class="icon-button" type="button" data-edit-hotel="${escapeAttribute(hotel.id)}" title="Uredi smještaj"><i data-lucide="pencil"></i><span class="sr-only">Uredi smještaj</span></button></td>
      </tr>`;
  }).join('');
}

function renderProperties(){
  const rows = state.hotels.length ? propertyRows() : '<tr><td colspan="6"><div class="empty-inline">Još nema konfiguriranih objekata.</div></td></tr>';
  byId('propertiesTableBody').innerHTML = rows;
  byId('propertiesTableBodyMirror').innerHTML = rows;
}

function packageRows(){
  return state.packages.map(auctionPackage => {
    const hotel = hotelById(auctionPackage.hotelId);
    const economy = hotel ? packageEconomy(state, auctionPackage, hotel) : null;
    const bids = packageBids(state, auctionPackage);
    return `
      <tr>
        <td><button class="table-name-button" type="button" data-edit-package="${escapeAttribute(auctionPackage.id)}"><strong>${escapeHtml(auctionPackage.name)}</strong><small>${escapeHtml(hotel?.name || 'Nepoznat objekt')}</small></button></td>
        <td>${escapeHtml(auctionPackage.roomType)}<small class="table-note">${escapeHtml(auctionPackage.mealPlan)}</small></td>
        <td><strong>${formatMoney(auctionPackage.coldPrice)}</strong><small class="table-note">hladna cijena</small></td>
        <td>${auctionPackage.dates.slice(0, 2).map(formatShortDate).join(' · ')}<small class="table-note">${auctionPackage.dates.length} termina</small></td>
        <td><strong>${auctionPackage.units}</strong><small class="table-note">slobodnih jedinica</small></td>
        <td><span class="status-badge ${auctionPackage.status === 'active' ? 'active' : ''}">${escapeHtml(statusLabel(auctionPackage.status))}</span></td>
        <td>${bids.length}<small class="table-note">trenutno ${formatMoney(economy?.currentBid || auctionPackage.coldPrice)}</small></td>
        <td class="table-actions"><button class="icon-button" type="button" data-edit-package="${escapeAttribute(auctionPackage.id)}" title="Uredi paket"><i data-lucide="pencil"></i><span class="sr-only">Uredi paket</span></button></td>
      </tr>`;
  }).join('');
}

function renderPackages(){
  byId('packagesTableBody').innerHTML = state.packages.length
    ? packageRows()
    : '<tr><td colspan="8"><div class="empty-inline">Dodajte prvi aukcijski paket.</div></td></tr>';
}

function renderAuctions(){
  const active = state.packages.filter(item => item.status === 'active');
  byId('auctionsTableBody').innerHTML = active.length ? active.map(auctionPackage => {
    const hotel = hotelById(auctionPackage.hotelId);
    const economy = packageEconomy(state, auctionPackage, hotel);
    const bids = packageBids(state, auctionPackage);
    return `
      <tr>
        <td><strong>${escapeHtml(auctionPackage.name)}</strong><small class="table-note">${escapeHtml(hotel.name)}</small></td>
        <td>${formatMoney(economy.coldPrice)}</td><td><strong>${formatMoney(economy.currentBid)}</strong></td>
        <td><span class="positive">+${formatMoney(economy.difference)}</span></td><td>${bids.length}</td><td>${formatDuration(auctionPackage.duration)}</td>
        <td><strong>${formatMoney(economy.partnerTotal, 2)}</strong><small class="table-note">partner</small></td>
        <td><strong>${formatMoney(economy.platformFee, 2)}</strong><small class="table-note">platforma</small></td>
        <td><button class="button tertiary small" type="button" data-open-public-auction="${escapeAttribute(auctionPackage.id)}">Otvori</button></td>
      </tr>`;
  }).join('') : '<tr><td colspan="9"><div class="empty-inline">Nema aktivnih paketa.</div></td></tr>';
}

function renderBookings(){
  byId('bookingsTableBody').innerHTML = state.reservations.length
    ? state.reservations.map(reservation => `<tr data-reservation-row="${escapeAttribute(reservation.id)}"><td><strong>${escapeHtml(reservation.name)}</strong><small class="table-note">${escapeHtml(reservation.email)}</small></td><td>${escapeHtml(reservation.hotel)}<small class="table-note">${escapeHtml(reservation.packageName || '')}</small></td><td>${escapeHtml(reservation.dates)}</td><td><strong>${formatMoney(reservation.amount)}</strong><small class="table-note">${escapeHtml(reservation.bookingCode || '')}</small></td><td><div class="booking-controls"><select class="table-select" data-reservation-status ${canManageBookings() ? '' : 'disabled'}><option value="confirmed" ${reservation.status === 'confirmed' ? 'selected' : ''}>Potvrđeno</option><option value="checked_in" ${reservation.status === 'checked_in' ? 'selected' : ''}>Gost prijavljen</option><option value="completed" ${reservation.status === 'completed' ? 'selected' : ''}>Završeno</option><option value="cancelled" ${reservation.status === 'cancelled' ? 'selected' : ''}>Otkazano</option></select><select class="table-select" data-payment-status ${canManageBookings() ? '' : 'disabled'}><option value="demo_authorized" ${reservation.paymentStatus === 'demo_authorized' ? 'selected' : ''}>Autorizirano</option><option value="paid" ${reservation.paymentStatus === 'paid' ? 'selected' : ''}>Plaćeno</option><option value="refunded" ${reservation.paymentStatus === 'refunded' ? 'selected' : ''}>Vraćeno</option></select></div></td></tr>`).join('')
    : '<tr><td colspan="5"><div class="empty-inline">Još nema potvrđenih rezervacija.</div></td></tr>';
}

async function updateReservation(row){
  const status = row.querySelector('[data-reservation-status]').value;
  const paymentStatus = row.querySelector('[data-payment-status]').value;
  try{
    const payload = await api(`/api/reservations/${encodeURIComponent(row.dataset.reservationRow)}`, {
      method:'PATCH',
      body:JSON.stringify({ status, paymentStatus })
    });
    applyServerState(payload);
    renderAll();
    notify('Status rezervacije je spremljen.');
  }catch(error){
    notify(error.message, 'error');
    await loadPartnerState();
  }
}

function renderTeam(){
  const members = state.team.map(member => `
    <article class="team-row"><span class="team-avatar">${escapeHtml(member.name.split(/\s+/).map(part => part[0]).slice(0, 2).join(''))}</span><div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.email)}${member.phone ? ` · ${escapeHtml(member.phone)}` : ''}</small></div><span class="partner-type">${escapeHtml(member.partnerRole || member.role)}</span></article>`);
  const pending = state.invitations.filter(item => item.status === 'pending').map(invitation => `
    <article class="team-row pending"><span class="team-avatar"><i data-lucide="mail"></i></span><div><strong>${escapeHtml(invitation.name)}</strong><small>${escapeHtml(invitation.email)} · pozivnica čeka prihvat</small></div><button class="icon-button" type="button" data-revoke-invitation="${escapeAttribute(invitation.id)}" title="Povuci pozivnicu"><i data-lucide="x"></i><span class="sr-only">Povuci pozivnicu</span></button></article>`);
  byId('teamList').innerHTML = [...members, ...pending].join('') || '<p class="empty-inline">Dodajte prvog člana tima.</p>';
}

function renderIdentity(){
  const label = state.partner?.businessName || (state.currentUser?.role === 'admin' ? 'Platforma Auction Split' : 'Partner portfolio');
  byId('partnerIdentityName').textContent = label;
  byId('partnerIdentityAvatar').textContent = label.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  byId('resetPartnerDemo').hidden = !state.resetAllowed;
}

function canEditInventory(){
  return state.currentUser?.role === 'admin' || ['owner', 'manager', 'editor'].includes(state.currentUser?.partnerRole);
}

function canManageTeam(){
  return state.currentUser?.role === 'admin' || ['owner', 'manager'].includes(state.currentUser?.partnerRole);
}

function canDeleteInventory(){
  return state.currentUser?.role === 'admin' || ['owner', 'manager'].includes(state.currentUser?.partnerRole);
}

function canManageBookings(){
  return state.currentUser?.role === 'admin' || ['owner', 'manager'].includes(state.currentUser?.partnerRole);
}

function renderPermissions(){
  byId('addPropertyButton').hidden = !canEditInventory();
  byId('addPackageButton').hidden = !canEditInventory();
  byId('teamInvitePanel').hidden = !canManageTeam();
}

function renderAll(){
  renderIdentity();
  renderPermissions();
  renderMetrics();
  renderRevenueChart();
  renderRecentActivity();
  renderProperties();
  renderPackages();
  renderAuctions();
  renderBookings();
  renderTeam();
  refreshIcons();
}

function setPanel(panelId){
  document.querySelectorAll('[data-partner-panel]').forEach(button => {
    const active = button.dataset.partnerPanel === panelId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-panel-content]').forEach(panel => {
    panel.hidden = panel.dataset.panelContent !== panelId;
  });
  const headings = {
    overview:['Pregled poslovanja', 'Učinak vašeg inventara i zadnje aktivnosti.'],
    properties:['Smještaji', 'Upravljajte profilima hotela i apartmana.'],
    packages:['Paketi', 'Kreirajte termine, hladne cijene i raspoložive jedinice.'],
    auctions:['Aukcije', 'Pratite ponude i podjelu novostvorene vrijednosti.'],
    bookings:['Potvrde', 'Pobjedničke rezervacije za vaše pakete.'],
    team:['Tim i pristupi', 'Pozovite osobe koje uređuju inventar i pakete.']
  };
  const [title, subtitle] = headings[panelId] || headings.overview;
  byId('partnerPageTitle').textContent = title;
  byId('partnerPageSubtitle').textContent = subtitle;
  window.location.hash = panelId;
}

function resetPropertyForm(){
  state.activeHotelId = '';
  state.deleteHotelArmed = false;
  const form = byId('propertyForm');
  form.reset();
  form.name.value = 'Novi demo hotel';
  form.city.value = 'Split';
  form.street.value = 'Split, Hrvatska';
  form.lat.value = '43.5081';
  form.lng.value = '16.4402';
  form.partnerType.value = 'hotel';
  form.totalRooms.value = '21';
  form.images.value = defaultImages.join('\n');
  updateGalleryImageCount();
  form.description.value = 'Slobodan demo kapacitet spreman za aukciju.';
  form.amenities.value = 'Doručak, Wi-Fi, Parking';
  form.status.value = 'active';
  byId('propertyModalTitle').textContent = 'Dodaj smještaj';
  byId('deletePropertyButton').hidden = true;
}

function populatePropertyForm(hotel){
  state.activeHotelId = hotel.id;
  state.deleteHotelArmed = false;
  const form = byId('propertyForm');
  ['name', 'city', 'street', 'lat', 'lng', 'partnerType', 'totalRooms', 'description', 'status'].forEach(key => {
    form[key].value = hotel[key] ?? '';
  });
  form.images.value = (hotel.images || []).join('\n');
  updateGalleryImageCount();
  form.amenities.value = (hotel.amenities || []).join(', ');
  form.featured.checked = Boolean(hotel.featured);
  byId('propertyModalTitle').textContent = `Uredi: ${hotel.name}`;
  byId('deletePropertyButton').hidden = !canDeleteInventory();
  byId('deletePropertyButton').innerHTML = '<i data-lucide="trash-2"></i> Obriši';
}

function propertyPayload(form){
  return {
    name:form.name.value, city:form.city.value, street:form.street.value,
    lat:Number(form.lat.value), lng:Number(form.lng.value),
    partnerType:form.partnerType.value, totalRooms:Number(form.totalRooms.value),
    images:asList(form.images.value).slice(0, 20), description:form.description.value,
    amenities:asList(form.amenities.value), featured:form.featured.checked, status:form.status.value
  };
}

async function saveProperty(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId('savePropertyButton');
  const editing = Boolean(state.activeHotelId);
  setBusy(button, true, 'Spremam...');
  try{
    const endpoint = editing ? `/api/hotels/${encodeURIComponent(state.activeHotelId)}` : '/api/hotels';
    const payload = await api(endpoint, { method:editing ? 'PUT' : 'POST', body:JSON.stringify(propertyPayload(form)) });
    applyServerState(payload.state);
    closeModal(byId('propertyModal'));
    renderAll();
    notify(editing ? 'Smještaj je spremljen.' : 'Novi smještaj je dodan. Sada mu dodajte paket.');
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function deleteProperty(){
  const button = byId('deletePropertyButton');
  if(!state.activeHotelId) return;
  if(!state.deleteHotelArmed){
    state.deleteHotelArmed = true;
    button.textContent = 'Ponovno kliknite za brisanje';
    window.setTimeout(() => {
      state.deleteHotelArmed = false;
      if(!button.hidden) button.innerHTML = '<i data-lucide="trash-2"></i> Obriši';
      refreshIcons();
    }, 3500);
    return;
  }
  setBusy(button, true, 'Brišem...');
  try{
    const payload = await api(`/api/hotels/${encodeURIComponent(state.activeHotelId)}`, { method:'DELETE' });
    applyServerState(payload);
    closeModal(byId('propertyModal'));
    renderAll();
    notify('Smještaj je obrisan.');
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

function resetPackageForm(){
  state.activePackageId = '';
  state.deletePackageArmed = false;
  const form = byId('packageForm');
  form.reset();
  form.hotelId.innerHTML = state.hotels.map(hotel => `<option value="${escapeAttribute(hotel.id)}">${escapeHtml(hotel.name)}</option>`).join('');
  form.name.value = 'Vikend paket';
  form.roomType.value = 'Standardna dvokrevetna soba';
  form.mealPlan.value = 'Doručak uključen';
  form.dates.value = defaultDates.join(', ');
  form.coldPrice.value = '50';
  form.duration.value = '60';
  form.units.value = '4';
  form.maxGuests.value = '2';
  form.status.value = 'active';
  form.description.value = 'Slobodan termin spreman za transparentnu aukciju.';
  byId('packageModalTitle').textContent = 'Dodaj aukcijski paket';
  byId('deletePackageButton').hidden = true;
}

function populatePackageForm(auctionPackage){
  state.activePackageId = auctionPackage.id;
  state.deletePackageArmed = false;
  const form = byId('packageForm');
  form.hotelId.innerHTML = state.hotels.map(hotel => `<option value="${escapeAttribute(hotel.id)}">${escapeHtml(hotel.name)}</option>`).join('');
  ['hotelId', 'name', 'roomType', 'mealPlan', 'coldPrice', 'duration', 'units', 'maxGuests', 'status', 'description'].forEach(key => {
    form[key].value = auctionPackage[key] ?? '';
  });
  form.hotelId.disabled = true;
  form.dates.value = (auctionPackage.dates || []).join(', ');
  byId('packageModalTitle').textContent = `Uredi: ${auctionPackage.name}`;
  byId('deletePackageButton').hidden = !canDeleteInventory();
  byId('deletePackageButton').innerHTML = '<i data-lucide="trash-2"></i> Obriši';
}

function packagePayload(form){
  return {
    hotelId:form.hotelId.value, name:form.name.value, roomType:form.roomType.value, mealPlan:form.mealPlan.value,
    dates:asList(form.dates.value), coldPrice:Number(form.coldPrice.value), duration:Number(form.duration.value),
    units:Number(form.units.value), maxGuests:Number(form.maxGuests.value), status:form.status.value, description:form.description.value
  };
}

async function savePackage(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId('savePackageButton');
  const editing = Boolean(state.activePackageId);
  setBusy(button, true, 'Spremam paket...');
  try{
    const endpoint = editing ? `/api/packages/${encodeURIComponent(state.activePackageId)}` : '/api/packages';
    const payload = await api(endpoint, { method:editing ? 'PUT' : 'POST', body:JSON.stringify(packagePayload(form)) });
    applyServerState(payload.state);
    closeModal(byId('packageModal'));
    renderAll();
    notify(editing ? 'Paket je spremljen.' : 'Novi paket je aktiviran.');
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function deletePackage(){
  const button = byId('deletePackageButton');
  if(!state.activePackageId) return;
  if(!state.deletePackageArmed){
    state.deletePackageArmed = true;
    button.textContent = 'Ponovno kliknite za brisanje';
    window.setTimeout(() => {
      state.deletePackageArmed = false;
      if(!button.hidden) button.innerHTML = '<i data-lucide="trash-2"></i> Obriši';
      refreshIcons();
    }, 3500);
    return;
  }
  setBusy(button, true, 'Brišem...');
  try{
    const payload = await api(`/api/packages/${encodeURIComponent(state.activePackageId)}`, { method:'DELETE' });
    applyServerState(payload);
    closeModal(byId('packageModal'));
    renderAll();
    notify('Paket je obrisan.');
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function inviteTeamMember(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId('addAdminButton');
  setBusy(button, true, 'Šaljem poziv...');
  try{
    const payload = await api('/api/team/invitations', {
      method:'POST',
      body:JSON.stringify({ name:form.name.value, email:form.email.value, role:form.role.value, phone:form.phone.value })
    });
    applyServerState(payload.state);
    form.reset();
    renderAll();
    const token = payload.invitation?.demoInvitationToken;
    if(token && navigator.clipboard){
      const invitationUrl = new URL(`index.html?invite=${encodeURIComponent(token)}`, window.location.href);
      await navigator.clipboard.writeText(invitationUrl.href).catch(() => {});
    }
    notify(token ? 'Pozivnica je izrađena, a demo poveznica kopirana.' : 'Pozivnica za člana tima je izrađena.');
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function revokeInvitation(invitationId){
  try{
    const payload = await api(`/api/team/invitations/${encodeURIComponent(invitationId)}`, { method:'DELETE' });
    applyServerState(payload);
    renderAll();
    notify('Pozivnica je povučena.');
  }catch(error){ notify(error.message, 'error'); }
}

async function resetDemo(){
  const button = byId('resetPartnerDemo');
  if(!state.resetArmed){
    state.resetArmed = true;
    button.textContent = 'Ponovno kliknite za reset';
    window.setTimeout(() => {
      state.resetArmed = false;
      button.innerHTML = '<i data-lucide="rotate-ccw"></i><span>Resetiraj demo</span>';
      refreshIcons();
    }, 3500);
    return;
  }
  setBusy(button, true, 'Resetiram...');
  try{
    const payload = await api('/api/reset', { method:'POST', body:'{}' });
    applyServerState(payload);
    await refreshAuthSession();
    renderAll();
    notify('Demo baza vraćena je na početni scenarij.');
  }catch(error){ notify(error.message, 'error'); }
  finally{
    state.resetArmed = false;
    setBusy(button, false);
  }
}

function showAccessGate(){
  byId('partnerAccessGate').hidden = false;
  byId('partnerApp').hidden = true;
  byId('partnerBackendStatus').innerHTML = '<span class="status-dot"></span> Pristup zaštićen';
  const user = getAuthSession().user;
  byId('partnerGateTitle').textContent = user ? 'Ovaj račun nema partnerski pristup' : 'Prijavite se u Partner centar';
  byId('partnerGateText').textContent = user ? 'Odjavite gostujući račun i prijavite se kao partner ili administrator.' : 'Partnerski račun povezuje tim s vlastitim smještajima, paketima i rezervacijama.';
}

async function loadPartnerState(){
  const user = getAuthSession().user;
  if(!user || !['partner', 'admin'].includes(user.role)){
    showAccessGate();
    return;
  }
  byId('partnerAccessGate').hidden = true;
  byId('partnerApp').hidden = false;
  try{
    const payload = await api('/api/partner/state');
    applyServerState(payload);
    renderAll();
    byId('partnerBackendStatus').innerHTML = `<span class="status-dot live"></span> ${payload.transport === 'browser-demo' ? 'Prezentacijska baza aktivna' : 'Sigurna sesija aktivna'}`;
  }catch(error){
    byId('partnerBackendStatus').innerHTML = '<span class="status-dot error"></span> Pristup nije dostupan';
    notify(error.message, 'error');
    showAccessGate();
  }
}

function bindEvents(){
  document.querySelectorAll('[data-partner-panel]').forEach(button => {
    button.addEventListener('click', () => setPanel(button.dataset.partnerPanel));
  });
  byId('addPropertyButton').addEventListener('click', () => {
    resetPropertyForm();
    openModal(byId('propertyModal'));
    refreshIcons();
  });
  byId('addPackageButton').addEventListener('click', () => {
    if(!state.hotels.length){
      notify('Prvo dodajte smještaj kojem paket pripada.', 'error');
      return;
    }
    resetPackageForm();
    byId('packageForm').hotelId.disabled = false;
    openModal(byId('packageModal'));
    refreshIcons();
  });
  byId('propertyForm').addEventListener('submit', saveProperty);
  byId('propertyForm').images.addEventListener('input', updateGalleryImageCount);
  byId('packageForm').addEventListener('submit', savePackage);
  byId('bookingsTableBody').addEventListener('change', event => {
    const row = event.target.closest('[data-reservation-row]');
    if(row && event.target.matches('[data-reservation-status], [data-payment-status]')) updateReservation(row);
  });
  byId('deletePropertyButton').addEventListener('click', deleteProperty);
  byId('deletePackageButton').addEventListener('click', deletePackage);
  byId('adminForm').addEventListener('submit', inviteTeamMember);
  byId('resetPartnerDemo').addEventListener('click', resetDemo);
  byId('partnerGateLogin').addEventListener('click', () => openAuthDialog('login'));
  byId('partnerGateRegister').addEventListener('click', () => openAuthDialog('register'));
  document.addEventListener('click', event => {
    const editHotel = event.target.closest('[data-edit-hotel]');
    if(editHotel){
      if(!canEditInventory()){ notify('Vaša uloga ima samo pravo pregleda.', 'error'); return; }
      const hotel = hotelById(editHotel.dataset.editHotel);
      if(hotel){ populatePropertyForm(hotel); openModal(byId('propertyModal')); refreshIcons(); }
    }
    const editPackage = event.target.closest('[data-edit-package]');
    if(editPackage){
      if(!canEditInventory()){ notify('Vaša uloga ima samo pravo pregleda.', 'error'); return; }
      const auctionPackage = state.packages.find(item => item.id === editPackage.dataset.editPackage);
      if(auctionPackage){ populatePackageForm(auctionPackage); openModal(byId('packageModal')); refreshIcons(); }
    }
    const publicAuction = event.target.closest('[data-open-public-auction]');
    if(publicAuction) window.location.href = `/demo.html?package=${encodeURIComponent(publicAuction.dataset.openPublicAuction)}`;
    const revoke = event.target.closest('[data-revoke-invitation]');
    if(revoke) revokeInvitation(revoke.dataset.revokeInvitation);
  });
  window.addEventListener('auction:auth-changed', loadPartnerState);
}

async function init(){
  bindEvents();
  setPanel(window.location.hash.slice(1) || 'overview');
  await initAuthUI();
  await loadPartnerState();
}

init();
