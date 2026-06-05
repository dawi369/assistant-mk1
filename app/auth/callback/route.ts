import { handleAuth } from "@workos-inc/authkit-nextjs";

// Return to home page after successful authentication
export const GET = handleAuth({ returnPathname: "/" });
