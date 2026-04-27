import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const path = nextUrl.pathname;

  const isAuthPage = path === "/login";
  const isChangePwPage = path === "/change-password";
  const isApi = path.startsWith("/api/");
  const isPublic = isAuthPage || path.startsWith("/_next") || path.startsWith("/brand") || path === "/favicon.ico";

  if (isApi) return NextResponse.next();
  if (isPublic) {
    if (isAuthPage && isLoggedIn) return NextResponse.redirect(new URL("/", nextUrl));
    return NextResponse.next();
  }

  if (!isLoggedIn) return NextResponse.redirect(new URL("/login", nextUrl));

  const u = req.auth?.user as { mustChangePassword?: boolean; role?: "admin" | "employee" } | undefined;
  if (u?.mustChangePassword && !isChangePwPage) {
    return NextResponse.redirect(new URL("/change-password", nextUrl));
  }
  if (path.startsWith("/admin") && u?.role !== "admin") {
    return NextResponse.redirect(new URL("/", nextUrl));
  }
  // Admin should never see personal-leave pages
  if (u?.role === "admin" && (path === "/leaves" || path.startsWith("/leaves/") || path === "/holidays" || path.startsWith("/holidays/"))) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand).*)"],
};
