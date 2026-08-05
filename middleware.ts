// TEMPORARY maintenance layer — branch: maintenance/support-404.
// Intercepts every request and returns a self-contained 503 page.
// The application underneath is untouched. To restore the site, revert
// this commit (or redeploy the previous production deployment).
import { NextResponse } from "next/server";

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>503 Service Unavailable</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    background: #fcfcfc; color: #222;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 40px 24px; box-sizing: border-box;
    display: flex; flex-direction: column; min-height: 100%;
  }
  main { flex: 1 0 auto; max-width: 40em; }
  h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 .6rem; }
  p { font-size: 1rem; margin: 0; line-height: 1.5; }
  footer {
    flex-shrink: 0; margin-top: 3rem;
    font-size: .8rem; color: #767676;
  }
</style>
</head>
<body>
<main>
  <h1>503 Service Unavailable</h1>
  <p>The server is temporarily unable to service your request.</p>
</main>
<footer>Contact RetroBlockchain support: retroblockchain@gmail.com</footer>
</body>
</html>`;

export function middleware() {
  return new NextResponse(PAGE, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
      "retry-after": "3600",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
