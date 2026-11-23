/**
 * Class strings the menu panels share on the phone (`usePhoneForm()`), kept in one place so
 * each is spelled once. They are applied only in a phone branch, so the desktop markup never
 * carries them. `--target-min` is 48 px on the phone (`--hit`) and 24 px elsewhere.
 */

/** A tap target of at least 48 x 48. */
export const PHONE_TARGET = "min-h-[var(--target-min)] min-w-[var(--target-min)]";

/** An icon-only button (Close, Export, Delete): a 48 x 48 target with its icon centred. */
export const PHONE_ICON_BUTTON = `${PHONE_TARGET} inline-flex items-center justify-center`;
