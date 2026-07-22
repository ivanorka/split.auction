export const supportedLocales = [
  { code:'hr-HR', short:'HR', label:'Hrvatski' },
  { code:'en-GB', short:'EN', label:'English' },
  { code:'de-DE', short:'DE', label:'Deutsch' },
  { code:'it-IT', short:'IT', label:'Italiano' }
];

export const croatianCities = [
  'Beli Manastir', 'Belišće', 'Benkovac', 'Bjelovar', 'Buje', 'Buzet', 'Crikvenica', 'Cres', 'Čabar', 'Čakovec', 'Čazma',
  'Delnice', 'Donja Stubica', 'Donji Miholjac', 'Drniš', 'Duga Resa', 'Dubrovnik', 'Dugo Selo', 'Đakovo', 'Đurđevac',
  'Garešnica', 'Glina', 'Gospić', 'Grubišno Polje', 'Hvar', 'Ilok', 'Imotski', 'Ivanec', 'Ivanić-Grad', 'Jastrebarsko',
  'Karlovac', 'Kastav', 'Kaštela', 'Klanjec', 'Knin', 'Komiža', 'Koprivnica', 'Korčula', 'Kraljevica', 'Krapina', 'Križevci',
  'Krk', 'Kutina', 'Kutjevo', 'Labin', 'Lepoglava', 'Lipik', 'Ludbreg', 'Makarska', 'Mali Lošinj', 'Metković', 'Mursko Središće',
  'Našice', 'Nin', 'Nova Gradiška', 'Novalja', 'Novigrad', 'Novska', 'Obrovac', 'Ogulin', 'Omiš', 'Opatija', 'Opuzen', 'Orahovica',
  'Oroslavje', 'Osijek', 'Otočac', 'Otok', 'Ozalj', 'Pag', 'Pakrac', 'Pazin', 'Petrinja', 'Petrijanec', 'Ploče', 'Popovača',
  'Poreč', 'Požega', 'Pregrada', 'Prelog', 'Pula', 'Rab', 'Rijeka', 'Rovinj', 'Samobor', 'Senj', 'Sinj', 'Sisak', 'Skradin',
  'Slatina', 'Slavonski Brod', 'Slunj', 'Solin', 'Split', 'Stari Grad', 'Supetar', 'Sveta Nedelja', 'Sveti Ivan Zelina',
  'Šibenik', 'Trilj', 'Trogir', 'Umag', 'Valpovo', 'Varaždin', 'Varaždinske Toplice', 'Velika Gorica', 'Vinkovci', 'Virovitica',
  'Vis', 'Vodice', 'Vodnjan', 'Vrbovec', 'Vrbovsko', 'Vrgorac', 'Vrlika', 'Vukovar', 'Zabok', 'Zadar', 'Zagreb', 'Zaprešić', 'Zlatar'
].sort((first, second) => first.localeCompare(second, 'hr'));
