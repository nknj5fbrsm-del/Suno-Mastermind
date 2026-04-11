import React, { useRef, useLayoutEffect, useCallback } from 'react';
import Editor from 'react-simple-code-editor';

export interface LyricsCodeEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  highlight: (code: string) => string;
  padding?: number;
  textareaId?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * react-simple-code-editor legt die Textarea mit position:absolute; height:100% — bezogen auf den
 * Scroll-Viewport, nicht auf die volle Höhe des <pre>. Unten war die Fläche „tot“.
 * Mit Grid/relative wurde die Pixel-Überlagerung mit dem <pre> zerstört (Text 1–2 Zeilen versetzt).
 * Lösung: Library-Layout beibehalten und die Textarea-Höhe per Messung an offsetHeight des <pre> anpassen.
 */
const LyricsCodeEditor: React.FC<LyricsCodeEditorProps> = ({
  value,
  onValueChange,
  highlight,
  padding = 16,
  textareaId,
  className = '',
  disabled = false,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  const syncTextareaToPre = useCallback(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const wrap = mount.querySelector('.lyrics-code-wrapper');
    if (!wrap) return;
    const pre = wrap.querySelector('pre');
    const ta = wrap.querySelector('textarea');
    if (!pre || !ta) return;
    const h = pre.offsetHeight;
    const t = ta as HTMLTextAreaElement;
    t.style.height = `${h}px`;
    t.style.minHeight = `${h}px`;
  }, []);

  useLayoutEffect(() => {
    let alive = true;
    const run = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (alive) syncTextareaToPre();
        });
      });
    };
    run();
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (alive) syncTextareaToPre();
      });
    }

    const mount = mountRef.current;
    if (!mount) {
      return () => {
        alive = false;
      };
    }
    const wrap = mount.querySelector('.lyrics-code-wrapper');
    const pre = wrap?.querySelector('pre');
    if (!pre) {
      return () => {
        alive = false;
      };
    }

    const ro = new ResizeObserver(() => run());
    ro.observe(pre);

    window.addEventListener('resize', run);
    const onOrientation = () => {
      window.setTimeout(run, 350);
    };
    window.addEventListener('orientationchange', onOrientation);

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      vv.addEventListener('resize', run);
      vv.addEventListener('scroll', run);
    }

    return () => {
      alive = false;
      ro.disconnect();
      window.removeEventListener('resize', run);
      window.removeEventListener('orientationchange', onOrientation);
      if (vv) {
        vv.removeEventListener('resize', run);
        vv.removeEventListener('scroll', run);
      }
    };
  }, [value, syncTextareaToPre]);

  return (
    <div ref={mountRef} className="h-full min-h-0 w-full">
      <Editor
        value={value}
        onValueChange={onValueChange}
        highlight={highlight}
        padding={padding}
        style={{ height: '100%', overflow: 'auto' }}
        textareaId={textareaId}
        textareaClassName="lyrics-code-textarea"
        preClassName="lyrics-code-pre"
        className={`lyrics-code-wrapper ${disabled ? 'opacity-70 pointer-events-none' : ''} ${className}`.trim()}
      />
    </div>
  );
};

export default LyricsCodeEditor;
