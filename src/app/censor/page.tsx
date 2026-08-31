import { AppSidebar } from "@/components/app-sidebar";
import { CensorEditor } from "@/components/censor-editor";

export default function CensorPage() {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Censor</h1>
          <p className="text-xs text-muted-foreground">
            Mosaic / blur / color-fill regions on images and videos
          </p>
        </div>
        <CensorEditor />
      </main>
    </div>
  );
}
