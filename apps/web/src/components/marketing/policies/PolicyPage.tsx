import Link from "next/link";

import Logo from "@/components/layout/Logo";
import {
  policyLinks,
  SUPPORT_EMAIL,
} from "@/components/marketing/policies/policy-links";

const LAST_UPDATED = "July 21, 2026";

type PolicyPageProps = {
  children: React.ReactNode;
  description: string;
  lastUpdated?: string;
  title: string;
};

export function PolicyPage({
  children,
  description,
  lastUpdated = LAST_UPDATED,
  title,
}: PolicyPageProps) {
  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between border-b border-border pb-6">
          <Link aria-label="MultiFeed home" href="/">
            <Logo />
          </Link>
          <Link
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            href="/"
          >
            Back to home
          </Link>
        </header>

        <article className="py-12 sm:py-16">
          <p className="text-sm font-medium text-primary">
            Effective and last updated {lastUpdated}
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            {description}
          </p>
          <div className="mt-10 space-y-8 text-base leading-7 text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ol]:space-y-2 [&_ol_li]:list-decimal [&_p+p]:mt-3 [&_ul]:space-y-2">
            {children}
          </div>
        </article>

        <footer className="border-t border-border py-8">
          <nav aria-label="Legal policies">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {policyLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    className="text-muted-foreground transition-colors hover:text-primary"
                    href={link.href}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Questions? Email{" "}
            <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}
