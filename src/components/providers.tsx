"use client";

import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
      <Toaster
        theme="dark"
        position="top-center"
        richColors
        closeButton
        toastOptions={{ className: "toast" }}
      />
    </MotionConfig>
  );
}
