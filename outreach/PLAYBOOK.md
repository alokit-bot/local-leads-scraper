# Nextahalli Outreach Playbook

_Living document. Updated as we learn what works._

---

## Positioning

**We are NOT:** a website-building company.
**We ARE:** a digital growth partner for local businesses.

The website is a **Trojan horse** — the easiest thing to demonstrate (I built you one, look), but the real value is everything that comes after:
- Google Business optimization (incomplete listings, missing photos → more footfall)
- Online ordering / menu digitization (revenue they're leaving on the table)
- Loyalty & retention (WhatsApp broadcasts, birthday offers, repeat customer nurturing)
- Review management (the difference between 4.6★ and 4.8★ is real money)
- Social media presence (zero/abandoned Instagram → discovery channel)

**Alokit's role:** Build fast, open doors, qualify interest, track follow-ups.
**Avi's role:** Consultative sale — understand pain points, propose right service mix, close deals.

---

## Customer Signals (Psychographic, not Demographic)

We do NOT segment by business type (restaurant, salon, gym). That's demographic thinking.
Instead, we observe **signals** about the owner's mindset and let segments emerge from data.

Inspired by Chris Guillebeau's "New Demographies" from *The $100 Startup*:
traditional demographics (age, location, industry) matter less than values, beliefs,
ambitions, and behaviors. For local businesses, the equivalent is:

### Signals We Can Observe (before first contact)

| Signal | Where to Find It | What It Tells Us |
|--------|-----------------|------------------|
| **Google listing completeness** | Maps: photos count, hours filled, menu/services listed, Q&A | Digital awareness. 50 photos = they care about online presence. 2 blurry photos = they may not. |
| **Review reply behavior** | Google Maps reviews | Owner engagement. Personalized replies = relationship-driven. No replies = either too busy or doesn't care. |
| **Branding consistency** | Storefront photos, menu cards, signage | Pride in presentation. Matching colors/fonts/logo = brand-conscious. Handwritten signs = scrappy/informal. |
| **Name language** | Business name in Kannada/Tamil vs English vs both | Cultural identity, target audience, likely decision-making style. |
| **Review growth trajectory** | Review dates and counts | Growth mindset. Explosive recent growth = ambitious owner investing in growth. |
| **Social media presence** | Instagram/Facebook linked on Maps, web search | Already digital-forward, or completely absent? |
| **Response to competition** | Nearby businesses with websites/Instagram | Competitive pressure awareness. |
| **Customer sentiment themes** | Review text analysis | What customers value — ambiance? value? service? food quality? This shapes our pitch angle. |

### How We Use Signals

Instead of pre-assigning segments, we:

1. **Collect signals** during the web presence check / Google Maps scraping phase
2. **Tag each business** with observed signals (e.g., `high-digital-awareness`, `brand-proud`, `review-responsive`, `growth-phase`)
3. **Choose the message variant** based on which signals are strongest
4. **After 20+ outreaches**, look for clusters — which combinations of signals predict replies?
5. **Segments emerge from data**, not from our assumptions

### Signal → Variant Mapping (initial hypothesis, will evolve)

| Dominant Signal | Try First | Reasoning |
|----------------|-----------|-----------|
| High digital awareness (many photos, active listing) | Variant A (Consultative) | They already value digital — speak their language |
| Brand-proud (consistent signage, English name, polished storefront) | Variant D (Visual-First) | Show them a beautiful website — it'll resonate with their brand pride |
| Review-responsive (replies to reviews) | Variant B (Impressed Customer) | They engage with feedback — a message pointing out an opportunity will land |
| Growth-phase (new, rising fast) | Variant C (Growth Partner) | They're in growth mode — talk about scaling |
| Low digital presence + high rating | Variant B (Impressed Customer) | Biggest gap between offline quality and online presence — point it out |
| Kannada/local language name, community-rooted | Customize in Kannada opening | Cultural respect matters more than any variant template |

---

## Message Variants (A/B Testing)

### Variant A: "Digital Presence" (Consultative)
```
Hi! I came across {business_name} on Google Maps — {rating}★ with {reviews} reviews is impressive. 👏

I work with local businesses on their digital presence — helping them get discovered by more customers and keep the ones they have coming back.

I actually put together a sample website for {business_name} to show one idea of what's possible: {website_url}

Would love to hear what's working for you today and where you feel you're leaving customers on the table. No pitch — just curious.
```
**Tone:** Consultative, curious, low-pressure
**Hypothesis:** Works best with premium/brand-conscious businesses (restaurants-premium, salon-boutique)

### Variant B: "Impressed Customer" (Peer-level)
```
Hi! I was checking out {business_name} online and honestly impressed — {rating}★ with {reviews} reviews speaks for itself.

One thing I noticed though: when people search for you, there's no website to land on. You're missing out on everyone who wants to check you out before visiting.

I took the liberty of putting one together: {website_url}

Thought you might find it useful. Happy to chat if you're interested!
```
**Tone:** Direct, problem-aware, peer-to-peer
**Hypothesis:** Works with popular high-volume businesses who haven't thought about digital (restaurant-popular)

### Variant C: "Growth Partner" (Business-focused)
```
Hi {business_name} team! 👋

{rating}★ on Google Maps with {reviews} reviews — you're clearly doing something right.

I help local businesses like yours turn that offline reputation into online growth — more discovery, more first-time visitors, better retention.

Started with a sample website to give you a feel: {website_url}

What's your biggest challenge right now — getting new customers in, or keeping regulars coming back?
```
**Tone:** Business-focused, asks a qualifying question
**Hypothesis:** Works with fitness/gym and healthcare where growth metrics matter

### Variant D: "Visual-First" (Show don't tell)
```
Hi! I built this for {business_name}: {website_url}

{rating}★, {reviews} reviews — your place deserves a web presence that matches. This is just a sample — would love to make it truly yours.

— Alokit, Nextahalli
```
**Tone:** Ultra-short, leads with the product
**Hypothesis:** Works when the website is particularly impressive, or for busy owners who won't read long messages

---

## Experiment Design

### Assignment Rules
Each new business gets assigned a variant based on:
1. **Observed signals** — which signals are strongest for this business?
2. **Signal→Variant mapping** — initial hypothesis (see table above), updated with data
3. **Exploration budget** — 30% of sends try a random variant (explore) vs 70% use best guess (exploit)
4. **As patterns emerge** — if `brand-proud + review-responsive` businesses consistently reply to Variant D, lock that combo

### Tracking Schema
Every outreach is logged in `outreach/tracker.json`:
```json
{
  "business_slug": "coal-spark-restaurant",
  "business_name": "Coal Spark Restaurant",
  "category": "restaurant",
  "signals": {
    "digital_awareness": "low|medium|high",
    "brand_pride": "low|medium|high",
    "review_responsive": true,
    "growth_phase": false,
    "name_language": "english|kannada|tamil|hindi|mixed",
    "google_photos_count": 45,
    "has_social_media": false,
    "review_themes": ["food quality", "value for money"],
    "listing_completeness": 0.6,
    "raw_notes": "free-form observations about this business"
  },
  "variant": "B",
  "phone": "+91 97430 36444",
  "website_url": "https://alokit-bot.github.io/coal-spark-website/",
  "outreach_date": "2026-04-06",
  "message_sent": "full message text",
  "status": "sent|opened|replied|interested|converted|cold",
  "follow_ups": [
    { "date": "2026-04-08", "message": "...", "response": null }
  ],
  "notes": "",
  "conversion_events": {
    "replied_at": null,
    "interested_at": null,
    "meeting_scheduled_at": null,
    "deal_closed_at": null
  }
}
```

### Metrics
- **Reply rate** — % that respond at all (target: 20%+)
- **Interest rate** — % that express interest (target: 10%+)
- **Time to reply** — how fast they respond
- **Conversation depth** — how many messages before interest/rejection
- **Conversion rate** — % that become paying customers

### Analysis Approach
- **First 20 sends:** Pure exploration. Try all variants, collect signals carefully. No conclusions.
- **After 20 sends:** Look for signal clusters. Which combos of signals correlate with replies?
  Example: maybe `high digital awareness + review-responsive + English name` → 40% reply rate
  while `low digital awareness + not review-responsive` → 5% reply rate
- **After 40 sends:** Start exploiting. Route similar-signal businesses to winning variants.
- **Continuous:** Log new signals we didn't anticipate. The best predictor might be something we haven't thought of yet.
- **Monthly review:** Step back, re-read all conversations, look for patterns we missed in the numbers.

---

## Follow-up Cadence

| Day | Action | Note |
|-----|--------|------|
| 0 | Send opening message with website link | Personalized by variant |
| 2 | Gentle nudge if no reply | "Just wanted to make sure this came through — did you get a chance to check out the website?" |
| 7 | Value-add follow-up | Share a specific insight about their business (e.g., "noticed your Google listing is missing photos — that alone could drive 20% more clicks") |
| 14 | Final follow-up | "No worries if this isn't the right time. The website will stay live — feel free to reach out whenever." |
| 14+ | Mark as cold | Move to cold list. Revisit in 60 days only if we have a new angle. |

**Rules:**
- If they reply at ANY point → stop cadence, engage naturally
- If they say "not interested" → acknowledge gracefully, mark cold immediately
- If they ask about pricing → flag for Avi immediately
- If they engage in conversation → qualify their needs, then loop Avi in

---

## Qualifying Questions (for engaged leads)
Once someone replies positively, guide the conversation toward:
1. "What's your biggest challenge — new customers or keeping regulars?"
2. "How do most people find out about you today?"
3. "Have you tried anything online before — Instagram, Zomato, etc.?"
4. "If you could change one thing about how customers discover you, what would it be?"

These qualify the lead AND give us intel on what services to propose.

---

## Handoff to Avi
**When to escalate:**
- Lead asks about pricing
- Lead wants to meet in person
- Lead has complex requirements (multi-location, custom app, etc.)
- Lead is a high-value target (franchise, 10k+ reviews)

**How to escalate:**
- Post summary in Discord #nextahalli: business name, what they want, conversation highlights
- Include the full WhatsApp thread context

---

## Results Log

_Updated after each outreach batch._

| Date | Business | Segment | Variant | Reply? | Interested? | Notes |
|------|----------|---------|---------|--------|-------------|-------|
| | | | | | | |

---

## Learnings

_What we've discovered about messaging, segments, and conversion. Updated continuously._

1. _(No data yet — will populate after first outreach batch)_

---

_Last updated: 2026-04-05_
_Next review: After first 10 outreach messages sent_
