import { AppSidebar } from "@/components/app-sidebar";
import { CharacterDatasetBootstrap } from "@/components/character-dataset-bootstrap";

export default function DatasetBootstrapPage() {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <CharacterDatasetBootstrap />
    </div>
  );
}
