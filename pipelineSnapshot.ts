import type { GeneratedStyle, SongConcept } from './types';

/** Stabiler Schlüssel für Lyrics (+ optional zwei Varianten). */
export function lyricsBundleKey(lyrics: string, lyricsVariants: [string, string] | null): string {
  return JSON.stringify({
    lyrics,
    v0: lyricsVariants?.[0] ?? null,
    v1: lyricsVariants?.[1] ?? null,
  });
}

export function conceptJson(c: SongConcept): string {
  return JSON.stringify(c);
}

export type StyleGenSnapshot = {
  conceptJson: string;
  lyricsKey: string;
};

export type CoverGenSnapshot = {
  lyricsKey: string;
  stylePrompt0: string;
  stylePrompt1: string | null;
  conceptJson: string;
};

export function buildStyleGenSnapshot(
  concept: SongConcept,
  lyrics: string,
  lyricsVariants: [string, string] | null
): StyleGenSnapshot {
  return {
    conceptJson: conceptJson(concept),
    lyricsKey: lyricsBundleKey(lyrics, lyricsVariants),
  };
}

export function buildCoverGenSnapshot(
  concept: SongConcept,
  lyrics: string,
  lyricsVariants: [string, string] | null,
  styleData: GeneratedStyle,
  styleVariants: [GeneratedStyle, GeneratedStyle] | null
): CoverGenSnapshot {
  return {
    lyricsKey: lyricsBundleKey(lyrics, lyricsVariants),
    stylePrompt0: styleData.prompt,
    stylePrompt1: styleVariants?.[1]?.prompt ?? null,
    conceptJson: conceptJson(concept),
  };
}

export function computeNeedsStyleRegen(
  concept: SongConcept,
  lyrics: string,
  lyricsVariants: [string, string] | null,
  snap: StyleGenSnapshot | null
): boolean {
  if (!snap) return true;
  const next = buildStyleGenSnapshot(concept, lyrics, lyricsVariants);
  return snap.conceptJson !== next.conceptJson || snap.lyricsKey !== next.lyricsKey;
}

/**
 * Cover ist „veraltet“, wenn Konzept/Lyrics/Style sich gegenüber dem letzten Cover-Stand geändert haben
 * oder (Zwei-Varianten-Flow) noch kein Cover existiert.
 */
export function computeNeedsCoverRegen(
  concept: SongConcept,
  lyrics: string,
  lyricsVariants: [string, string] | null,
  styleData: GeneratedStyle | null,
  styleVariants: [GeneratedStyle, GeneratedStyle] | null,
  coverUrl: string,
  styleSnap: StyleGenSnapshot | null,
  coverSnap: CoverGenSnapshot | null
): boolean {
  if (computeNeedsStyleRegen(concept, lyrics, lyricsVariants, styleSnap)) return true;
  if (!styleData) return true;
  if (lyricsVariants && lyricsVariants.length >= 2 && !coverUrl.trim()) return true;
  if (!coverSnap) return true;
  const built = buildCoverGenSnapshot(concept, lyrics, lyricsVariants, styleData, styleVariants);
  return (
    coverSnap.lyricsKey !== built.lyricsKey ||
    coverSnap.stylePrompt0 !== built.stylePrompt0 ||
    (coverSnap.stylePrompt1 ?? null) !== (built.stylePrompt1 ?? null) ||
    coverSnap.conceptJson !== built.conceptJson
  );
}
