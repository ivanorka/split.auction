import {
  api,
  closeModal,
  escapeAttribute,
  escapeHtml,
  notify,
  openModal,
  refreshIcons,
  setBusy,
  setCsrfToken
} from './shared.js';

let session = { authenticated:false, user:null, partner:null, csrfToken:'' };
let readyPromise;
let resolveReady;
let selectedEntryRole = 'guest';

export const authReady = new Promise(resolve => {
  resolveReady = resolve;
});

export function getAuthSession(){
  return session;
}

export async function refreshAuthSession(){
  const payload = await api('/api/auth/session');
  applySession(payload);
  return session;
}

function initials(name){
  return String(name || 'AS').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
}

function roleLabel(user){
  if(user?.role === 'admin') return 'Administrator platforme';
  if(user?.role === 'partner') return user.partnerRole === 'owner' ? 'Vlasnik smještaja' : 'Partnerski tim';
  return 'Gost';
}

function authMarkup(){
  return `
    <div class="modal-backdrop" id="authModal" hidden>
      <section class="modal-dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <button class="modal-close icon-button" type="button" data-close-modal title="Zatvori"><i data-lucide="x"></i><span class="sr-only">Zatvori</span></button>
        <div class="auth-brand"><img src="/assets/favicon.svg" alt=""><span><strong>Auction Split</strong><small>Siguran pristup računu</small></span></div>

        <div class="auth-view" data-auth-panel="login">
          <span class="eyebrow">Dobro došli</span>
          <h2 id="authTitle">Prijavite se</h2>
          <p>Pratite ponude kao gost ili upravljajte inventarom kao partner.</p>
          <div class="auth-guide-links" aria-label="Odaberite ulogu za prijavu">
            <button type="button" data-auth-entry-role="guest" aria-pressed="true"><i data-lucide="user-round"></i><span>Za goste</span></button>
            <button type="button" data-auth-entry-role="partner" aria-pressed="false"><i data-lucide="building-2"></i><span>Za partnere</span></button>
          </div>
          <form class="form-grid auth-form" id="loginForm">
            <label class="full-field"><span>E-mail</span><input name="email" type="email" autocomplete="email" required data-autofocus></label>
            <label class="full-field"><span>Lozinka</span><input name="password" type="password" autocomplete="current-password" required></label>
            <button class="text-button auth-forgot" type="button" data-auth-view="forgot">Zaboravljena lozinka?</button>
            <button class="button primary full-field" id="loginButton" type="submit"><i data-lucide="log-in"></i> Prijava</button>
          </form>
          <div class="demo-account-block">
            <span>Brzi demo pristup</span>
            <div class="demo-account-grid">
              <button type="button" data-demo-login="guest"><i data-lucide="user"></i><span>Gost<small>licitiranje</small></span></button>
              <button type="button" data-demo-login="partner"><i data-lucide="building-2"></i><span>Partner<small>paketi</small></span></button>
              <button type="button" data-demo-login="admin"><i data-lucide="shield-check"></i><span>Admin<small>platforma</small></span></button>
            </div>
          </div>
          <p class="auth-switch">Nemate račun? <button type="button" data-auth-view="register">Otvorite račun</button></p>
        </div>

        <div class="auth-view" data-auth-panel="register" hidden>
          <span class="eyebrow">Novi račun</span>
          <h2>Registracija</h2>
          <p>Odaberite račun prema načinu na koji želite koristiti platformu.</p>
          <form class="form-grid auth-form" id="registerForm">
            <input name="invitationToken" type="hidden">
            <fieldset class="full-field account-type-field">
              <legend>Vrsta računa</legend>
              <div class="segmented-control">
                <label><input type="radio" name="accountType" value="guest" checked><span><i data-lucide="user"></i> Gost</span></label>
                <label><input type="radio" name="accountType" value="partner"><span><i data-lucide="building-2"></i> Partner</span></label>
              </div>
            </fieldset>
            <label><span>Ime i prezime</span><input name="name" autocomplete="name" required></label>
            <label><span>E-mail</span><input name="email" type="email" autocomplete="email" required></label>
            <label class="full-field"><span>Lozinka</span><input name="password" type="password" minlength="8" autocomplete="new-password" required><small>Najmanje 8 znakova, slovo i broj.</small></label>
            <div class="partner-registration-fields full-field" id="partnerRegistrationFields" hidden>
              <label><span>Naziv hotela ili obrta</span><input name="businessName"></label>
              <label><span>Vrsta partnera</span><select name="partnerType"><option value="hotel">Hotel · 70/30</option><option value="small">Apartman · 60/40</option></select></label>
              <label><span>Grad</span><input name="city" value="Split"></label>
              <label><span>OIB (opcionalno u demu)</span><input name="taxId" inputmode="numeric"></label>
            </div>
            <label class="checkbox-field full-field"><input name="terms" type="checkbox" required><span>Prihvaćam uvjete korištenja demo platforme.</span></label>
            <button class="button primary full-field" id="registerButton" type="submit"><i data-lucide="user-plus"></i> Otvori račun</button>
          </form>
          <p class="auth-switch">Već imate račun? <button type="button" data-auth-view="login">Prijavite se</button></p>
        </div>

        <div class="auth-view" data-auth-panel="forgot" hidden>
          <span class="eyebrow">Oporavak računa</span>
          <h2>Promijenite lozinku</h2>
          <p>Unesite e-mail. Demo server će sigurno izraditi jednokratni token.</p>
          <form class="form-grid auth-form" id="forgotForm">
            <label class="full-field"><span>E-mail</span><input name="email" type="email" autocomplete="email" required></label>
            <button class="button primary full-field" id="forgotButton" type="submit">Pošalji upute</button>
          </form>
          <p class="auth-switch"><button type="button" data-auth-view="login"><i data-lucide="arrow-left"></i> Povratak na prijavu</button></p>
        </div>

        <div class="auth-view" data-auth-panel="reset" hidden>
          <span class="eyebrow">Nova lozinka</span>
          <h2>Postavite novu lozinku</h2>
          <form class="form-grid auth-form" id="resetForm">
            <input name="token" type="hidden">
            <label class="full-field"><span>Nova lozinka</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
            <button class="button primary full-field" id="resetButton" type="submit">Spremi novu lozinku</button>
          </form>
        </div>

        <div class="auth-view" data-auth-panel="account" hidden>
          <div class="account-modal-heading">
            <span class="account-avatar" id="authAccountAvatar">AS</span>
            <div><span class="eyebrow" id="authAccountRole">Korisnički račun</span><h2 id="authAccountName">Auction Split</h2><p id="authAccountEmail"></p></div>
          </div>
          <div class="account-action-list">
            <a href="/account.html"><i data-lucide="circle-user-round"></i><span><strong>Moj račun</strong><small>Ponude, praćenje i rezervacije</small></span><i data-lucide="chevron-right"></i></a>
            <a href="/partner.html" id="authPartnerLink" hidden><i data-lucide="layout-dashboard"></i><span><strong>Partner centar</strong><small>Smještaji, paketi i tim</small></span><i data-lucide="chevron-right"></i></a>
          </div>
          <button class="button secondary wide" id="logoutButton" type="button"><i data-lucide="log-out"></i> Odjava</button>
        </div>
      </section>
    </div>`;
}

function ensureAuthUi(){
  if(!document.getElementById('authModal')) document.body.insertAdjacentHTML('beforeend', authMarkup());
  const navigation = document.querySelector('[data-site-navigation]');
  if(navigation && !navigation.querySelector('[data-auth-trigger]')){
    navigation.insertAdjacentHTML('beforeend', '<button class="nav-auth-trigger" type="button" data-auth-trigger><i data-lucide="user-round"></i><span>Prijava</span></button>');
  }
}

function setRegistrationAccountType(accountType){
  if(!accountType) return;
  const input = document.querySelector(`#registerForm [name="accountType"][value="${escapeAttribute(accountType)}"]`);
  if(!input) return;
  input.checked = true;
  const partner = accountType === 'partner';
  document.getElementById('partnerRegistrationFields').hidden = !partner;
  document.getElementById('registerForm').businessName.required = partner && !document.getElementById('registerForm').invitationToken.value;
}

function setEntryRole(role){
  selectedEntryRole = role === 'partner' ? 'partner' : 'guest';
  document.querySelectorAll('[data-auth-entry-role]').forEach(button => {
    const active = button.dataset.authEntryRole === selectedEntryRole;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function showView(view, accountType = ''){
  document.querySelectorAll('[data-auth-panel]').forEach(panel => {
    panel.hidden = panel.dataset.authPanel !== view;
  });
  if(view === 'register') setRegistrationAccountType(accountType || selectedEntryRole);
  const focusTarget = document.querySelector(`[data-auth-panel="${escapeAttribute(view)}"] input:not([type="hidden"]), [data-auth-panel="${escapeAttribute(view)}"] button`);
  window.setTimeout(() => focusTarget?.focus(), 0);
}

export function openAuthDialog(view = 'login', accountType = ''){
  ensureAuthUi();
  if(view === 'account' && !session.user) view = 'login';
  showView(view, accountType);
  openModal(document.getElementById('authModal'));
  refreshIcons();
}

function applySession(payload, announce = true){
  session = {
    authenticated:Boolean(payload?.authenticated),
    user:payload?.user || null,
    partner:payload?.partner || null,
    csrfToken:payload?.csrfToken || ''
  };
  setCsrfToken(session.csrfToken);
  renderSession();
  if(announce){
    window.dispatchEvent(new CustomEvent('auction:auth-changed', { detail:session }));
  }
}

function renderSession(){
  document.querySelectorAll('[data-auth-trigger]').forEach(button => {
    if(session.user){
      button.innerHTML = `<span class="nav-user-avatar">${escapeHtml(initials(session.user.name))}</span><span>${escapeHtml(session.user.name.split(' ')[0])}</span>`;
      button.setAttribute('aria-label', `Otvori račun: ${session.user.name}`);
    }else{
      button.innerHTML = '<i data-lucide="user-round"></i><span>Prijava</span>';
      button.setAttribute('aria-label', 'Prijava ili registracija');
    }
  });
  if(session.user){
    document.getElementById('authAccountAvatar').textContent = initials(session.user.name);
    document.getElementById('authAccountRole').textContent = roleLabel(session.user);
    document.getElementById('authAccountName').textContent = session.user.name;
    document.getElementById('authAccountEmail').textContent = session.user.email;
    document.getElementById('authPartnerLink').hidden = !['partner', 'admin'].includes(session.user.role);
  }
  refreshIcons();
}

async function submitLogin(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('loginButton');
  setBusy(button, true, 'Prijavljujem...');
  try{
    const payload = await api('/api/auth/login', {
      method:'POST',
      body:JSON.stringify({ email:form.email.value, password:form.password.value })
    });
    applySession(payload);
    closeModal(document.getElementById('authModal'));
    notify(`Dobro došli, ${payload.user.name}.`);
  }catch(error){
    notify(error.message, 'error');
  }finally{
    setBusy(button, false);
  }
}

async function submitRegistration(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('registerButton');
  const values = new FormData(form);
  setBusy(button, true, 'Otvaram račun...');
  try{
    const payload = await api('/api/auth/register', {
      method:'POST',
      body:JSON.stringify(Object.fromEntries(values.entries()))
    });
    applySession(payload);
    closeModal(document.getElementById('authModal'));
    notify(payload.user.role === 'partner' ? 'Partnerski račun je otvoren.' : 'Korisnički račun je otvoren.');
  }catch(error){
    notify(error.message, 'error');
  }finally{
    setBusy(button, false);
  }
}

async function submitForgot(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('forgotButton');
  setBusy(button, true, 'Šaljem...');
  try{
    const payload = await api('/api/auth/forgot-password', {
      method:'POST',
      body:JSON.stringify({ email:form.email.value })
    });
    notify(payload.message);
    if(payload.demoResetToken){
      document.getElementById('resetForm').token.value = payload.demoResetToken;
      showView('reset');
    }else{
      showView('login');
    }
  }catch(error){
    notify(error.message, 'error');
  }finally{
    setBusy(button, false);
  }
}

async function submitReset(event){
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('resetButton');
  setBusy(button, true, 'Spremam...');
  try{
    const payload = await api('/api/auth/reset-password', {
      method:'POST',
      body:JSON.stringify({ token:form.token.value, password:form.password.value })
    });
    notify(payload.message);
    showView('login');
  }catch(error){
    notify(error.message, 'error');
  }finally{
    setBusy(button, false);
  }
}

async function logout(){
  const button = document.getElementById('logoutButton');
  setBusy(button, true, 'Odjavljujem...');
  try{
    const payload = await api('/api/auth/logout', { method:'POST', body:'{}' });
    applySession(payload);
    closeModal(document.getElementById('authModal'));
    notify('Uspješno ste odjavljeni.');
  }catch(error){
    notify(error.message, 'error');
  }finally{
    setBusy(button, false);
  }
}

function bindAuthEvents(){
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-auth-trigger]');
    if(trigger){
      openAuthDialog(session.user ? 'account' : 'login');
      return;
    }
    const openAuth = event.target.closest('[data-auth-open]');
    if(openAuth){
      openAuthDialog(openAuth.dataset.authOpen || 'login', openAuth.dataset.authAccount || '');
      return;
    }
    const view = event.target.closest('[data-auth-view]');
    if(view){
      showView(view.dataset.authView, view.dataset.authAccount || (view.dataset.authView === 'register' ? selectedEntryRole : ''));
      return;
    }
    const entryRole = event.target.closest('[data-auth-entry-role]');
    if(entryRole){
      setEntryRole(entryRole.dataset.authEntryRole);
      return;
    }
    const demoLogin = event.target.closest('[data-demo-login]');
    if(demoLogin){
      const accounts = {
        guest:['gost@auction.split', 'Demo123!'],
        partner:['partner@auction.split', 'Partner123!'],
        admin:['admin@auction.split', 'Admin123!']
      };
      const [email, password] = accounts[demoLogin.dataset.demoLogin];
      const form = document.getElementById('loginForm');
      form.email.value = email;
      form.password.value = password;
      form.requestSubmit();
    }
  });

  document.getElementById('loginForm').addEventListener('submit', submitLogin);
  document.getElementById('registerForm').addEventListener('submit', submitRegistration);
  document.getElementById('forgotForm').addEventListener('submit', submitForgot);
  document.getElementById('resetForm').addEventListener('submit', submitReset);
  document.getElementById('logoutButton').addEventListener('click', logout);
  document.querySelectorAll('#registerForm [name="accountType"]').forEach(input => {
    input.addEventListener('change', () => {
      const partner = input.value === 'partner' && input.checked;
      document.getElementById('partnerRegistrationFields').hidden = !partner;
      document.getElementById('registerForm').businessName.required = partner && !document.getElementById('registerForm').invitationToken.value;
    });
  });
}

export function requireAuthenticatedUser(role = ''){
  if(!session.user){
    openAuthDialog(role === 'partner' ? 'register' : 'login');
    notify(role === 'partner' ? 'Prijavite se partnerskim računom.' : 'Prijavite se za nastavak.', 'error');
    return false;
  }
  if(role === 'guest' && session.user.role !== 'guest'){
    notify('Za licitiranje koristite gostujući račun.', 'error');
    return false;
  }
  if(role === 'partner' && !['partner', 'admin'].includes(session.user.role)){
    notify('Partner centar zahtijeva partnerski račun.', 'error');
    return false;
  }
  return true;
}

export async function initAuthUI(){
  if(readyPromise) return readyPromise;
  readyPromise = (async () => {
    ensureAuthUi();
    setEntryRole(selectedEntryRole);
    bindAuthEvents();
    const invitationToken = new URLSearchParams(window.location.search).get('invite') || '';
    if(invitationToken){
      const form = document.getElementById('registerForm');
      form.invitationToken.value = invitationToken;
      form.accountType.value = 'partner';
      form.businessName.required = false;
      document.getElementById('partnerRegistrationFields').hidden = true;
      showView('register');
      openModal(document.getElementById('authModal'));
    }
    refreshIcons();
    try{
      const payload = await api('/api/auth/session');
      applySession(payload, false);
    }catch{
      applySession({ authenticated:false, user:null, csrfToken:'' }, false);
    }
    resolveReady(session);
    return session;
  })();
  return readyPromise;
}
