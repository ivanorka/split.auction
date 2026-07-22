import {
  api,
  byId,
  escapeAttribute,
  escapeHtml,
  formatMoney,
  formatShortDate,
  notify,
  refreshIcons,
  setBusy
} from './shared.js';
import {
  getAuthSession,
  initAuthUI,
  openAuthDialog,
  refreshAuthSession
} from './auth.js';

function showGate(){
  byId('accountGate').hidden = false;
  byId('accountContent').hidden = true;
}

function roleLabel(user){
  if(user.role === 'superadmin') return 'Superadmin platforme';
  if(user.role === 'admin') return 'Administrator platforme';
  if(user.role === 'partner') return 'Partnerski račun';
  return 'Gostujući račun';
}

function reservationStatusLabel(status){
  return ({ confirmed:'Potvrđeno', checked_in:'Gost prijavljen', completed:'Završeno', cancelled:'Otkazano' })[status] || 'Potvrđeno';
}

function paymentStatusLabel(status){
  return ({
    awaiting_payment:'Čeka plaćanje',
    checkout_open:'Plaćanje otvoreno',
    paid:'Plaćeno',
    refunded:'Povrat izvršen',
    demo_authorized:'Demo autorizacija'
  })[status] || 'Čeka plaćanje';
}

function paymentAction(reservation){
  if(['cancelled', 'completed'].includes(reservation.status)) return '';
  if(reservation.paymentStatus === 'paid') return '<span class="status-badge active">Plaćeno</span>';
  return `<button class="button primary small" type="button" data-pay-reservation="${escapeAttribute(reservation.id)}"><i data-lucide="credit-card"></i> Plati ${formatMoney(reservation.amount)}</button>`;
}

function render(payload){
  const { user, bids, reservations, watchedPackages } = payload;
  byId('accountGate').hidden = true;
  byId('accountContent').hidden = false;
  byId('accountRole').textContent = roleLabel(user);
  byId('accountName').textContent = user.name;
  byId('accountEmail').textContent = user.email;
  byId('accountPartnerLink').hidden = !['partner', 'admin'].includes(user.role);
  byId('accountBidCount').textContent = String(bids.length);
  byId('accountWatchCount').textContent = String(watchedPackages.length);
  byId('accountReservationCount').textContent = String(reservations.length);

  const profile = byId('profileForm');
  profile.name.value = user.name;
  profile.email.value = user.email;
  profile.phone.value = user.phone || '';

  byId('accountBidsBody').innerHTML = bids.length
    ? bids.map(bid => `<tr><td><strong>${escapeHtml(bid.hotelName)}</strong><small class="table-note">${escapeHtml(bid.packageName)}</small></td><td>${(bid.dates || []).map(formatShortDate).join(', ')}</td><td><strong>${formatMoney(bid.amount)}</strong></td><td><span class="status-badge ${bid.leading ? 'active' : ''}">${bid.leading ? 'Vodeća' : 'Nadmašena'}</span></td></tr>`).join('')
    : '<tr><td colspan="4"><div class="empty-inline">Još nemate poslanih ponuda.</div></td></tr>';

  byId('accountReservationsBody').innerHTML = reservations.length
    ? reservations.map(item => `<tr><td><strong>${escapeHtml(item.bookingCode)}</strong></td><td>${escapeHtml(item.hotel)}<small class="table-note">${escapeHtml(item.packageName || '')}</small></td><td>${escapeHtml(item.dates)}</td><td><strong>${formatMoney(item.amount)}</strong></td><td><span class="status-badge ${item.status !== 'cancelled' ? 'active' : ''}">${reservationStatusLabel(item.status)}</span><small class="table-note payment-status">${paymentStatusLabel(item.paymentStatus)}</small></td><td class="table-actions">${paymentAction(item)}${item.status !== 'cancelled' && item.status !== 'completed' ? `<button class="button tertiary small" type="button" data-cancel-reservation="${escapeAttribute(item.id)}">Otkaži</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="6"><div class="empty-inline">Još nemate potvrđenih rezervacija.</div></td></tr>';

  byId('accountWatched').innerHTML = watchedPackages.length
    ? watchedPackages.map(item => `<a href="/demo.html?package=${escapeAttribute(item.package.id)}"><img src="${escapeAttribute(item.hotel.images?.[0] || '/assets/favicon.svg')}" alt=""><span><strong>${escapeHtml(item.hotel.name)}</strong><small>${escapeHtml(item.package.name)} · od ${formatMoney(item.package.coldPrice)}</small></span><i data-lucide="arrow-right"></i></a>`).join('')
    : '<p class="empty-inline">Aukcije koje pratite pojavit će se ovdje.</p>';
  refreshIcons();
}

async function loadAccount(){
  const auth = getAuthSession();
  if(!auth.user){
    showGate();
    return;
  }
  try{
    render(await api('/api/account/activity'));
  }catch(error){
    notify(error.message, 'error');
    showGate();
  }
}

async function saveProfile(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId('profileButton');
  setBusy(button, true, 'Spremam...');
  try{
    const payload = await api('/api/account/profile', { method:'PATCH', body:JSON.stringify({ name:form.name.value, phone:form.phone.value }) });
    notify('Profil je spremljen.');
    await refreshAuthSession();
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function changePassword(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId('passwordButton');
  setBusy(button, true, 'Mijenjam...');
  try{
    const payload = await api('/api/account/password', { method:'POST', body:JSON.stringify({ currentPassword:form.currentPassword.value, newPassword:form.newPassword.value }) });
    form.reset();
    notify(payload.message);
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function cancelReservation(button){
  setBusy(button, true, 'Otkazujem...');
  try{
    const payload = await api(`/api/reservations/${encodeURIComponent(button.dataset.cancelReservation)}`, {
      method:'PATCH',
      body:JSON.stringify({ status:'cancelled' })
    });
    render(payload);
    notify('Rezervacija je otkazana, a jedinica vraćena u paket.');
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function startPayment(button){
  setBusy(button, true, 'Otvaram sigurno plaćanje...');
  try{
    const payload = await api('/api/payments/checkout', {
      method:'POST',
      body:JSON.stringify({ reservationId:button.dataset.payReservation })
    });
    window.location.assign(payload.checkoutUrl);
  }catch(error){
    const message = error.code === 'STRIPE_NOT_CONFIGURED'
      ? 'Stripe sandbox je spreman u aplikaciji. Dodajte testni Stripe ključ za otvaranje naplate.'
      : error.message;
    notify(message, 'error');
    setBusy(button, false);
  }
}

async function init(){
  byId('accountGateLogin').addEventListener('click', () => openAuthDialog('login'));
  byId('profileForm').addEventListener('submit', saveProfile);
  byId('passwordForm').addEventListener('submit', changePassword);
  byId('accountReservationsBody').addEventListener('click', event => {
    const button = event.target.closest('[data-cancel-reservation]');
    if(button) cancelReservation(button);
    const paymentButton = event.target.closest('[data-pay-reservation]');
    if(paymentButton) startPayment(paymentButton);
  });
  window.addEventListener('auction:auth-changed', loadAccount);
  await initAuthUI();
  await loadAccount();
}

init();
