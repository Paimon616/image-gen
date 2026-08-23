"use client";

import { useState } from "react";
import { Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageLibraryPicker } from "@/components/image-library-picker";
import { toAbsoluteImageUrl } from "@/lib/video-reference";

interface VideoReferenceImportProps {
  language: "ko" | "en";
  onSelect: (url: string) => void;
}

/**
 * Lets the video screen pull a start/reference image straight from the images
 * produced on the Image Generation screen. Opens the shared image library
 * picker and hands the chosen image's URL back to the caller.
 */
export function VideoReferenceImport({
  language,
  onSelect,
}: VideoReferenceImportProps) {
  const ko = language === "ko";
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        title={
          ko
            ? "이미지 생성 화면에서 만든 이미지를 레퍼런스로 가져옵니다"
            : "Import an image made on the Image Generation screen"
        }
      >
        <Images className="h-4 w-4" />
        {ko ? "이미지 생성에서 가져오기" : "Import from Image Generation"}
      </Button>

      {open && (
        <ImageLibraryPicker
          title={ko ? "이미지 생성에서 가져오기" : "Import from Image Generation"}
          onClose={() => setOpen(false)}
          onPick={(image) => {
            onSelect(toAbsoluteImageUrl(image.url));
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
