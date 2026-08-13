import { AppSidebar } from "@/components/app-sidebar";
import { DownloadManager } from "@/components/download-manager";

export default function DownloadsPage() {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <DownloadManager />
    </div>
  );
}
