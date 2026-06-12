import { AppSidebar } from "@/components/app-sidebar";
import { ScrapList } from "@/components/scrap-list";

export default function ScrapPage() {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">스크랩</h1>
          <p className="text-xs text-muted-foreground">
            Imported Civitai images, matched generation settings, and resources.
          </p>
        </header>
        <ScrapList />
      </main>
    </div>
  );
}
