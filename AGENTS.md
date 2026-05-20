<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing against the real database

There is no separate test/staging Supabase project — tests run against the live database. When writing or running test scripts that hit `/api/chat`, `/api/integration/inventory`, or any other endpoint that writes to Supabase:

1. **ALWAYS use `currentShop: "TEST"`** (not `"Mission"` or any real shop name) so test entries are visually distinct from real inventory on every inventory view, dashboard, and search filter.

2. **ALWAYS use clearly-fake brand and model strings** ("TestBrand TestModel", "TestBrand X-1000", etc.) — never real brands like Michelin or Bridgestone. Real brand strings make test entries indistinguishable from real shop entries.

3. **ALWAYS clean up immediately after a test passes.** Either delete the rows directly via the Supabase REST API in the test script, OR write a `scripts/cleanup-<test-name>.sql` for the owner to run, AND get explicit confirmation that cleanup happened before committing.

4. **NEVER assume "plausible-looking" test data can stay in real inventory.** Even if the data looks like real inventory, having test entries with fictional prices, quantities, or models in the real DB is a data-integrity hazard.

This rule exists because on 2026-05-21 a sprint added 11 test tires to real inventory using real brand names + `shop: "Mission"`. The prices on those test tires (from test script inputs like `"200 each"`) looked like the agent was hallucinating prices on real entries. The data was technically correct given the test inputs; the failure was in test isolation.
