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

## Customer Segments

We hypothesize these segments respond differently. Refine as data comes in.

| Segment ID | Description | Examples | Hypothesis |
|-----------|-------------|----------|------------|
| `restaurant-popular` | High-review restaurants (1000+), no website | Coal Spark, Mughal Treat, Kapoor's Cafe | Care about footfall, may want online ordering. Price-sensitive on website but see value in "more customers." |
| `restaurant-premium` | High-rating (4.7+) restaurants, fewer reviews | Indian Biere House, Kunafa Story | Brand-conscious, may want polished presence. More willing to pay for quality. |
| `salon-boutique` | Beauty/hair salons, high rating | Style n Arts, Envoq, Hair Address, Lavish Locks | Appointment-driven. Website = booking funnel. Instagram matters. Care about looking premium. |
| `fitness-gym` | Gyms and fitness studios | Live Fitness, Studio 4, EUROFIT | Membership-driven. Want lead capture, class schedules, trial sign-ups. |
| `healthcare` | Clinics, wellness, diagnostics | Koramangala Women's Clinic, Sivantaa | Trust signals critical. Doctor profiles, certifications, patient testimonials. |
| `bar-lounge` | Bars, lounges, nightlife | SOMRAS, TBC Sky Lounge | Events-driven. Want ambiance showcase, event calendar, reservation system. |

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
1. **Segment** — primary factor
2. **Round-robin within segment** — ensures even distribution
3. **Override** — if a specific variant has proven winner for a segment, switch to it

### Tracking Schema
Every outreach is logged in `outreach/tracker.json`:
```json
{
  "business_slug": "coal-spark-restaurant",
  "business_name": "Coal Spark Restaurant",
  "segment": "restaurant-popular",
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

### Metrics (per variant × segment)
- **Reply rate** — % that respond at all (target: 20%+)
- **Interest rate** — % that express interest (target: 10%+)
- **Time to reply** — how fast they respond
- **Conversation depth** — how many messages before interest/rejection
- **Conversion rate** — % that become paying customers

### Statistical Approach
- Minimum 5 sends per variant per segment before drawing conclusions
- After 10+ sends in a segment, start favoring the winning variant (70/30 split)
- After 20+ sends, lock to winner unless new variant introduced
- Track monthly — customer behavior may shift with seasons

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
