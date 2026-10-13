import { Footer, Nav } from "./landing";

export const CONTACT = "https://github.com/imsobear/loopable/issues";
export const UPDATED = "October 12, 2026";

/** A page of plain text in the front page's frame: privacy, terms. */
export function LegalPage({
  signedIn,
  title,
  children,
}: {
  signedIn: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav signedIn={signedIn} />
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>
        <div className="mt-10 flex flex-col gap-8 text-sm leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_li]:mt-1.5 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline [&_a]:underline-offset-4">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
