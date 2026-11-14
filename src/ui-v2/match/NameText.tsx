import { Fragment, type ReactNode } from "react";

/**
 * Handles and club names are not words of the UI language. With the page in Turkish, CSS
 * `text-transform: uppercase` turns every "i" of a name into "İ" ("GUMAYUSİ"), because the casing
 * rules follow the `lang` of the element. A name carries the neutral language `und`, so it
 * uppercases like any other name, while the Turkish words around it keep Turkish casing. Every name
 * a screen of the match shows in capitals goes through this file.
 */
export const NAME_LANG = "und";

/** A name by itself, inside text that is in the language of the screen. */
export function Name({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span lang={NAME_LANG} className={className}>
      {children}
    </span>
  );
}

/** Stands for the name in a translated sentence: pass it as the interpolation value, then `NameIn`. */
export const NAME_SLOT = "";

/**
 * A translated sentence with one name in it: the sentence keeps the language of the screen and the
 * name gets `NAME_LANG`. Translate with `{ team: NAME_SLOT }` (or the key's own parameter) and give
 * the result and the name. A sentence that lost the slot in translation is shown whole.
 */
export function NameIn({ text, name }: { text: string; name: string }) {
  const parts = text.split(NAME_SLOT);
  if (parts.length < 2) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) => (
        // The slots of one sentence never change place between renders, so the index is a stable key.
        <Fragment key={index}>
          {index > 0 ? <Name>{name}</Name> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}
