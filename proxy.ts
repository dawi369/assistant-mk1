// proxy.ts - WorkOS AuthKit proxy for Next.js 16+
import { authkitProxy } from "@workos-inc/authkit-nextjs";

export default authkitProxy();

// Match app and API routes so server routes using WorkOS `withAuth()` receive
// AuthKit session headers. Static assets stay excluded.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
