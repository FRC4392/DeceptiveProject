import { useAuth } from "@workos-inc/authkit-react";
import { useEffect } from "react";

// Registered as the WorkOS "sign-in endpoint" in the dashboard so that
// flows started outside this app (e.g. dashboard impersonation, another
// app's sign-in link) land here and kick off the OAuth redirect.
export function LoginRoute() {
  const { signIn } = useAuth();

  useEffect(() => {
    void signIn();
  }, [signIn]);

  return (
    <div className="flex h-screen items-center justify-center">
      Redirecting to sign in…
    </div>
  );
}
