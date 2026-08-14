import { AppSidebar } from "@/components/app-sidebar";
import { CharacterStudio } from "@/components/character-studio";

export default function CharactersPage() {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <CharacterStudio />
    </div>
  );
}
