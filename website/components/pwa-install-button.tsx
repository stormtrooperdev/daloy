"use client";

import * as React from "react";
import { DownloadSimpleIcon } from "@phosphor-icons/react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BeforeInstallPromptChoiceResult = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<BeforeInstallPromptChoiceResult>;
};

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

function isStandaloneApp() {
  const standaloneNavigator = window.navigator as StandaloneNavigator;

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    standaloneNavigator.standalone === true
  );
}

export function PwaInstallButton({
  className,
  onInstalled,
}: {
  className?: string;
  onInstalled?: () => void;
}) {
  const [installPrompt, setInstallPrompt] =
    React.useState<BeforeInstallPromptEvent | null>(null);

  React.useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      if (isStandaloneApp()) {
        return;
      }

      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setInstallPrompt(null);
      onInstalled?.();
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [onInstalled]);

  async function installApp() {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    if (choice.outcome === "accepted") {
      onInstalled?.();
    }

    setInstallPrompt(null);
  }

  if (!installPrompt) {
    return null;
  }

  return (
    <button
      type="button"
      aria-label="Install app"
      title="Install app"
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        className
      )}
      onClick={installApp}
    >
      <DownloadSimpleIcon className="size-4" />
      <span className="hidden lg:inline">Install App</span>
    </button>
  );
}
