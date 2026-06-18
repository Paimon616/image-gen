import { AppSidebar } from "@/components/app-sidebar";
import { LoraTraining } from "@/components/lora-training";

export default function LoraTrainingPage() {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <LoraTraining />
    </div>
  );
}
