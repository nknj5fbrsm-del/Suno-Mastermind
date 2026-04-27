import React, { createContext, useContext } from 'react';
import { t, Lang } from '../translations';

export const LangContext = createContext<{ lang: Lang; tr: typeof t.de }>({ lang: 'de', tr: t.de });
export const useLang = () => useContext(LangContext);

export const LangProvider: React.FC<{
  value: { lang: Lang; tr: typeof t.de };
  children: React.ReactNode;
}> = ({ value, children }) => (
  <LangContext.Provider value={value}>{children}</LangContext.Provider>
);

