# Tauch-Logbuch

Persönliches Tauch-Logbuch als Web-App (PWA). Läuft offline auf dem Handy, alle Daten bleiben auf dem Gerät (IndexedDB), kein Server, kein Login.

| Datei | Zweck |
|---|---|
| `index.html` | Seitengerüst, Tab-Leiste |
| `style.css` | Design hell/dunkel |
| `app.js` | Die ganze App (Logbuch, Brevets, Notfall, Einstellungen, Backup, Testmodus) |
| `manifest.json` | Name, Icons, Farben, Schnellzugriffe „Notfall“ und „Neuer Tauchgang“ |
| `sw.js` | Service Worker für den Offline-Betrieb |
| `icons/` | App-Icons (192 px, 512 px, SVG) |
| `lib/` | QR-Code erzeugen (`qrcode.js`) und scannen (`jsQR.js`) |
| `lokal-testen.ps1` | Kleiner Webserver zum Testen am PC (wird online nicht gebraucht) |

## 1. Lokal am PC testen

Ein Service Worker funktioniert nur über `http://localhost` oder HTTPS, nicht per Doppelklick auf `index.html`.

**Variante A – ohne Installation (PowerShell):**

```powershell
cd C:\HomeAssistant\tauch-logbuch
powershell -ExecutionPolicy Bypass -File .\lokal-testen.ps1
```

Dann im Browser <http://localhost:8080> öffnen. Beenden mit Strg+C.

**Variante B – mit Node.js** (erst Node.js LTS von nodejs.org installieren):

```powershell
cd C:\HomeAssistant\tauch-logbuch
npx serve
```

Die angezeigte Adresse öffnen (meist <http://localhost:3000>).

**Handy-Ansicht am PC:** In Chrome/Edge F12 drücken, dann das Handy-Symbol (Strg+Umschalt+M) und z. B. „iPhone 12“ wählen.

**Zum Ausprobieren:** Einstellungen → „Testmodus starten“. Die Beispieldaten liegen in einer eigenen Datenbank und kommen nie in die echten Daten.

## 2. Kostenlos über GitHub Pages veröffentlichen

Geht komplett im Browser, Git ist nicht nötig.

1. Auf <https://github.com> ein kostenloses Konto anlegen und anmelden.
2. Oben rechts **+ → New repository**.
   - Repository name: `tauch-logbuch`
   - **Public** auswählen (GitHub Pages ist im Gratis-Konto nur für öffentliche Repositories verfügbar).
     Öffentlich ist nur der **Programmcode**. Deine Tauchgänge, Fotos und Notfalldaten liegen ausschließlich auf deinem Handy.
   - **Create repository**.
3. Auf der leeren Repository-Seite auf **„uploading an existing file“** klicken.
4. Im Explorer den Ordner `C:\HomeAssistant\tauch-logbuch` öffnen, **alle Dateien und den Ordner `icons`** markieren und ins Browserfenster ziehen. Prüfen, dass `icons/icon-192.png` usw. in der Liste auftauchen.
5. Unten **Commit changes** klicken.
6. Im Repository **Settings → Pages** öffnen:
   - Source: **Deploy from a branch**
   - Branch: **main**, Ordner **/ (root)** → **Save**.
7. 1–2 Minuten warten und die Seite neu laden. Oben erscheint dann
   **„Your site is live at https://DEIN-NAME.github.io/tauch-logbuch/“**.

## 3. Auf dem Handy installieren

Die Adresse `https://DEIN-NAME.github.io/tauch-logbuch/` auf dem Handy öffnen (mit Internet).

**Android (Chrome):** Menü ⋮ → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“** → Installieren.

**iPhone (Safari, nicht Chrome):** Teilen-Symbol (Quadrat mit Pfeil) → **„Zum Home-Bildschirm“** → Hinzufügen.

Danach die App einmal **vom Home-Bildschirm aus** öffnen, damit alle Dateien offline gespeichert werden. Test: Flugmodus an, App öffnen – sie muss starten.

Tipp: Ein langer Druck auf das App-Icon bietet unter Android die Schnellzugriffe **„Notfall“** und **„Neuer Tauchgang“**.

## 4. Datensicherung – wichtig!

Die Daten gehören zu genau dieser Adresse auf genau diesem Handy. Sie sind weg, wenn du das Handy wechselst, den Browser-Speicher löschst oder die App deinstallierst.

- Einstellungen → **Backup exportieren** → speichern (z. B. Google Drive, iCloud Dateien, per Mail an dich selbst).
- Auf dem neuen Handy: App installieren → Einstellungen → **Backup importieren**.
- Die App erinnert im Logbuch, wenn das letzte Backup älter als 30 Tage ist.
- Daten, die du am PC unter `localhost` eingibst, sind getrennt von denen auf dem Handy. Übertragen geht nur per Backup-Datei.

## 5. Buddys (ab Version 1.1)

Austausch ganz ohne Server, per Nachricht (z. B. WhatsApp):

- **Buddys → Meine Buddy-Karte teilen:** Name, Tauchstatistik und Brevets (optional mit kleinem Foto). Du wählst aus, was mitgeht. Notfalldaten, Kontakte, Notizen und Tauchgang-Fotos werden nie geteilt.
- **Tauchgang → Mit Buddy teilen:** geplante oder getauchte Tauchgänge. Der Buddy übernimmt sie mit einem Tipp, und ein erneutes Teilen aktualisiert den Eintrag, statt ihn doppelt anzulegen.
- **Empfangen:** Nachricht lange drücken → Kopieren → in der App **Buddys → Code einfügen**. Auf dem iPhone öffnet sich ein Link immer in Safari, nicht in der installierten App, deshalb geht es dort über Kopieren und Einfügen.
- Die Daten eines Buddys sind so aktuell wie der letzte Code, den er geschickt hat.
- **QR-Code (ab 1.2):** Beim Teilen auf „QR-Code zeigen“ tippen, und der Buddy scannt ihn unter Buddys → „QR-Code scannen“. Das geht ohne Telefonnummern-Tausch und auch offline. Brevet-Fotos passen nicht in einen QR-Code und gehen nur per Nachricht. Der Scanner nutzt `lib/jsQR.js`, der QR-Erzeuger `lib/qrcode.js` (beide MIT-Lizenz).

## Flaschen (ab 1.2)

Beliebig viele Flaschen pro Tauchgang (z. B. Stage oder Deko), jeweils mit Schieberegler und Zahlenfeld für Größe, O₂-Anteil und Druck. Bei Nitrox zeigt die App die MOD bei ppO₂ 1,4 und 1,6, darunter den gesamten Gasvorrat und den Verbrauch. Ältere Einträge mit einer Flasche werden automatisch übernommen. MOD und ppO₂ in der eingestellten Tiefe stehen auch bei Luft dabei.

## Tauchgangsplan (ab 1.3)

Bei geplanten Tauchgängen: Atemminutenvolumen (SAC), Aufstiegsgeschwindigkeit, Reserve und Sicherheitsstopp einstellen. Die App rechnet Grundzeit, Aufstiegsdauer und Gaswechsel (bei ppO₂ 1,6, auf 3 m abgerundet), dazu den Gasbedarf pro Flasche samt Enddruck und die EAD. Sie zeigt ein kleines Profil und warnt bei zu hohem ppO₂ oder zu wenig Gas. **Keine Dekompressionsberechnung** – Nullzeit und Deko-Stopps immer mit dem Tauchcomputer planen.

## Digitaler Buddy-Stempel (ab 1.4)

Statt Stempel im Papier-Logbuch:
1. Tauchgang öffnen → **Buddy-Stempel anfordern**. Das Handy zeigt einen QR-Code.
2. Der Buddy scannt ihn (Buddys → QR-Code scannen) und tippt auf **Abstempeln**. Sein Handy unterschreibt Datum, Uhrzeit, Platz, Tiefe und Zeit digital und zeigt einen Stempel-QR.
3. Auf der Stempel-Seite **Stempel scannen**, fertig.

Jedes Handy hat ein eigenes Schlüsselpaar (ECDSA P-256 über die Web-Crypto-Schnittstelle des Browsers). Der private Schlüssel verlässt das Gerät nie, auch nicht im Backup. Die App erkennt gefälschte Stempel, nachträglich geänderte Tauchgänge und Schlüssel, die nicht zur Buddy-Karte passen. Auf einem neuen Handy entsteht ein neuer Schlüssel; alte Stempel bleiben gültig. Fern-Stempeln geht auch per Nachricht („Anfrage als Nachricht schicken“ bzw. „Als Nachricht“).

## 6. Später etwas ändern

1. Dateien hier bearbeiten.
2. In `sw.js` die Zeile `const CACHE = 'tauch-logbuch-v1';` hochzählen (`v2`, `v3`, …).
3. Geänderte Dateien bei GitHub wieder per **Add file → Upload files** hochladen (gleiche Namen überschreiben).
4. Auf dem Handy sucht die App beim Öffnen bzw. Zurückkehren selbst nach Updates und lädt sich dann automatisch neu (ab 1.4.1). Von Hand: Einstellungen → **Nach Update suchen**.

Hinweis: GitHub Pages erlaubt Browsern, Dateien 10 Minuten zwischenzuspeichern. Der Service Worker lädt beim Installieren deshalb immer frisch vom Server.
