// proxy.ts - WorkOS AuthKit proxy for Next.js 16+
import { authkitProxy } from "@workos-inc/authkit-nextjs";

export default authkitProxy();

// Match against pages that require auth
// Excludes Next.js static assets and API routes
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
