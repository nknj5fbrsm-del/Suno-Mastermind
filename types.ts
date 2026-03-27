
export enum WorkflowStep {
  DASHBOARD = 'DASHBOARD',
  CONCEPT = 'CONCEPT',
  LYRICS = 'LYRICS',
  STYLE = 'STYLE',
  ARTWORK = 'ARTWORK'
}

export type ThemeName = 'mastermind' | 'sunset' | 'forest';

export interface SongConcept {
  topic: string;
  genre: string[];
  mood: string[];
  tempo: string[];
  language: string[];
  isInstrumental: boolean;
  vocals: string[];
  /** Optionale, separate Sprache für Lyrics-Variante 2 (Fallback: language). */
  languageVariant2?: string[];
  /** Optionaler, separater Gesangsstil für Lyrics-Variante 2 (Fallback: vocals). */
  vocalsVariant2?: string[];
  instrumentation?: string[];
  excludedStyles: string[];
}

export interface GeneratedStyle {
  prompt: string;
  promptEffect: string;
  similarArtists: string;
  weirdness: number;
  styleInfluence: number;
  /** Dynamische Mood-Achse für den Style-Regler (z. B. "Melodisch" ↔ "Experimentell"). */
  moodLeftLabel?: string;
  moodRightLabel?: string;
  /** Kurze EN-Instruktionen für linkes/rechtes Extrem (wird intern zur Prompt-Modulation genutzt). */
  moodLeftInstruction?: string;
  moodRightInstruction?: string;
  /** Neutrale Reglerposition; Default 50. */
  moodNeutralValue?: number;
  /** Kurze Begründung, warum die KI diese Weirdness- und Influence-Werte empfiehlt. */
  recommendationReason?: string;
  songDescription: string;
}

export interface SongHistoryItem {
  id: string;
  timestamp: number;
  /** Favorit-Markierung für schnelle Archivfilter/-bereinigung. */
  isFavorite?: boolean;
  concept: SongConcept;
  lyrics: string;
  /** Zweite Lyrics-Variante (Create-Flow); wenn gesetzt, werden beide im Lyrics- und Cover-Tab angezeigt. */
  lyricsVariant2?: string;
  styleData: GeneratedStyle;
  /** Zweite Style-Variante (passend zu Lyrics 2); wenn gesetzt, werden beide auf der Style- und Cover-Seite genutzt. */
  styleVariant2?: GeneratedStyle;
  coverUrl: string;
}
