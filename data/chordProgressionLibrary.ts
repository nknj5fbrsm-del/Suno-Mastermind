/** Eintrag: einfügbare Akkordfolge + kurze Stil-Einordnung (wie Style-Wörterbuch). */
export interface ChordDictTerm {
  name: string;
  description: string;
}

export interface ChordDictGroup {
  id: string;
  labelDe: string;
  labelEn: string;
  terms: ChordDictTerm[];
}

export const CHORD_PROGRESSION_DICTIONARY: ChordDictGroup[] = [
  {
    id: 'pop',
    labelDe: 'Pop & Singer-Songwriter',
    labelEn: 'Pop & singer-songwriter',
    terms: [
      { name: 'C G Am F', description: 'Klassische Pop-Kadenz („vier Akkorde“); breit einsetzbar, eingängig.' },
      { name: 'I V vi IV', description: 'Romanische Notation derselben Kadenz; universeller Pop/ Rock.' },
      { name: 'Am F C G', description: 'Häufige Variante in Moll/relativ Moll; emotional, radiotauglich.' },
      { name: 'D A Bm G', description: 'Dur-lastig, offen; oft in moderner Pop-Rock Ballade.' },
      { name: 'Em C G D', description: 'Wechsel zwischen Moll und Dur; introspektiv bis anthemisch.' },
    ],
  },
  {
    id: 'rock',
    labelDe: 'Rock & Alternative',
    labelEn: 'Rock & alternative',
    terms: [
      { name: 'E A D A', description: 'Einfache Rock-Folge; offenes, direktes Feeling.' },
      { name: 'Am G Dsus4 D', description: 'Spannung über sus4; typisch für emotionalen Rock.' },
      { name: 'Bm G D A', description: 'Moderner Rock/Pop-Rock; treibend, klarer Refrain-Ansatz.' },
      { name: 'F#m D A E', description: 'Häufig in anthemischen Rock-Stücken; große Bogenmelodie.' },
    ],
  },
  {
    id: 'jazz',
    labelDe: 'Jazz & Standards',
    labelEn: 'Jazz & standards',
    terms: [
      { name: 'ii V I', description: 'Kern der Jazz-Harmonik; Auflösung in die Tonika.' },
      { name: 'Dm7 G7 Cmaj7', description: 'ii7–V7–Imaj7 in C; swing, Ballade, Bebop.' },
      { name: 'Rhythm changes (B♭)', description: 'I vi ii V / Turnaround; Standard-Form, schnelle Harmonie.' },
      { name: 'Autumn Leaves (Kurz)', description: 'iiø V i in Moll + relative Dur; Standard-Klang.' },
    ],
  },
  {
    id: 'blues',
    labelDe: 'Blues & Soul',
    labelEn: 'Blues & soul',
    terms: [
      { name: 'I I I I', description: '12-Bar Blues: vier Takte Grundton (z. B. A Blues).' },
      { name: 'I IV I I · IV IV I I · V IV I I', description: '12-Bar-Schema (vereinfacht notiert); Grundlage Blues/Rock.' },
      { name: 'Am7 D7 Fmaj7 E7', description: 'Soul/Jazz-Soul Farben; weiche Dominanten.' },
    ],
  },
  {
    id: 'classical',
    labelDe: 'Klassik & Kadenz',
    labelEn: 'Classical & cadence',
    terms: [
      { name: 'I IV V I', description: 'Einfache authentische Kadenz; klar, „klassisch“.' },
      { name: 'I vi IV V', description: '50er/„Doo-Wop“-Kadenz; nostalgisch, eingängig.' },
      { name: 'vi IV I V', description: 'Pop-Ballade; sanfter Loop, emotional.' },
      { name: 'Pachelbel (D A Bm F#m G D G A)', description: 'Bekannte Bassfolge; barock inspiriert, filmisch nutzbar.' },
    ],
  },
  {
    id: 'modal',
    labelDe: 'Modal & modern',
    labelEn: 'Modal & modern',
    terms: [
      { name: 'Dm7 G7 Cmaj7 (Dorian colour)', description: 'Dorian über Moll; jazzig, modern.' },
      { name: 'Em9 A13 Dmaj7', description: 'Erweiterte Akkorde; ruhig-jazzige Atmosphäre.' },
      { name: 'Am(add9) Fmaj7 C G', description: 'Breite, luftige Klangfarbe; Indie/Cinematic.' },
    ],
  },
  {
    id: 'film',
    labelDe: 'Film & ambient',
    labelEn: 'Film & ambient',
    terms: [
      { name: 'i bVI bIII bVII', description: 'Epischer Moll-Loop; oft trailer-/filmnah.' },
      { name: 'Cm Ab Eb Bb', description: 'Weite, düstere bis hoffnungsvolle Moll-Dur Mischung.' },
      { name: 'Sus2 / Sus4 Wechsel', description: 'Schwebende Harmonik; Ambient, Soundtrack.' },
    ],
  },
];
