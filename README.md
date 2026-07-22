# Auction Split

Funkcionalni investitorski demo marketplacea za popunjavanje slobodnog hotelskog i apartmanskog kapaciteta. Projekt je brendiran za domenu `auction.split`.

## Pokretanje

```bash
npm install
npm run dev
```

Demo se otvara na `http://127.0.0.1:5173/`. Lokalni Node server istodobno poslužuje frontend, autentikaciju i JSON API bez vanjskih servisa.

```bash
npm run build       # statički build u dist/
npm run preview     # pregled dist/ builda
npm run test:api    # integracijski test autentikacije, ovlasti i aukcijskog toka
npm run test:build  # provjera Pages podputanje i sigurnosti statičkog seeda
npm test            # cijeli testni paket
python3 -m pip install -r requirements.txt
npm run brochures   # ponovno generira PDF brošure nakon instalacije ReportLaba
```

## Načini produkcijskog pokretanja

Projekt više ne pretpostavlja da svaki hosting može pokrenuti Node API.

- `npm start` pokreće puni frontend i pravi Node API na istom originu
- `DATA_DIR=/var/lib/auction-split npm start` sprema radnu bazu na trajni disk
- `Dockerfile` pakira isti puni servis i izlaže health check na `/api/health`
- GitHub Pages workflow gradi projekt s `/split.auction` podputanjom
- ako statički hosting nema `/api`, frontend automatski aktivira pregledničku prezentacijsku bazu umjesto poruke da API nije dostupan

Prezentacijska baza na statičkom hostingu sprema promjene u lokalni browser i namijenjena je investitorskom prikazu. Puni Node način koristi zajedničku serversku bazu za sve korisnike instance.

## Proizvodne cjeline

- `index.html` - početna stranica i brzi ulaz u aukcije
- `demo.html` - javni katalog, kalendar, paketi, karta, bidanje i potvrda pobjede
- `account.html` - ponude, praćenje, rezervacije, profil i promjena lozinke
- `partner.html` - zaštićeni Partner centar za smještaje, pakete, aukcije, potvrde i tim
- `koncept.html` - poslovni model, podjela razlike i scenarij rasta
- `brosura-korisnici.html` - vodič za goste s PDF verzijom
- `brosura-partneri.html` - vodič za hotele i apartmane s PDF verzijom

## Frontend arhitektura

- `src/shared.js` - API klijent, formatiranje, ekonomika aukcije, modali i obavijesti
- `src/auth.js` - prijava, registracija, oporavak lozinke i stanje korisničke sesije
- `src/site.js` - zajednička navigacija, autentikacija, ikone i zatvaranje modala
- `src/demo.js` - stanje i interakcije gostujućeg marketplacea
- `src/account.js` - korisničke ponude, praćenje, rezervacije i sigurnosne postavke
- `src/partner.js` - partnerski dashboard, paketi, ovlasti i administracija inventara
- `src/styles.css` - zajednički responzivni vizualni sustav
- `scripts/server/security.js` - scrypt lozinke, tokeni, kolačići i sigurnosna validacija
- `scripts/server/database.js` - atomski JSON zapis, migracija i reset demo podataka
- `scripts/server/api.js` - autentikacija, autorizacija i poslovni API
- `src/static-api.js` - funkcionalni lokalni API adapter za statičke produkcijske deploye
- `.github/workflows/pages.yml` - automatski GitHub Pages build i deploy
- `Dockerfile` - puni produkcijski Node servis s trajnim `DATA_DIR` volumenom
- `vendor/lucide.min.js` - lokalna kopija Lucide ikona s licencom
- `assets/auction-split-logo.svg` - puni Auction Split znak za prezentacije i materijale
- `assets/favicon.svg` - pojednostavljena podijeljena oznaka za aplikaciju i karticu preglednika
- `assets/media/` - lokalni vizuali smještaja za stabilan investitorski demo

## Poslovna pravila u demu

- partner kreira smještaj i jedan ili više aukcijskih paketa
- svaki paket ima vlastite datume, sobu, obrok, hladnu cijenu, jedinice i status
- gost određuje svoju početnu ponudu i trajanje od 15 minuta do 24 sata
- sljedeća ponuda uvijek kreće od trenutačne najviše ponude + 5 EUR
- hotel dobiva hladnu cijenu plus 70% razlike, platforma 30%
- manji smještaj dobiva hladnu cijenu plus 60% razlike, platforma 40%
- nema fiksne naknade za oglašavanje

## Demo računi

Brzi ulaz nalazi se u modalu za prijavu. Računi su namjerno poznati i služe samo lokalnoj prezentaciji.

| Uloga | E-mail | Lozinka |
| --- | --- | --- |
| Gost | `gost@auction.split` | `Demo123!` |
| Partner | `partner@auction.split` | `Partner123!` |
| Administrator | `admin@auction.split` | `Admin123!` |

Dodatni partnerski setovi koriste lozinku `Partner123!`: `manager@auction.split`, `editor@auction.split`, `adriatic@auction.split` i `host@auction.split`.

Gost može licitirati, pratiti aukcije i potvrditi vlastitu vodeću ponudu. Partner vidi samo vlastite objekte i pakete. Administrator vidi cijeli demo portfolio i može vratiti početno stanje.

## Sigurnosni model

- lozinke su hashirane Node `scrypt` algoritmom sa zasebnom soli
- preglednik dobiva nasumičnu HTTP-only, SameSite sesiju; baza sprema samo hash tokena
- sve prijavljene mutacije zahtijevaju CSRF token
- prijava, registracija i oporavak lozinke imaju rate limiting
- uloge su `guest`, `partner` i `admin`; partnerske ovlasti su `owner`, `manager`, `editor` i `viewer`
- partner ne može čitati ni mijenjati tuđi inventar
- baza, hashirani računi, skripte i Git podaci nisu dostupni kroz statički server
- sigurnosne promjene i poslovne mutacije zapisuju se u audit log

## Demo podaci i API

`data/seed-db.json` sadrži 16 smještaja, a migracija iz njega stvara 38 paketa, 18 početnih ponuda i 5 rezervacijskih scenarija. `data/auth-seed.json` sadrži 7 hashiranih demo računa raspoređenih u 3 partnerska portfolija, a ignorirani `data/demo-db.json` je radna baza. Reset je dostupan samo platformskom administratoru.

- `GET /api/health`
- `GET /api/auth/session`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/account/activity`
- `PATCH /api/account/profile`
- `POST /api/account/password`
- `GET /api/state`
- `GET /api/partner/state`
- `POST /api/bids`
- `POST /api/watch`
- `POST /api/reservations`
- `PATCH /api/reservations/:id`
- `POST /api/hotels`
- `PUT /api/hotels/:id`
- `DELETE /api/hotels/:id`
- `POST /api/packages`
- `PUT /api/packages/:id`
- `DELETE /api/packages/:id`
- `POST /api/team/invitations`
- `DELETE /api/team/invitations/:id`
- `POST /api/reset`

## Produkcijska granica

Autentikacija, autorizacija, vlasništvo, paketi, ponude, potvrde, otkazivanje, statusi rezervacija, pozivnice i audit log rade u Node i statičkom prezentacijskom načinu. Za komercijalno puštanje s pravim novcem JSON pohranu treba zamijeniti PostgreSQL bazom, a preglednički adapter isključiti; potrebni su još stvarna e-mail verifikacija, platni procesor, objektna pohrana fotografija, distribuirani vremenski auction engine, monitoring, backup, regulatorna i pravna provjera te testovi opterećenja.
