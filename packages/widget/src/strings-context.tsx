/**
 * The merged strings, handed down without threading a prop through every
 * component. `useWidgetStrings` works outside a provider too, so the pure
 * pieces and the tests never have to build one.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { defaultStrings, mergeStrings, type WidgetStrings } from './strings.js';

const StringsContext = createContext<WidgetStrings>(defaultStrings);

export function useWidgetStrings(): WidgetStrings {
  return useContext(StringsContext);
}

export interface WidgetStringsProviderProps {
  strings?: Partial<WidgetStrings>;
  children: ReactNode;
}

export function WidgetStringsProvider({ strings, children }: WidgetStringsProviderProps) {
  const merged = useMemo(() => mergeStrings(strings), [strings]);
  // `.Provider` rather than the context itself: rendering `<Context>` directly
  // is React 19 only, and the peer range starts at 18.
  return <StringsContext.Provider value={merged}>{children}</StringsContext.Provider>;
}
