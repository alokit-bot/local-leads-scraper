# Local Leads → AI Website Pipeline

**Last updated:** 2026-03-09  
**Status:** Planning — resuming after current priorities

---

## The Business

Find popular local businesses in Bengaluru (and eventually other cities) that don't have a website. Build them one using AI tools. Offer it to them proactively. Avi closes the sale.

**Target economics:**  
- 20 sites/week, ~20% close rate = 4 sales/week  
- ₹30–50k per site → ₹1.2–2L/week  
- <10 hours Avi's time per week  

---

## The Weekly Workflow (Fridays)

### Step 1 — Scrape
Run `scraper.js` to pull high-rated businesses without websites across target areas.  
- Filter: rating ≥ 4.0, reviews ≥ 200  
- Areas: HSR Layout, Koramangala, BTM Layout, Jayanagar, Madiwala, Electronic City, Ejipura, Bellandur, Kudlu Gate, Begur Road, Hosa Road, Hosur Road  
- Output → `Leads / Bengaluru - Local Shops /` in Drive

### Step 2 — Shortlist 20
Score and rank candidates by:
- Review count (higher = more established, more to lose by not having a site)
- Number of photos in their GMaps listing (more photos = more assets for the website)
- Rating (floor 4.0, sweet spot 4.2–4.8)
- Category (restaurants, salons, gyms prioritised — high visual appeal = better websites)
- Location proximity (physical reachability for Avi if needed)
- **60-day re-contact filter** — skip any business contacted in the last 60 days (tracked in a local DB / Drive sheet)

### Step 3 — Capture GMaps Data
For each of the 20 shortlisted businesses, collect:
- Name, category, address, phone, hours
- Description / "About" text
- All photos (via **Google Places API Photos endpoint** — not scraping, stays ToS-compliant)
- Rating + review count + sample reviews (top 5)
- Google Maps URL

### Step 4 — Build Website
Construct a rich prompt from the captured data and pass it to **Emergent.sh** (via MCP or API) to generate a complete website.  

Key prompt elements:
- Business name, tagline, category
- Location + hours
- Sample reviews as social proof
- All photos as visual assets
- CTA: "Visit us" / "Call now" / "Book a table"

Website should be:
- Preview-only (not publicly indexed) until business approves
- Mobile-first (most of their customers are on phones)
- Fast-loading, no unnecessary complexity

> **TODO:** Research Emergent.sh's MCP/API to confirm programmatic site generation is possible and understand the interface.

### Step 5 — Outreach
Send each business a personalised WhatsApp message with:
- Preview link to their new website
- Brief note on how it helps them get more customers
- Clear next step ("Reply YES if you'd like to keep it")

**WhatsApp approach (TBD — policy risk):**  
The official WhatsApp Business API prohibits cold outreach to numbers that haven't opted in. Options:
- (a) Use a compliant first-touch channel (SMS or email) → follow up on WhatsApp once they respond
- (b) Find a compliant cold-outreach wrapper/provider
- (c) Manually send initial message from Avi's personal WhatsApp, automate follow-ups only

> **TODO:** Decide on outreach channel before building this step.

### Step 6 — Avi Closes
For businesses that respond positively, Avi takes over the conversation.  
- Over time, document common objections and automate responses where appropriate.

---

## Long-Term: GBP Sync

Once a business is a customer, keep their website automatically in sync with their **Google Business Profile**:
- Photos updated when they add new ones to GBP
- Hours updated when they change them
- Rating displayed live
- New reviews surfaced

This creates strong retention ("your website updates itself") and a recurring revenue justification.

> **TODO:** Explore Google Business Profile API for read access. Write access (on behalf of business) requires OAuth from the business owner.

---

## Tech Stack

| Component | Tool | Status |
|---|---|---|
| Lead scraping | `scraper.js` (CDP + Google Local) | ✅ Done |
| Drive storage | Google Drive OAuth | ✅ Done |
| Shortlisting | To be built | 🔲 |
| GMaps data capture | Google Places API | 🔲 |
| Website generation | Emergent.sh MCP/API | 🔲 (needs research) |
| WhatsApp outreach | WhatsApp Business API | 🔲 (policy TBD) |
| Contact history DB | SQLite or Drive Sheet | 🔲 |
| GBP sync | Google Business Profile API | 🔲 (long-term) |

---

## Decisions Made

1. **Emergent.sh** — Has an MCP (confirmed). Worst case, use their website manually. Avi has an account there already. Figure this out when we resume.

2. **Outreach approach** — WhatsApp cold outreach is too risky. Instead:
   - Email businesses that have an email address (top 20 per week)
   - Avi personally calls the top 5 overall picks
   - Goal: message should be so relevant it's a no-brainer. The only reason to say no should be price.

3. **Pricing model** — Upfront fee for the website (bundled with domain cost) + small monthly subscription for keeping it updated (GBP sync, photos, hours, etc.)

4. **Website hosting** — Emergent preview URLs. Note: Emergent "sleeps" inactive previews — need a solution before going live (e.g. wake-on-visit, or migrate to Vercel after approval).

5. **Photos / assets** — Use Google Places API Photos endpoint only. No scraping. Stays ToS-compliant.

6. **Preview status** — Website stays on preview URL (not indexed, not published) until business confirms they want it.

## Remaining Open Questions

1. **Emergent.sh MCP** — Exact input format and how to trigger a build programmatically.
2. **Preview hosting** — Solution for Emergent's sleep behaviour on inactive previews.
3. **Email scraping** — GMaps doesn't surface emails. Need a source for business email addresses (website contact pages, JustDial, etc.).

---

## Contact History Tracking

A simple log to enforce the 60-day re-contact rule:

```json
{
  "business_name": "SOMRAS BAR & KITCHEN",
  "maps_url": "https://maps.google.com/...",
  "last_contacted": "2026-03-09",
  "status": "sent | responded | closed | rejected | no_response"
}
```

Stored in Drive as a CSV/Sheet so Avi can see + edit it too.
