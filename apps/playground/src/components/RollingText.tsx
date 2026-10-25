/** Text that rolls in character by character whenever it changes (Rhine-style
 * rolling titles). Only the first `max` characters animate; reduced motion
 * shows the text at once (CSS). */
export function RollingText({ text, max = 32 }: { text: string; max?: number }) {
  const characters = [...text];
  return <span className="rolling-text" key={text} aria-label={text}>
    {characters.slice(0, max).map((character, index) => <span key={index} aria-hidden="true" style={{ animationDelay: `${index * 14}ms` }}>{character}</span>)}
    {characters.length > max && <span aria-hidden="true" className="rolling-rest">{characters.slice(max).join("")}</span>}
  </span>;
}
