import {refreshIcons} from './shared.js';
import {initAuthUI} from './auth.js';
import {getLocale, setLocale} from './shared.js';
import {supportedLocales, croatianCities} from './locale.js';

function initLocale(){
  document.documentElement.lang = getLocale();
  document.querySelectorAll('[data-city-select]').forEach(select => {
    const selected = select.value || select.dataset.selectedCity || '';
    const allLabel = select.dataset.allCitiesLabel || 'Cijela Hrvatska';
    select.innerHTML = [
      `<option value="">${allLabel}</option>`,
      ...croatianCities.map(city => `<option value="${city}">${city}</option>`)
    ].join('');
    select.value = croatianCities.includes(selected) ? selected : '';
  });
  document.querySelectorAll('.site-header-inner').forEach(header => {
    if(header.querySelector('[data-locale-select]')) return;
    const label = document.createElement('label');
    label.className = 'locale-control desktop-action';
    label.innerHTML = `<i data-lucide="languages"></i><span class="sr-only">Jezik</span><select data-locale-select aria-label="Odaberite jezik">${supportedLocales.map(locale => `<option value="${locale.code}">${locale.short}</option>`).join('')}</select>`;
    const select = label.querySelector('select');
    select.value = getLocale();
    select.addEventListener('change', () => {
      setLocale(select.value);
      window.location.reload();
    });
    header.append(label);
  });
}

function initNavigation(){
  const toggle = document.querySelector('[data-menu-toggle]');
  const navigation = document.querySelector('[data-site-navigation]');
  if(!toggle || !navigation) return;

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    navigation.classList.toggle('open', !open);
    toggle.innerHTML = `<i data-lucide="${open ? 'menu' : 'x'}"></i><span class="sr-only">${open ? 'Otvori' : 'Zatvori'} izbornik</span>`;
    refreshIcons();
  });

  navigation.addEventListener('click', event => {
    if(!event.target.closest('a')) return;
    toggle.setAttribute('aria-expanded','false');
    navigation.classList.remove('open');
  });

  const guidesToggle = navigation.querySelector('[data-guides-toggle]');
  const guidesMenu = navigation.querySelector('[data-guides-menu]');
  if(guidesToggle && guidesMenu){
    const closeGuides = () => {
      guidesToggle.setAttribute('aria-expanded', 'false');
      guidesMenu.hidden = true;
    };
    guidesToggle.addEventListener('click', event => {
      event.stopPropagation();
      const open = guidesToggle.getAttribute('aria-expanded') === 'true';
      guidesToggle.setAttribute('aria-expanded', String(!open));
      guidesMenu.hidden = open;
    });
    document.addEventListener('click', event => {
      if(!event.target.closest('[data-guides-wrap]')) closeGuides();
    });
    document.addEventListener('keydown', event => {
      if(event.key === 'Escape') closeGuides();
    });
  }
}

function initModalDismiss(){
  document.addEventListener('click', event => {
    const closeButton = event.target.closest('[data-close-modal]');
    if(closeButton){
      const modal = closeButton.closest('.modal-backdrop');
      if(modal){
        modal.hidden = true;
        if(!document.querySelector('.modal-backdrop:not([hidden])')) document.body.classList.remove('modal-open');
      }
      return;
    }
    if(event.target.classList.contains('modal-backdrop')){
      event.target.hidden = true;
      if(!document.querySelector('.modal-backdrop:not([hidden])')) document.body.classList.remove('modal-open');
    }
  });

  document.addEventListener('keydown', event => {
    if(event.key !== 'Escape') return;
    const openModals = [...document.querySelectorAll('.modal-backdrop:not([hidden])')];
    const modal = openModals[openModals.length - 1];
    if(modal){
      modal.hidden = true;
      if(openModals.length === 1) document.body.classList.remove('modal-open');
    }
  });
}

function initNumberSteppers(){
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-number-step]');
    if(!button) return;
    const input = document.getElementById(button.dataset.numberTarget);
    if(!input) return;
    const minimum = Number(input.min) || 0;
    const maximum = Number(input.max) || Number.MAX_SAFE_INTEGER;
    const step = Number(button.dataset.numberStep) || 1;
    const current = Number(input.value) || minimum;
    input.value = String(Math.max(minimum, Math.min(maximum, current + step)));
    input.focus();
  });
}

initLocale();
initNavigation();
initModalDismiss();
initNumberSteppers();
refreshIcons();
initAuthUI();
