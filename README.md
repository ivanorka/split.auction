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
python3 -m pip install -r requirements.txt
npm run brochures   # ponovno generira PDF brošure nakon instalacije ReportLaba
```

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
- `vendor/lucide.min.js` - lokalna kopija Lucide ikona s licencom
- `assets/auction-split-logo.svg` - puni Auction Split znak za prezentacije i materijale
- `assets/favicon.svg` - pojednostavljena podijeljena oznaka za aplikaciju i karticu preglednika
- `assets/media/` - lokalni vizuali smještaja za stabilan investitorski demo

## Poslovna pravila u demu

- partner kreira smještaj i jedan ili više aukcijskih paketa
- svaki paket ima vlastite datume, sobu, obrok, hladnu cijenu, jedinice i status
- gost određuje svoju početnu ponudu i trajanje od 15 minuta do 24 sata
- sljedeća ponuda ne može biti niža od hotelova minimuma, gostova praga ni trenutačne ponude + 5 EUR
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

`data/seed-db.json` je poslovni početni scenarij, `data/auth-seed.json` sadrži hashirane demo račune, a ignorirani `data/demo-db.json` je radna baza. Reset je dostupan samo platformskom administratoru.

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

Autentikacija, autorizacija, vlasništvo, paketi, ponude, potvrde, pozivnice i audit log stvarno rade u lokalnom demu. Produkcijska verzija i dalje treba transakcijsku bazu, distribuirani vremenski auction engine, stvarnu e-mail verifikaciju i slanje pozivnica, platni procesor, pohranu fotografija, monitoring, backup, regulatornu i pravnu provjeru te testove opterećenja.
