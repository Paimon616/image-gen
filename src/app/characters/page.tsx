import { AppSidebar } from "@/components/app-sidebar";
import { CharacterStudio } from "@/components/character-studio";
import { ImageViewer } from "@/components/image-viewer";

export default function CharactersPage() {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <CharacterStudio />
      {/* Renders when a situation thumbnail sets selectedImage in the store. */}
      <ImageViewer />
    </div>
  );
}
