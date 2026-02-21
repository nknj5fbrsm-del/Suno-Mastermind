
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
  instrumentation?: string[];
  excludedStyles: string[];
}

export interface GeneratedStyle {
  prompt: string;
  promptEffect: string;
  similarArtists: string;
  weirdness: number;
  styleInfluence: number;
  /** Kurze Begründung, warum die KI diese Weirdness- und Influence-Werte empfiehlt. */
  recommendationReason?: string;
  songDescription: string;
}

export interface SongHistoryItem {
  id: string;
  timestamp: number;
  concept: SongConcept;
  lyrics: string;
  /** Zweite Lyrics-Variante (Create-Flow); wenn gesetzt, werden beide im Lyrics- und Cover-Tab angezeigt. */
  lyricsVariant2?: string;
  styleData: GeneratedStyle;
  /** Zweite Style-Variante (passend zu Lyrics 2); wenn gesetzt, werden beide auf der Style- und Cover-Seite genutzt. */
  styleVariant2?: GeneratedStyle;
  coverUrl: string;
}
