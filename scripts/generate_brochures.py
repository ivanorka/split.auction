from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
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


if __name__ == "__main__":
    build_pdf("auction-split-brosura.pdf", platform_story())
    build_pdf("auction-split-brosura-korisnici.pdf", guest_story())
    build_pdf("auction-split-brosura-partneri.pdf", partner_story())
    print(f"Generated PDFs in {OUT}")
