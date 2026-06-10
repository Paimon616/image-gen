import { AppSidebar } from "@/components/app-sidebar";
import { ModelManagement } from "@/components/model-management";

export default function ModelsPage() {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <ModelManagement />
    </div>
  );
}
