import { display } from './fonts';

/** Layout for the public pages: puts the headline font's CSS variable on the page. Kept out of the page modules so they stay importable without next/font. */
export default function FontLayout({ children }: { children: React.ReactNode }) {
  return <div className={display.variable}>{children}</div>;
}
