import { Navigate, useSearchParams } from "react-router-dom";
import { SignIn, useUser } from "@clerk/react";
import { useTheme } from "next-themes";
import logo from "@/assets/logo.png";
import { safeNext } from "@/lib/redirect";

const clerkVariables = {
  light: {
    colorPrimary: "#004392",
    colorBackground: "#FFFFFF",
    colorText: "#0E1622",
    colorTextSecondary: "#4E5D6C",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#0E1622",
    colorNeutral: "#0E1622",
    colorTextOnPrimaryBackground: "#FFFFFF",
    colorDanger: "#C8452F",
    borderRadius: "0.625rem",
    fontFamily: "'Hanken Grotesk', sans-serif",
  },
  dark: {
    colorPrimary: "#2E6DBE",
    colorBackground: "#04264C",
    colorText: "#EAF1F9",
    colorTextSecondary: "#9DB4CE",
    colorInputBackground: "#04264C",
    colorInputText: "#EAF1F9",
    colorNeutral: "#EAF1F9",
    colorTextOnPrimaryBackground: "#FFFFFF",
    colorDanger: "#C8452F",
    borderRadius: "0.625rem",
    fontFamily: "'Hanken Grotesk', sans-serif",
  },
} as const;

function SignInCard({ next }: { next: string }) {
  const { resolvedTheme } = useTheme();
  const variables =
    resolvedTheme === "dark" ? clerkVariables.dark : clerkVariables.light;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-6">
        <img
          src={logo}
          alt="Deceivers Robotics Team 4392"
          className="h-14 w-auto"
        />
      </div>

      <SignIn
        routing="hash"
        forceRedirectUrl={next}
        appearance={{
          variables,
          elements: {
            rootBox: "w-full max-w-sm",
            cardBox: "w-full shadow-none",
            card: "border border-border bg-card text-card-foreground shadow-sm",
            headerTitle:
              "font-heading text-2xl font-bold italic uppercase tracking-normal",
            headerSubtitle: "text-muted-foreground",
            formButtonPrimary:
              "bg-primary !text-primary-foreground shadow-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            footerActionLink: "text-primary hover:text-primary/90",
          },
        }}
      />
    </div>
  );
}

export function LoginPage() {
  const { isLoaded, isSignedIn } = useUser();
  // Where they were headed before being sent here — if it's somewhere in
  // this app. See lib/redirect.ts for why that check matters.
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));

  if (!isLoaded) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isSignedIn) return <Navigate to={next} replace />;

  return <SignInCard next={next} />;
}
