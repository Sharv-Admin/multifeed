import { SmoothScroll } from "@/components/SmoothScroll";
import { AnalyticsConsent } from "@/components/marketing/AnalyticsConsent";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SmoothScroll>
      <div className="flex min-h-screen w-full flex-col bg-background selection:bg-primary selection:text-primary-foreground">
        {children}
        <AnalyticsConsent />
      </div>
    </SmoothScroll>
  );
}
