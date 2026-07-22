from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
OUT.mkdir(parents=True, exist_ok=True)

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

pdfmetrics.registerFont(TTFont("SplitAuction", FONT_REGULAR))
pdfmetrics.registerFont(TTFont("SplitAuction-Bold", FONT_BOLD))

PAGE_W, PAGE_H = A4
PRIMARY = colors.HexColor("#df3f4b")
ACCENT = colors.HexColor("#087e8b")
TEXT = colors.HexColor("#172033")
MUTED = colors.HexColor("#667085")
LINE = colors.HexColor("#d9e2ec")
SOFT = colors.HexColor("#f6f8fa")


def styles():
    base = getSampleStyleSheet()
    base.add(
        ParagraphStyle(
            name="Kicker",
            fontName="SplitAuction-Bold",
            fontSize=8.5,
            leading=11,
            textColor=ACCENT,
            uppercase=True,
            spaceAfter=8,
        )
    )
    base.add(
        ParagraphStyle(
            name="HeroTitle",
            fontName="SplitAuction-Bold",
            fontSize=30,
            leading=33,
            textColor=TEXT,
            spaceAfter=12,
        )
    )
    base.add(
        ParagraphStyle(
            name="SectionTitle",
            fontName="SplitAuction-Bold",
            fontSize=16,
            leading=20,
            textColor=TEXT,
            spaceBefore=8,
            spaceAfter=8,
        )
    )
    base.add(
        ParagraphStyle(
            name="Body",
            fontName="SplitAuction",
            fontSize=10,
            leading=15,
            textColor=MUTED,
            spaceAfter=8,
        )
    )
    base.add(
        ParagraphStyle(
            name="BodyStrong",
            fontName="SplitAuction-Bold",
            fontSize=10.5,
            leading=15,
            textColor=TEXT,
            spaceAfter=6,
        )
    )
    base.add(
        ParagraphStyle(
            name="Metric",
            fontName="SplitAuction-Bold",
            fontSize=20,
            leading=23,
            textColor=PRIMARY,
            alignment=TA_LEFT,
        )
    )
    base.add(
        ParagraphStyle(
            name="Small",
            fontName="SplitAuction",
            fontSize=8,
            leading=11,
            textColor=MUTED,
        )
    )
    return base


S = styles()


def p(text, style="Body"):
    return Paragraph(text, S[style])


def card_table(items, col_widths=None):
    rows = []
    for kicker, title, body in items:
        rows.append([p(kicker, "Small"), p(title, "BodyStrong"), p(body, "Body")])
    table = Table(rows, colWidths=col_widths or [32 * mm, 45 * mm, 86 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SOFT),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def metrics_table(items):
    cells = []
    for label, value, note in items:
        cells.append([p(label, "Small"), p(value, "Metric"), p(note, "Small")])
    table = Table([cells], colWidths=[52 * mm] * len(items))
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return table


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(TEXT)
    canvas.setFont("SplitAuction-Bold", 9)
    canvas.drawString(18 * mm, PAGE_H - 13 * mm, "Auction Split")
    canvas.setFillColor(MUTED)
    canvas.setFont("SplitAuction", 7.5)
    canvas.drawString(48 * mm, PAGE_H - 13 * mm, "auction.split")
    canvas.setFillColor(MUTED)
    canvas.setFont("SplitAuction", 8)
    canvas.drawRightString(PAGE_W - 18 * mm, 11 * mm, f"Stranica {doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, PAGE_H - 17 * mm, PAGE_W - 18 * mm, PAGE_H - 17 * mm)
    canvas.restoreState()


def build_pdf(filename, story):
    doc = SimpleDocTemplate(
        str(OUT / filename),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=24 * mm,
        bottomMargin=18 * mm,
    )
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)


def guest_story():
    story = [
        p("BROŠURA ZA GOSTE", "Kicker"),
        p("Rezerviraj pametnije: odaberi termin, postavi ponudu i prati aukciju.", "HeroTitle"),
        p(
            "Auction Split pomaže gostima pronaći slobodan smještaj u terminima kada hoteli i apartmani imaju prazan kapacitet. "
            "Umjesto beskonačnog listanja i fiksnog cjenika, gost dobiva transparentan aukcijski proces.",
            "Body",
        ),
        Spacer(1, 8),
        metrics_table(
            [
                ("Početna ponuda", "40 €", "Gost sam bira prag od kojeg želi krenuti."),
                ("Hladna cijena", "50 €", "Minimalna cijena koju je partner postavio."),
                ("Završna ponuda", "80 €", "Cijena nakon završetka aukcije."),
            ]
        ),
        Spacer(1, 14),
        p("Kako radi korisnički put", "SectionTitle"),
        card_table(
            [
                ("01", "Odaberi datume", "Kalendar odmah pokazuje koji smještaji imaju slobodan kapacitet za odabrane dane."),
                ("02", "Postavi početnu ponudu", "Gost bira iznos od kojeg želi krenuti. Platforma prikazuje smještaje koji se uklapaju."),
                ("03", "Prati bidanje", "Ponude su anonimne za druge sudionike, a korisnik vidi vlastiti status i sljedeći korak."),
                ("04", "Dobij potvrdu", "Nakon završetka aukcije pobjednik dobiva potvrdu smještaja s jasnim iznosom i terminom."),
            ]
        ),
        PageBreak(),
        p("Zašto je korisniku intuitivno?", "SectionTitle"),
        card_table(
            [
                ("Manje lutanja", "Najbolji match je istaknut", "Korisnik ne mora uspoređivati deset portala i dvadeset otvorenih kartica."),
                ("Više kontrole", "Budžet je početna odluka", "Gost sam postavlja početnu ponudu i vidi kako se aukcija razvija."),
                ("Transparentno", "Kartica pokazuje ekonomiku", "Hladna cijena, trenutna ponuda i razlika prikazane su jasno."),
                ("Sigurnije", "Potvrda nakon pobjede", "Pobjednik dobiva jasnu potvrdu smještaja, termina i iznosa."),
            ]
        ),
        Spacer(1, 14),
        p("Obećanje korisniku", "SectionTitle"),
        p(
            "Auction Split nije platforma za skrivene troškove. Korisnik vidi uvjete, početnu ponudu, trenutnu ponudu i smještaj za koji se nadmeće. "
            "Cilj je osjećaj kontrole, a ne pritisak.",
            "Body",
        ),
    ]
    return story


def partner_story():
    story = [
        p("BROŠURA ZA APARTMANE I HOTELE", "Kicker"),
        p("Prazan kapacitet dobiva kanal prodaje bez unaprijed plaćenog marketinga.", "HeroTitle"),
        p(
            "Partner sam određuje hladnu početnu cijenu, slobodne datume i slike. Aukcija pokušava stvoriti dodatnu vrijednost iznad tog minimuma. "
            "Platforma zarađuje samo ako se stvori razlika.",
            "Body",
        ),
        Spacer(1, 8),
        metrics_table(
            [
                ("Hotel model", "70/30", "Hotel dobiva hladnu cijenu plus 70% razlike."),
                ("Apartman model", "60/40", "Manji smještaji mogu imati drukčiji odnos zbog veće operative."),
                ("Primjer", "50 € → 80 €", "Razlika je 30 €, od čega 21 € ide partneru, 9 € platformi."),
            ]
        ),
        Spacer(1, 14),
        p("Operativni proces", "SectionTitle"),
        card_table(
            [
                ("01", "Unos hladne cijene", "Partner postavlja minimum ispod kojeg ne želi prodati prazan kapacitet."),
                ("02", "Slike i dostupnost", "Administrator dodaje slike, grad, adresu, koordinate i slobodne datume."),
                ("03", "Aukcija radi za rupu", "Model se ne koristi za špicu, nego za predsezonu, posezonu i prazne sobe."),
                ("04", "Prihod bez oglasnog rizika", "Nema plaćanja prikaza, bannera ili članarine prije rezultata."),
            ]
        ),
        PageBreak(),
        p("Zašto partnerima ima smisla?", "SectionTitle"),
        card_table(
            [
                ("Kontrola", "Partner kontrolira minimum", "Hladna cijena i dostupnost ostaju u rukama smještaja."),
                ("Učinak", "Prazna soba dobiva šansu", "Kapacitet koji bi ostao prazan može stvoriti dodatni prihod."),
                ("Fer model", "Platforma dijeli samo razliku", "Nema plaćanja reklame prije nego se stvori nova vrijednost."),
                ("Skaliranje", "Model radi po destinacijama", "Kad se pokaže učinak, mogu se uključivati novi partneri i gradovi."),
            ]
        ),
        Spacer(1, 14),
        p("Partnersko obećanje", "SectionTitle"),
        p(
            "Auction Split ne zamjenjuje postojeće kanale prodaje u špici. Platforma dodaje novi sloj potražnje za termine u kojima je kapacitet prazan, "
            "uz transparentnu podjelu novostvorene vrijednosti.",
            "Body",
        ),
        Spacer(1, 10),
        p("Indikativni potencijal: za partnere koji ozbiljno koriste model u hladnom pogonu, predsezoni i posezoni cilj je +5-15% godišnjeg prometa.", "BodyStrong"),
    ]
    return story


def platform_story():
    hero = Image(str(ROOT / "assets" / "media" / "auction-split-hero.jpg"), width=174 * mm, height=76 * mm)
    hero.hAlign = "LEFT"
    story = [
        hero,
        Spacer(1, 16),
        p("BROŠURA PLATFORME", "Kicker"),
        p("Auction Split pretvara slobodan smještaj u transparentnu priliku za putovanje i prihod.", "HeroTitle"),
        p(
            "Platforma povezuje goste koji žele jasniji budžet s hotelima i apartmanima koji žele popuniti hladni pogon. "
            "Partner postavlja granicu, gost bira početnu ponudu, a Auction Split zarađuje samo kada aukcija stvori novu vrijednost.",
            "Body",
        ),
        Spacer(1, 10),
        metrics_table(
            [
                ("Za gosta", "Jasna ponuda", "Termin, trenutačna cijena i sljedeći korak vidljivi su prije svakog bida."),
                ("Za partnera", "Kontroliran minimum", "Hladna cijena i dostupnost ostaju pod kontrolom smještaja."),
                ("Za platformu", "Samo rast", "Prihod nastaje isključivo iz razlike koju aukcija stvori."),
            ]
        ),
        PageBreak(),
        p("Kako radi", "SectionTitle"),
        card_table(
            [
                ("01", "Partner objavi prazan termin", "Dodaje smještaj, slobodne datume, broj jedinica i hladnu cijenu ispod koje ne želi prodati."),
                ("02", "Gost postavi početnu ponudu", "Pretraga prikazuje pakete prema odredištu, terminu i budžetu koji gost želi istražiti."),
                ("03", "Aukcija vodi sljedeći korak", "Trenutačna vodeća cijena i sljedeća ponuda prikazane su jasno. Svaki novi bid kreće od trenutačne cijene plus 5 EUR."),
                ("04", "Pobjednik potvrđuje rezervaciju", "Nakon pobjede potvrda s paketom, terminom i iznosom ostaje spremljena u korisničkom računu."),
            ]
        ),
        Spacer(1, 16),
        p("Fer ekonomika", "SectionTitle"),
        metrics_table(
            [
                ("Hotel", "70 / 30", "Hotel dobiva hladnu cijenu plus 70% novostvorene razlike."),
                ("Apartman", "60 / 40", "Manji smještaji rade prema posebnom operativnom omjeru."),
                ("Oglas", "0 EUR", "Nema članarine ni plaćenog isticanja prije rezultata."),
            ]
        ),
        PageBreak(),
        p("Jedan sustav, dva jasna puta", "SectionTitle"),
        card_table(
            [
                ("GOST", "Pronađi termin", "Kalendar, filtri, anonimne ponude, praćenje aukcije i potvrda rezervacije."),
                ("PARTNER", "Upravljaj ponudom", "Smještaji, paketi, hladne cijene, inventar, potvrde i partnerski tim."),
                ("PILOT", "Split", "Pilot u gradu Splitu testira model za širenje prema drugim destinacijama."),
                ("SLJEDEĆI KORAK", "auction.split", "Istražite aktivne aukcije, pročitajte vodiče ili otvorite račun gosta odnosno partnera."),
            ]
        ),
        Spacer(1, 16),
        p("Auction Split ne pokušava sniziti vrijednost smještaja. Cilj je da kapacitet koji bi ostao prazan dobije kontroliranu priliku za novi prihod, a gost transparentan način da dođe do termina.", "BodyStrong"),
    ]
    return story


INK = colors.HexColor("#13221F")
MIST = colors.HexColor("#F2F5F3")
CORAL = colors.HexColor("#E24B57")
TEAL = colors.HexColor("#087C71")
SAGE = colors.HexColor("#DDEAE5")


def cover_image(c, image_path, x, y, width, height):
    image = ImageReader(str(image_path))
    image_width, image_height = image.getSize()
    scale = max(width / image_width, height / image_height)
    draw_width = image_width * scale
    draw_height = image_height * scale
    clip = c.beginPath()
    clip.rect(x, y, width, height)
    c.saveState()
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(image, x + (width - draw_width) / 2, y + (height - draw_height) / 2, draw_width, draw_height, mask="auto")
    c.restoreState()


def premium_paragraph(c, text, x, y, width, style):
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(width, 1000)
    paragraph.drawOn(c, x, y - height)
    return y - height


def premium_styles():
    return {
        "eyebrow": ParagraphStyle("PremiumEyebrow", fontName="SplitAuction-Bold", fontSize=8, leading=10, textColor=TEAL, uppercase=True),
        "title-dark": ParagraphStyle("PremiumTitleDark", fontName="SplitAuction-Bold", fontSize=31, leading=35, textColor=INK),
        "title-light": ParagraphStyle("PremiumTitleLight", fontName="SplitAuction-Bold", fontSize=34, leading=38, textColor=colors.white),
        "body": ParagraphStyle("PremiumBody", fontName="SplitAuction", fontSize=10.5, leading=15, textColor=MUTED),
        "body-light": ParagraphStyle("PremiumBodyLight", fontName="SplitAuction", fontSize=10.5, leading=15, textColor=colors.HexColor("#DDE8E4")),
        "card-title": ParagraphStyle("PremiumCardTitle", fontName="SplitAuction-Bold", fontSize=12, leading=15, textColor=INK),
        "card-body": ParagraphStyle("PremiumCardBody", fontName="SplitAuction", fontSize=8.6, leading=12, textColor=MUTED),
        "card-light": ParagraphStyle("PremiumCardLight", fontName="SplitAuction-Bold", fontSize=11.5, leading=14, textColor=colors.white),
        "quote": ParagraphStyle("PremiumQuote", fontName="SplitAuction-Bold", fontSize=16, leading=21, textColor=INK),
    }


PS = premium_styles()


def premium_header(c, page, inverse=False):
    color = colors.white if inverse else INK
    c.setFillColor(color)
    c.setFont("SplitAuction-Bold", 10)
    c.drawString(18 * mm, PAGE_H - 15 * mm, "Auction Split")
    c.setFont("SplitAuction", 8)
    c.drawString(52 * mm, PAGE_H - 15 * mm, "auction.split")
    c.setFillColor(CORAL if inverse else TEAL)
    c.rect(PAGE_W - 31 * mm, PAGE_H - 18 * mm, 13 * mm, 4 * mm, fill=1, stroke=0)
    c.setFillColor(color)
    c.setFont("SplitAuction", 8)
    c.drawRightString(PAGE_W - 18 * mm, 12 * mm, f"0{page}")


def premium_card(c, x, y, width, height, number, title, body, accent=CORAL):
    c.setFillColor(colors.white)
    c.roundRect(x, y, width, height, 5 * mm, fill=1, stroke=0)
    c.setFillColor(accent)
    c.roundRect(x + 7 * mm, y + height - 17 * mm, 22 * mm, 10 * mm, 4 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("SplitAuction-Bold", 7.5)
    c.drawCentredString(x + 18 * mm, y + height - 13.3 * mm, number)
    premium_paragraph(c, title, x + 7 * mm, y + height - 24 * mm, width - 14 * mm, PS["card-title"])
    premium_paragraph(c, body, x + 7 * mm, y + height - 43 * mm, width - 14 * mm, PS["card-body"])


def build_premium_platform_brochure(filename):
    target = OUT / filename
    c = canvas.Canvas(str(target), pagesize=A4)
    hero = ROOT / "assets" / "media" / "auction-split-hero.jpg"
    apartment = ROOT / "assets" / "media" / "bacvice-apartment.jpg"
    hotel = ROOT / "assets" / "media" / "split-city-hotel.jpg"

    # 01 Cover
    cover_image(c, hero, 0, 0, PAGE_W, PAGE_H)
    c.setFillColor(INK)
    c.rect(0, 0, PAGE_W * 0.57, PAGE_H, fill=1, stroke=0)
    premium_header(c, 1, inverse=True)
    c.setFillColor(CORAL)
    c.roundRect(18 * mm, PAGE_H - 58 * mm, 38 * mm, 8 * mm, 3 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("SplitAuction-Bold", 7.5)
    c.drawCentredString(37 * mm, PAGE_H - 55 * mm, "BROŠURA PLATFORME")
    premium_paragraph(c, "Slobodan termin.<br/>Nova vrijednost.", 18 * mm, PAGE_H - 80 * mm, 91 * mm, PS["title-light"])
    premium_paragraph(c, "Auction Split povezuje slobodan smještaj s gostima koji žele jasniji i transparentniji način rezervacije.", 18 * mm, PAGE_H - 166 * mm, 88 * mm, PS["body-light"])
    c.setFillColor(colors.HexColor("#BFD8D2"))
    c.setFont("SplitAuction-Bold", 9)
    c.drawString(18 * mm, 28 * mm, "PILOT: SPLIT")
    c.setFont("SplitAuction", 9)
    c.drawString(18 * mm, 21 * mm, "Za gosta. Za partnera. Za kapacitet koji ne smije ostati prazan.")
    c.showPage()

    # 02 Concept
    c.setFillColor(MIST)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    premium_header(c, 2)
    c.setFillColor(TEAL)
    c.setFont("SplitAuction-Bold", 8)
    c.drawString(18 * mm, PAGE_H - 35 * mm, "KONCEPT")
    premium_paragraph(c, "Prazan kapacitet nije popust.<br/>To je neiskorištena prilika.", 18 * mm, PAGE_H - 47 * mm, 115 * mm, PS["title-dark"])
    premium_paragraph(c, "Partner određuje hladnu cijenu ispod koje ne želi prodati. Gost bira termin i prati jasnu aukciju. Platforma zarađuje samo iz vrijednosti koja nastane iznad partnerova minimuma.", 18 * mm, PAGE_H - 107 * mm, 102 * mm, PS["body"])
    cover_image(c, hotel, 18 * mm, 96 * mm, 174 * mm, 72 * mm)
    c.setFillColor(colors.white)
    c.roundRect(18 * mm, 43 * mm, 174 * mm, 40 * mm, 5 * mm, fill=1, stroke=0)
    columns = [("0 €", "bez plaćenog oglasa"), ("70 / 30", "hotel model podjele"), ("60 / 40", "apartman model podjele")]
    for index, (metric, note) in enumerate(columns):
        x = 28 * mm + index * 55 * mm
        c.setFillColor(CORAL)
        c.setFont("SplitAuction-Bold", 21)
        c.drawString(x, 65 * mm, metric)
        c.setFillColor(MUTED)
        c.setFont("SplitAuction", 8)
        c.drawString(x, 57 * mm, note)
    c.showPage()

    # 03 How it works
    c.setFillColor(INK)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    premium_header(c, 3, inverse=True)
    c.setFillColor(colors.white)
    c.setFont("SplitAuction-Bold", 8)
    c.drawString(18 * mm, PAGE_H - 35 * mm, "KAKO RADI")
    premium_paragraph(c, "Četiri jasna koraka.<br/>Jedan kontrolirani tok.", 18 * mm, PAGE_H - 47 * mm, 125 * mm, PS["title-light"])
    steps = [
        ("01", "Objavite prazan termin", "Partner unosi smještaj, slobodne datume i hladnu cijenu."),
        ("02", "Gost postavlja uvjete", "Odredište, termin i početna ponuda usmjeravaju pretragu."),
        ("03", "Aukcija vodi cijenu", "Svaka sljedeća ponuda ide od trenutačne cijene plus 5 EUR."),
        ("04", "Potvrdite pobjedu", "Pobjednik potvrđuje rezervaciju, a sustav pamti cijeli tijek."),
    ]
    for index, (number, title, body) in enumerate(steps):
        column = index % 2
        row = index // 2
        x = 18 * mm + column * 88 * mm
        y = 111 * mm - row * 63 * mm
        c.setFillColor(colors.HexColor("#1E3430"))
        c.roundRect(x, y, 82 * mm, 53 * mm, 5 * mm, fill=1, stroke=0)
        c.setFillColor(CORAL if index in (0, 3) else colors.HexColor("#9CD7C9"))
        c.setFont("SplitAuction-Bold", 9)
        c.drawString(x + 7 * mm, y + 42 * mm, number)
        c.setFillColor(colors.white)
        premium_paragraph(c, title, x + 7 * mm, y + 35 * mm, 66 * mm, PS["card-light"])
        premium_paragraph(c, body, x + 7 * mm, y + 20 * mm, 66 * mm, PS["body-light"])
    c.showPage()

    # 04 Guest
    c.setFillColor(colors.white)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    premium_header(c, 4)
    cover_image(c, apartment, 0, PAGE_H - 120 * mm, PAGE_W, 120 * mm)
    c.setFillColor(colors.white)
    c.roundRect(18 * mm, PAGE_H - 151 * mm, 118 * mm, 52 * mm, 5 * mm, fill=1, stroke=0)
    c.setFillColor(TEAL)
    c.setFont("SplitAuction-Bold", 8)
    c.drawString(26 * mm, PAGE_H - 115 * mm, "ZA GOSTA")
    premium_paragraph(c, "Manje lutanja.<br/>Više kontrole.", 26 * mm, PAGE_H - 124 * mm, 100 * mm, PS["title-dark"])
    premium_paragraph(c, "Gost vidi smještaj, trenutačnu cijenu, sljedeći dopušteni korak i vlastiti status bez skrivenih troškova.", 18 * mm, PAGE_H - 168 * mm, 126 * mm, PS["body"])
    guest_cards = [
        ("01", "Odaberi termin", "Kalendar prikazuje dane sa slobodnim kapacitetom."),
        ("02", "Postavi ponudu", "Početna ponuda služi za lakši odabir smještaja."),
        ("03", "Prati aukciju", "Sljedeća cijena i status prikazani su u realnom vremenu."),
    ]
    for index, card in enumerate(guest_cards):
        premium_card(c, 18 * mm + index * 58 * mm, 34 * mm, 54 * mm, 72 * mm, *card, accent=TEAL)
    c.showPage()

    # 05 Partner
    c.setFillColor(MIST)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    premium_header(c, 5)
    c.setFillColor(CORAL)
    c.rect(0, PAGE_H - 81 * mm, PAGE_W, 81 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("SplitAuction-Bold", 8)
    c.drawString(18 * mm, PAGE_H - 34 * mm, "ZA PARTNERA")
    premium_paragraph(c, "Kontrola ostaje<br/>kod smještaja.", 18 * mm, PAGE_H - 45 * mm, 112 * mm, PS["title-light"])
    cover_image(c, hotel, 120 * mm, PAGE_H - 74 * mm, 72 * mm, 51 * mm)
    premium_paragraph(c, "Partner sam upravlja hladnom cijenom, inventarom, sadržajem paketa i datumima. Platforma ne naplaćuje oglas - dijeli samo rast koji aukcija stvori.", 18 * mm, PAGE_H - 104 * mm, 134 * mm, PS["body"])
    c.setFillColor(colors.white)
    c.roundRect(18 * mm, 86 * mm, 174 * mm, 55 * mm, 5 * mm, fill=1, stroke=0)
    numbers = [("50 €", "hladna cijena"), ("80 €", "završna ponuda"), ("30 €", "nova razlika")]
    for index, (value, label) in enumerate(numbers):
        x = 30 * mm + index * 55 * mm
        c.setFillColor(CORAL if index == 2 else INK)
        c.setFont("SplitAuction-Bold", 23)
        c.drawString(x, 116 * mm, value)
        c.setFillColor(MUTED)
        c.setFont("SplitAuction", 8)
        c.drawString(x, 107 * mm, label)
    c.setFillColor(TEAL)
    c.setFont("SplitAuction-Bold", 12)
    c.drawString(30 * mm, 94 * mm, "Hotel prima 71 €")
    c.setFillColor(MUTED)
    c.setFont("SplitAuction", 9)
    c.drawString(30 * mm, 87 * mm, "50 € hladna cijena + 21 € udio iz razlike")
    c.setFillColor(INK)
    c.setFont("SplitAuction-Bold", 15)
    c.drawString(18 * mm, 62 * mm, "Bez članarine. Bez plaćenog isticanja.")
    premium_paragraph(c, "Samo kapacitet koji bi ostao prazan dobiva novu priliku za prihod.", 18 * mm, 54 * mm, 112 * mm, PS["body"])
    c.showPage()

    # 06 Closing
    c.setFillColor(TEAL)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    premium_header(c, 6, inverse=True)
    c.setFillColor(colors.white)
    c.setFont("SplitAuction-Bold", 8)
    c.drawString(18 * mm, PAGE_H - 35 * mm, "SLJEDEĆI KORAK")
    premium_paragraph(c, "Jedna platforma.<br/>Dva jasna puta.", 18 * mm, PAGE_H - 47 * mm, 120 * mm, PS["title-light"])
    c.setFillColor(colors.white)
    c.roundRect(18 * mm, 94 * mm, 84 * mm, 78 * mm, 5 * mm, fill=1, stroke=0)
    c.roundRect(108 * mm, 94 * mm, 84 * mm, 78 * mm, 5 * mm, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("SplitAuction-Bold", 8)
    c.drawString(27 * mm, 156 * mm, "GOST")
    c.drawString(117 * mm, 156 * mm, "PARTNER")
    premium_paragraph(c, "Pronađite aktivnu aukciju i odlučite za koji termin želite licitirati.", 27 * mm, 148 * mm, 64 * mm, PS["card-body"])
    premium_paragraph(c, "Otvorite partnerski račun i pretvorite prazan kapacitet u ponudu.", 117 * mm, 148 * mm, 64 * mm, PS["card-body"])
    c.setFillColor(CORAL)
    c.roundRect(27 * mm, 106 * mm, 48 * mm, 12 * mm, 4 * mm, fill=1, stroke=0)
    c.roundRect(117 * mm, 106 * mm, 48 * mm, 12 * mm, 4 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("SplitAuction-Bold", 8)
    c.drawCentredString(51 * mm, 110.5 * mm, "ISTRAŽI AUKCIJE")
    c.drawCentredString(141 * mm, 110.5 * mm, "OTVORI RAČUN")
    c.setFillColor(colors.HexColor("#C9E6DF"))
    c.setFont("SplitAuction", 11)
    c.drawCentredString(PAGE_W / 2, 52 * mm, "auction.split")
    c.setFont("SplitAuction-Bold", 17)
    c.setFillColor(colors.white)
    c.drawCentredString(PAGE_W / 2, 39 * mm, "Slobodan termin. Nova vrijednost.")
    c.save()



if __name__ == "__main__":
    build_premium_platform_brochure("auction-split-brosura.pdf")
    build_pdf("auction-split-brosura-korisnici.pdf", guest_story())
    build_pdf("auction-split-brosura-partneri.pdf", partner_story())
    print(f"Generated PDFs in {OUT}")
