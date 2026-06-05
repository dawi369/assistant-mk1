import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

/**
 * Sign-in endpoint for WorkOS AuthKit.
 * Configure this URL in the WorkOS dashboard under Redirects > Sign-in endpoint.
 * Required for features like impersonation to work correctly.
 */
export const GET = async () => {
  const signInUrl = await getSignInUrl();
  return redirect(signInUrl);
};
