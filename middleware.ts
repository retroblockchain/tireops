// TEMPORARY maintenance layer — branch: maintenance/support-404.
// Intercepts every request and returns a self-contained 404 support page.
// The application underneath is untouched. To restore the site, revert
// this commit (or redeploy the previous production deployment).
import { NextResponse } from "next/server";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>404 &mdash; Website Unavailable</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #f5f5f5; color: #222; text-align: center;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    padding: 24px; box-sizing: border-box;
  }
  h1 { font-size: clamp(64px, 15vw, 128px); margin: 0 0 12px; font-weight: 700; color: #333; }
  p { font-size: 18px; margin: 8px 0; line-height: 1.5; }
  a { color: #0a66c2; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
  <h1>404</h1>
  <p>This website is currently unavailable.</p>
  <p>For assistance, contact: <a href="mailto:RetroBlockchain@gmail.com">RetroBlockchain@gmail.com</a></p>
</main>
</body>
</html>`;

export function middleware() {
  return new NextResponse(PAGE, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
