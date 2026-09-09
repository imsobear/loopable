/**
 * Loopable's mark: something going round, and the thing it goes round for.
 *
 * A ring and an arrowhead on their own is the icon every application uses for
 * "refresh", so the dot is what stops this being that: it reads as a loop
 * with work at the centre of it rather than as a button that reloads. Three
 * shapes and no more, because the smallest place it appears is a 16px browser
 * tab, and a fourth turns the whole thing to porridge.
 *
 * The ring is cut square rather than rounded and the head overlaps where it
 * stops, so the two meet as one shape. A round cap there pokes out past the
 * head and puts a notch in the joint, which is invisible in a tab and obvious
 * at the size a dock icon is.
 *
 * Kept in step with public/favicon.svg by hand. The copy buys an icon the
 * browser can fetch without running the app, which is the point of a favicon.
 */
export function LoopableMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M17.14 5.87A8 8 0 1 1 12 4" stroke="currentColor" strokeWidth="2.6" />
      <path d="M15.4 4 10.8 5.9 10.8 2.1Z" fill="currentColor" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}
