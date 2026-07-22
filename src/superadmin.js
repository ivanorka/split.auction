import {
  api,
  byId,
  escapeAttribute,
  escapeHtml,
  notify,
  refreshIcons,
  setBusy
} from './shared.js';
import { getAuthSession, initAuthUI, openSuperAdminLogin } from './auth.js';

let state = { users:[], partners:[], currentUser:null, metrics:{} };
let selectedUserId = '';
let activeFilter = 'all';

function roleLabel(role){
  return ({ superadmin:'Superadmin', admin:'Administrator', partner:'Partner', guest:'Gost' })[role] || 'Gost';
}

function partnerName(user){
  return state.partners.find(partner => partner.id === user.partnerId)?.businessName || '—';
}

function renderUsers(){
  const search = byId('superAdminSearch').value.trim().toLowerCase();
  const status = byId('superAdminStatusFilter').value;
  const users = state.users.filter(user => {
    const matchesSearch = !search || `${user.name} ${user.email}`.toLowerCase().includes(search);
    const normalizedStatus = user.status === 'suspended' ? 'deactivated' : user.status;
    const matchesStatus = status === 'all' || normalizedStatus === status;
    const matchesMetric = activeFilter === 'all'
      || activeFilter === 'active' && user.status === 'active'
      || activeFilter === 'guest' && user.role === 'guest'
      || activeFilter === 'partner' && user.role === 'partner';
    return matchesSearch && matchesStatus && matchesMetric;
  });
  const labels = { all:'Svi računi', active:'Aktivni računi', guest:'Gostujući računi', partner:'Partnerski računi' };
  byId('superAdminListTitle').textContent = labels[activeFilter] || 'Svi računi';
  byId('superAdminUsers').innerHTML = users.length
    ? users.map(user => `<tr class="superadmin-user-row" data-edit-user="${escapeAttribute(user.id)}" tabindex="0" role="button"><td><strong>${escapeHtml(user.name)}</strong><small class="table-note">${escapeHtml(user.email)}</small></td><td><span class="partner-type">${roleLabel(user.role)}</span></td><td>${escapeHtml(partnerName(user))}</td><td><span class="status-badge ${user.status === 'active' ? 'active' : ''}">${user.status === 'active' ? 'Aktivan' : 'Deaktiviran'}</span></td><td><button class="icon-button table-edit-button" type="button" data-edit-user="${escapeAttribute(user.id)}" title="Uredi korisnika"><i data-lucide="pencil"></i><span class="sr-only">Uredi korisnika</span></button></td></tr>`).join('')
    : '<tr><td colspan="5"><div class="empty-inline">Nema korisnika za prikaz.</div></td></tr>';
  refreshIcons();
}

function setPartnerFields(){
  const form = byId('superAdminUserForm');
  const isPartner = form.role.value === 'partner';
  byId('superAdminPartnerFields').hidden = !isPartner;
  form.partnerId.required = isPartner;
  form.partnerRole.required = isPartner;
}

function openEditor(userId){
  const user = state.users.find(item => item.id === userId);
  if(!user) return;
  selectedUserId = user.id;
  const form = byId('superAdminUserForm');
  byId('superAdminEditorEmpty').hidden = true;
  form.hidden = false;
  const passwordField = byId('superAdminPasswordField');
  passwordField.hidden = false;
  form.password.value = '';
  form.password.required = false;
  byId('superAdminPasswordLabel').textContent = 'Nova lozinka (opcionalno)';
  byId('superAdminPasswordHint').textContent = 'Ostavite prazno ako ne želite mijenjati lozinku.';
  byId('superAdminTemporaryPassword').hidden = true;
  byId('superAdminEditorTitle').textContent = user.name;
  form.id.value = user.id;
  form.name.value = user.name;
  form.email.value = user.email;
  form.phone.value = user.phone || '';
  form.role.value = user.role === 'superadmin' ? 'admin' : user.role;
  form.status.value = user.status;
  form.partnerId.innerHTML = `<option value="">Odaberite partnera</option>${state.partners.map(partner => `<option value="${escapeAttribute(partner.id)}" ${partner.id === user.partnerId ? 'selected' : ''}>${escapeHtml(partner.businessName)} · ${escapeHtml(partner.city)}</option>`).join('')}`;
  form.partnerRole.value = user.partnerRole || 'viewer';
  const protectedUser = user.role === 'superadmin';
  ['email', 'role', 'status'].forEach(field => { form[field].disabled = protectedUser; });
  byId('superAdminSave').disabled = protectedUser;
  byId('superAdminSave').title = protectedUser ? 'God-mode račun je zaštićen.' : '';
  byId('superAdminResetPassword').hidden = protectedUser;
  setPartnerFields();
  refreshIcons();
}

function openCreator(){
  selectedUserId = '';
  const form = byId('superAdminUserForm');
  form.reset();
  byId('superAdminEditorEmpty').hidden = true;
  form.hidden = false;
  byId('superAdminEditorTitle').textContent = 'Novi korisnik';
  byId('superAdminPasswordField').hidden = false;
  form.password.required = true;
  byId('superAdminPasswordLabel').textContent = 'Početna lozinka';
  byId('superAdminPasswordHint').textContent = 'Najmanje 8 znakova, slovo i broj.';
  byId('superAdminResetPassword').hidden = true;
  byId('superAdminTemporaryPassword').hidden = true;
  form.id.value = '';
  form.role.value = 'guest';
  form.status.value = 'active';
  form.email.disabled = false;
  form.role.disabled = false;
  form.status.disabled = false;
  byId('superAdminSave').disabled = false;
  byId('superAdminSave').title = '';
  form.partnerId.innerHTML = `<option value="">Odaberite partnera</option>${state.partners.map(partner => `<option value="${escapeAttribute(partner.id)}">${escapeHtml(partner.businessName)} · ${escapeHtml(partner.city)}</option>`).join('')}`;
  setPartnerFields();
  refreshIcons();
}

function setMetricFilter(filter){
  activeFilter = filter;
  document.querySelectorAll('[data-user-filter]').forEach(button => {
    const selected = button.dataset.userFilter === filter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  renderUsers();
}

function render(payload){
  state = payload;
  byId('superAdminIdentity').textContent = payload.currentUser.name;
  byId('superAdminTotalUsers').textContent = payload.metrics.totalUsers;
  byId('superAdminActiveUsers').textContent = payload.metrics.activeUsers;
  byId('superAdminGuests').textContent = payload.metrics.guests;
  byId('superAdminPartners').textContent = payload.metrics.partners;
  renderUsers();
  if(selectedUserId) openEditor(selectedUserId);
}

async function load(){
  const session = getAuthSession();
  if(session.user?.role !== 'superadmin'){
    byId('superAdminGate').hidden = false;
    byId('superAdminApp').hidden = true;
    return;
  }
  try{
    render(await api('/api/superadmin/state'));
    byId('superAdminGate').hidden = true;
    byId('superAdminApp').hidden = false;
  }catch(error){
    notify(error.message, 'error');
  }
}

async function saveUser(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = byId('superAdminSave');
  setBusy(button, true, 'Spremam...');
  try{
    const creating = !form.id.value;
    const payload = await api(creating ? '/api/superadmin/users' : `/api/superadmin/users/${encodeURIComponent(form.id.value)}`, {
      method:creating ? 'POST' : 'PATCH',
      body:JSON.stringify({
        name:form.name.value,
        email:form.email.value,
        phone:form.phone.value,
        role:form.role.value,
        status:form.status.value,
        partnerId:form.partnerId.value,
        partnerRole:form.partnerRole.value,
        password:form.password.value
      })
    });
    render(payload);
    if(creating){
      const created = payload.users.find(user => user.email.toLowerCase() === form.email.value.trim().toLowerCase());
      if(created) openEditor(created.id);
    }
    notify(creating ? 'Korisnik je kreiran.' : 'Korisnik je spremljen.');
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function resetPassword(){
  const form = byId('superAdminUserForm');
  if(!form.id.value) return;
  if(!window.confirm('Generirati novu privremenu lozinku za ovog korisnika?')) return;
  const button = byId('superAdminResetPassword');
  setBusy(button, true, 'Resetiram...');
  try{
    const payload = await api(`/api/superadmin/users/${encodeURIComponent(form.id.value)}/password-reset`, { method:'POST', body:'{}' });
    render(payload.state);
    const notice = byId('superAdminTemporaryPassword');
    notice.textContent = `Privremena lozinka: ${payload.temporaryPassword}`;
    notice.hidden = false;
    form.password.value = '';
    notify('Lozinka je resetirana. Privremena lozinka prikazana je u uređivaču.');
  }catch(error){ notify(error.message, 'error'); }
  finally{ setBusy(button, false); }
}

async function logout(){
  const button = byId('superAdminLogout');
  setBusy(button, true, 'Odjavljujem...');
  try{
    await api('/api/auth/logout', { method:'POST', body:'{}' });
    window.location.assign('/');
  }catch(error){
    notify(error.message, 'error');
    setBusy(button, false);
  }
}

async function init(){
  byId('superAdminGateLogin').addEventListener('click', openSuperAdminLogin);
  byId('superAdminLogout').addEventListener('click', logout);
  byId('superAdminSearch').addEventListener('input', renderUsers);
  byId('superAdminStatusFilter').addEventListener('change', renderUsers);
  byId('superAdminCreateUser').addEventListener('click', openCreator);
  document.querySelectorAll('[data-user-filter]').forEach(button => {
    button.addEventListener('click', () => setMetricFilter(button.dataset.userFilter));
  });
  byId('superAdminUsers').addEventListener('click', event => {
    const button = event.target.closest('[data-edit-user]');
    if(button) openEditor(button.dataset.editUser);
  });
  byId('superAdminUsers').addEventListener('keydown', event => {
    if(!['Enter', ' '].includes(event.key)) return;
    const row = event.target.closest('[data-edit-user]');
    if(row){
      event.preventDefault();
      openEditor(row.dataset.editUser);
    }
  });
  byId('superAdminUserForm').addEventListener('submit', saveUser);
  byId('superAdminResetPassword').addEventListener('click', resetPassword);
  byId('superAdminUserForm').role.addEventListener('change', setPartnerFields);
  window.addEventListener('auction:auth-changed', load);
  await initAuthUI();
  await load();
}

init();
