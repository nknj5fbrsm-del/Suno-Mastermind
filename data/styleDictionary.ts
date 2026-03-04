/** Eintrag: Begriff + kurze Erklärung (für Suno/Style-Prompt). */
export interface StyleDictTerm {
  name: string;
  /** Erklärung, was der Begriff bewirkt (DE/EN je nach Sprachkontext). */
  description: string;
}

export interface StyleDictGroup {
  id: string;
  labelDe: string;
  labelEn: string;
  terms: StyleDictTerm[];
}

export const STYLE_DICTIONARY: StyleDictGroup[] = [
  {
    id: 'articulation',
    labelDe: 'Artikulation',
    labelEn: 'Articulation',
    terms: [
      { name: 'Marcato', description: 'Kurz, betont, markanter Anschlag; jeder Ton hervorgehoben.' },
      { name: 'Staccatissimo', description: 'Sehr kurze, abgehackte Töne; extrem getrennt.' },
      { name: 'Cuivré', description: 'Metallisch-durchdringender Bläserton; „gepresst“, scharf.' },
      { name: 'Glissando', description: 'Gleitender Übergang von einer Tonhöhe zur nächsten.' },
      { name: 'Tongued', description: 'Mit Zungenstoß artikuliert (Bläser); klar getrennte Töne.' },
      { name: 'Legato', description: 'Gebunden, weiche Übergänge zwischen Tönen.' },
      { name: 'Staccato', description: 'Kurz und getrennt gespielt.' },
      { name: 'Pizzicato', description: 'Geigen/Streicher gezupft statt gestrichen.' },
      { name: 'Spiccato', description: 'Springender Bogen; kurze, leichte Striche.' },
      { name: 'Portato', description: 'Leicht getrennt, aber weich verbunden; halb Legato.' },
      { name: 'Tenuto', description: 'Töne voll ausgehalten, betont.' },
      { name: 'Sforzando', description: 'Plötzlicher starker Akzent auf einem Ton.' },
      { name: 'Martellato', description: 'Hammerartig, stark akzentuiert.' },
      { name: 'Col legno', description: 'Mit dem Holz des Bogens gestrichen; perkussiv.' },
      { name: 'Tremolo', description: 'Schnelle Wiederholung eines Tons; zitternd.' },
      { name: 'Vibrato', description: 'Leichte Tonhöhenschwankung; warm, lebendig.' },
    ],
  },
  {
    id: 'dynamics',
    labelDe: 'Dynamik',
    labelEn: 'Dynamics',
    terms: [
      { name: 'Crescendo Molto', description: 'Starker Anstieg der Lautstärke über eine Phrase.' },
      { name: 'Sforzando', description: 'Plötzlicher, kräftiger Akzent auf einem Ton oder Akkord.' },
      { name: 'Sotto Voce', description: 'Sehr leise, „unter der Stimme“; intim, zurückgenommen.' },
      { name: 'Wall of Sound', description: 'Dichte, mehrschichtige Produktion; viele Spuren, voller Klangteppich.' },
      { name: 'Textural Layering', description: 'Viele übereinanderliegende Klangschichten; atmosphärisch dicht.' },
      { name: 'Subito Piano', description: 'Plötzlich leise nach lauterem Abschnitt.' },
      { name: 'Fortissimo', description: 'Sehr laut.' },
      { name: 'Pianissimo', description: 'Sehr leise.' },
      { name: 'Mezzo Forte', description: 'Mittlere Lautstärke.' },
      { name: 'Mezzo Piano', description: 'Mäßig leise.' },
      { name: 'Decrescendo', description: 'Allmählich leiser werdend.' },
      { name: 'Diminuendo', description: 'Nach und nach leiser.' },
      { name: 'Rinforzando', description: 'Kurzer Verstärkungsschub auf wenigen Tönen.' },
      { name: 'Morendo', description: 'Ersterbend; bis zum Verklingen leiser werdend.' },
    ],
  },
  {
    id: 'harmony',
    labelDe: 'Harmonik',
    labelEn: 'Harmony',
    terms: [
      { name: 'Dissonant Clusters', description: 'Zusammenballungen dissonanter Töne; spannungsvoll, modern.' },
      { name: 'Bitonal', description: 'Zwei Tonarten gleichzeitig; reibungsvoll, mehrdeutig.' },
      { name: 'Phrygian Mode', description: 'Modaler Klang mit kleiner Sekunde; spanisch/mystisch.' },
      { name: 'Atonal Progression', description: 'Keine feste Tonart; freie, oft schroffe Harmonik.' },
      { name: 'Minor 9th', description: 'Akkord mit kleiner None; jazzig, weich-spannend.' },
      { name: 'Suspended Chords', description: 'Sus2/Sus4; schwebend, auflösungsbedürftig.' },
      { name: 'Diminished 7th', description: 'Verdünnter Septakkord; dramatisch, instabil.' },
      { name: 'Modal Interchange', description: 'Akkorde aus paralleler Dur/Moll-Tonart; Farbwechsel.' },
      { name: 'Major 7th', description: 'Dur-Septakkord; warm, offen.' },
      { name: 'Dominant 7th', description: 'Dominantsept; treibend, auflösungsbedürftig.' },
      { name: 'Add9', description: 'Akkord mit hinzugefügter None; luftig, modern.' },
      { name: 'Lydian', description: 'Modus mit erhöhter Quarte; schwebend, hell.' },
      { name: 'Dorian', description: 'Moll-Modus mit großer Sexte; jazzig, weich.' },
      { name: 'Mixolydian', description: 'Dur mit kleiner Septime; rockig, offen.' },
      { name: 'Neapolitan', description: 'Erniedrigte II. Stufe; dramatisch, dunkel.' },
    ],
  },
  {
    id: 'rhythm',
    labelDe: 'Rhythmus & Feel',
    labelEn: 'Rhythm & Feel',
    terms: [
      { name: 'Syncopated', description: 'Betonungen auf unbetonten Zählzeiten; groove-lastig.' },
      { name: 'Ghost Notes', description: 'Sehr leise, andeutungsweise Schläge (z. B. Snare).' },
      { name: 'Half-time Feel', description: 'Tempo wirkt halbiert; breit, schwer.' },
      { name: 'Swing', description: 'Ungeradzahliges Timing; jazzig, locker.' },
      { name: 'Straight 8ths', description: 'Gleichmäßige Achtel; kein Swing.' },
      { name: 'Shuffle', description: 'Triolisch betontes Achtel-Feel; Blues/Rock.' },
      { name: 'Double-time', description: 'Doppelt so schnelles Gefühl; treibend.' },
      { name: 'Rubato', description: 'Freies Dehnen des Tempos; expressiv.' },
      { name: 'Backbeat', description: 'Betonung auf 2 und 4; typisch Pop/Rock.' },
      { name: 'Polyrhythm', description: 'Mehrere rhythmische Ebenen gleichzeitig; komplex.' },
      { name: 'Triplet Feel', description: 'Triolische Unterteilung; fließend.' },
      { name: 'Straight 16ths', description: 'Gleichmäßige Sechzehntel; elektronisch/präzise.' },
    ],
  },
  {
    id: 'production',
    labelDe: 'Produktion & Raum',
    labelEn: 'Production & Space',
    terms: [
      { name: 'Close-miked', description: 'Nah abgenommen; trocken, präsent, wenig Raum.' },
      { name: 'Plate Reverb', description: 'Klassischer Platten-Hall; warm, dicht.' },
      { name: 'Room Mic', description: 'Raumklang mit einbezogen; natürlich, live.' },
      { name: 'Tape Saturation', description: 'Leichte Verzerrung/Wärme wie bei Bandaufnahme.' },
      { name: 'Sidechain Compression', description: 'Pumpender Effekt, z. B. Kick duckt andere Spuren.' },
      { name: 'Hall Reverb', description: 'Großer Hall; weit, atmosphärisch.' },
      { name: 'Delay', description: 'Echo; Räumlichkeit, Wiederholung.' },
      { name: 'Chorus', description: 'Leichte Verdopplung/Modulation; breiter Klang.' },
      { name: 'Dry', description: 'Ohne nennenswerten Hall; direkt, klar.' },
      { name: 'Ambient', description: 'Viel Raum, weite Atmosphäre.' },
      { name: 'Lo-fi', description: 'Bewusst unrein; warm, vintage, gedämpft.' },
      { name: 'Stereo Widening', description: 'Breitere Stereobreite; räumlich.' },
    ],
  },
];
