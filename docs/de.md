# Notion Calendar

Holen Sie die Notion-Datenbanken, die Sie in
[Notion Calendar](https://www.notion.com/product/calendar) anzeigen, in
Gladys: Teamplanung, Aufgaben mit Fälligkeitsdatum, Redaktionskalender,
Reisen… Die Termine erscheinen in der Kalenderansicht von Gladys, lösen die
Erinnerung „Ein Termin steht bevor“ aus und versorgen den Assistenten sowie
zwei Dashboard-Widgets.

## Funktionsweise

```
Notion-Datenbanken (Datumseigenschaft)  ──Notion-API──>  diese Integration  ──>  Gladys-Kalender
```

Notion Calendar hat keine öffentliche API: Es zeigt die Notion-Datenbanken
an, die eine **Datumseigenschaft** haben. Die Integration liest genau diese
Datenbanken über die Notion-API und dann:

- wird jede Datenbank (Datenquelle) mit Datumseigenschaft zu einem
  Gladys-**Kalender**, benannt nach der Datenbank;
- wird jede datierte Seite zu einem **Termin**: Titel, Datum (ganztägig oder
  mit Uhrzeit), Notion-Link und, wenn die Datenbank eine Texteigenschaft
  `Location` / `Ort` / `Lieu` / `Lugar` hat, der Ort.

Die Synchronisierung läuft von Notion nach Gladys, standardmäßig alle 15
Minuten. Eine gelöschte Seite oder eine Seite ohne Datum verschwindet bei der
nächsten Synchronisierung aus Gladys. Nur die Szenen-Aktion **Notion-Termin
hinzufügen** schreibt in Notion.

Die Google- oder Outlook-Termine, die Notion Calendar ebenfalls anzeigt,
laufen nicht über Notion: Verwenden Sie dafür die CalDAV- oder
Google-Integration von Gladys.

## Einrichtung

### 1. Eine Notion-Integration erstellen (einmal pro Person)

1. Öffnen Sie [Meine Notion-Integrationen](https://www.notion.so/profile/integrations)
   und erstellen Sie in Ihrem Workspace eine **interne Integration**.
2. Fähigkeiten: **Inhalte lesen** genügt. Haken Sie zusätzlich **Inhalte
   einfügen** an, um die Szenen-Aktion „Notion-Termin hinzufügen“ zu nutzen.
3. Kopieren Sie das **Secret** der Integration (es beginnt mit `ntn_`).
4. Öffnen Sie in jeder zu synchronisierenden Datenbank das Menü **•••** →
   **Verbindungen** und fügen Sie Ihre Integration hinzu. Eine nicht geteilte
   Datenbank bleibt unsichtbar.

### 2. Einstellungen der Integration (Administrator)

Im Tab **Konfiguration**:

| Einstellung                    | Standard | Zweck                                              |
| ------------------------------ | -------- | -------------------------------------------------- |
| Synchronisierungsintervall     | 15 min   | Wie oft Notion gelesen wird (mindestens 5 Minuten) |
| Aufbewahrte vergangene Tage    | 30       | Ältere Termine werden aus Gladys entfernt          |
| Im Voraus synchronisierte Tage | 90       | Zeithorizont der Ansicht, Erinnerungen und Widgets |

### 3. „Meine Kalender“ aktivieren (jeder Nutzer)

Kalender sind persönliche Daten: Jeder Gladys-Nutzer aktiviert die
Integration für sich selbst, mit seinem eigenen Notion-Secret, im Block
**Meine Kalender** der Integrationsseite.

- **Secret der Notion-Integration**: das in Schritt 1 kopierte Secret.
- **Datenbanken (optional)**: Links oder IDs der zu synchronisierenden
  Datenbanken, durch Kommas getrennt. Leer lassen, um alle mit der
  Integration geteilten Datenbanken zu synchronisieren.
- **Datumseigenschaft (optional)**: Name der zu verwendenden Eigenschaft,
  wenn eine Datenbank mehrere hat (z. B. `Fällig`). Leer: die erste
  Datumseigenschaft der Datenbank.

Die Schaltfläche **Notion-Konten testen** im Tab Konfiguration zeigt für
jeden Nutzer, wie viele datierte Datenbanken sein Secret lesen kann.

### 4. Die wichtigen Kalender teilen

Ein synchronisierter Kalender ist zunächst **privat**: Nur sein Besitzer sieht
ihn. Teilen Sie ihn mit dem Haushalt (Schalter **Geteilt**), um ihn auf den
Dashboards, in den Szenen und für die anderen Mitglieder anzuzeigen. Der
Schalter **Synchronisiert** pausiert einen Kalender, ohne ihn zu löschen.

## Szenen

### Auslöser

| Auslöser                                   | Wann                                                                        | Variablen                                     |
| ------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------- |
| **Notion-Termin hinzugefügt**              | Eine datierte Seite erscheint in einem geteilten Notion-Kalender            | `calendar`, `name`, `start`, `all_day`, `url` |
| **Notion-Synchronisierung fehlgeschlagen** | Ein Konto synchronisiert nicht mehr (widerrufenes Token, nicht geteilte DB) | `user`, `error`                               |

Der Auslöser „Notion-Termin hinzugefügt“ kann nach dem **Kalendernamen** (dem
Namen der Notion-Datenbank) gefiltert werden. Er wird weder bei der allerersten
Synchronisierung eines Kontos ausgelöst noch für die Termine, die von der
unten stehenden Szenen-Aktion erstellt werden.

Der eingebaute Gladys-Auslöser **Ein Termin steht bevor** funktioniert auch
mit den geteilten Notion-Kalendern.

### Aktionen

| Aktion                              | Felder                            | Ausgaben                                                     |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| **Notion-Kalender synchronisieren** | —                                 | `calendars`, `events`, `success`                             |
| **Notion-Termin hinzufügen**        | Kalender, Name, Beginn, Ende, Ort | `created`, `url`                                             |
| **Nächsten Notion-Termin abrufen**  | Kalender (leer: alle)             | `found`, `name`, `start`, `minutes_until`, `calendar`, `url` |

- **Beginn / Ende**: ein Datum (`2026-10-12`) für einen ganztägigen Termin
  oder ein Datum mit Uhrzeit und Zeitzonenversatz
  (`2026-10-12T09:00:00+02:00`). Szenenvariablen werden akzeptiert.
- Die Aktionen sehen nur die **geteilten** Kalender.

Beispiel: jeden Morgen um 7 Uhr „Nächsten Notion-Termin abrufen“, dann, wenn
`found` wahr ist, den Assistenten `{{name}}` ansagen lassen.

## Widgets

| Widget               | Inhalt                                                                         |
| -------------------- | ------------------------------------------------------------------------------ |
| **Notion-Agenda**    | Die nächsten Termine (1 bis 8), nach Kalender filterbar, mit ihrem Notion-Link |
| **Notion-Übersicht** | Termine in 24 h und 7 Tagen, Zeit bis zum nächsten, Synchronisierungsstatus    |

Beide Widgets bieten eine Schaltfläche **Synchronisieren** und zeigen nur die
geteilten Kalender (ein Dashboard kann auf einem öffentlichen Bildschirm
hängen).

## Fehlerbehebung

- **„Notion hat das Token abgelehnt“**: Das Secret wurde neu erzeugt oder die
  Integration gelöscht. Fügen Sie das neue Secret unter Meine Kalender ein.
- **„Eine Datenbank ist nicht geteilt“**: Eine unter „Datenbanken“
  aufgeführte Datenbank ist nicht mit der Integration verbunden (••• →
  Verbindungen), oder der Link ist falsch.
- **Eine Datenbank erscheint nicht**: Sie hat keine Datumseigenschaft oder ist
  nicht mit der Integration geteilt.
- **Ein Termin, der länger als 90 Tage ist und in den Zeitraum hineinragt**,
  wird nicht synchronisiert: Es werden nur Seiten gelesen, die höchstens 90
  Tage vor dem Zeitraum beginnen.
- Die Logs der Integration (Tab Überwachung) beschreiben jede
  Synchronisierung; das Notion-Secret erscheint dort nie.

## Datenschutz

Das Notion-Secret jedes Nutzers wird von Gladys gespeichert, in der
Oberfläche nie wieder angezeigt und nur an `api.notion.com` gesendet. Die
Integration liest nur die Datenbanken, die Sie ausdrücklich mit Ihrer
Notion-Integration geteilt haben.
