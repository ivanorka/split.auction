import {refreshIcons} from './shared.js';
import {initAuthUI} from './auth.js';

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

initNavigation();
initModalDismiss();
refreshIcons();
initAuthUI();
