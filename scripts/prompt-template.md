# {{BUSINESS_NAME}} — Website Prompt

## BUSINESS_FACTS
- Name: **{{BUSINESS_NAME}}**
- Category: {{BUSINESS_CATEGORY}}
- Address: {{BUSINESS_ADDRESS}}
- Hours: {{BUSINESS_HOURS}}
- Phone: {{BUSINESS_PHONE}}
- Rating: {{BUSINESS_RATING}} ⭐ ({{REVIEW_COUNT}} Google reviews)
- Google Maps: {{GOOGLE_MAPS_URL}}
{{#if WEBSITE_URL}}- Website: {{WEBSITE_URL}}{{/if}}

## TONE_AND_STORY
{{TONE_AND_STORY}}

*[Instructions: Describe the atmosphere, target audience, and emotional experience. 
 What should visitors feel when they land on this page? What makes this business unique?]*

## SIGNATURE_HIGHLIGHTS
{{#each HIGHLIGHTS}}
- {{this}}
{{/each}}

*[Instructions: 3-6 bullet points of the most important offerings, features, or differentiators 
 pulled from reviews and the business description]*

## CUSTOMER_QUOTES
{{#each REVIEWS}}
{{@index_1}}. "{{text}}" — {{author}}
{{/each}}

*[Instructions: Use 3-5 real customer reviews as testimonial callouts on the page]*

## PRIORITY_ASSETS
{{#each PHOTOS}}
{{@index_1}}. `photos/photo-{{@index_1}}.jpg` — {{description}} (use for {{usage}})
{{/each}}

## CTA
Primary: "{{PRIMARY_CTA_TEXT}}" ({{PRIMARY_CTA_LINK}})
Secondary: "{{SECONDARY_CTA_TEXT}}" ({{SECONDARY_CTA_LINK}})

## PAGE_SECTIONS
1. **Hero** — {{HERO_HEADLINE}}. Include the business tagline, key selling point, CTA buttons.
2. **About / Story** — Brief origin, what makes this place special, team/owner note if available.
3. **Services / Offerings** — {{OFFERINGS_DESCRIPTION}}
4. **Gallery** — Use the provided photos with tasteful captions.
5. **Testimonials** — Display the customer quotes styled as social proof cards.
6. **Contact & Hours** — Full address, opening hours, phone number, Google Maps embed/link.

## DESIGN_DIRECTION
- Color palette: {{COLOR_PALETTE}}
- Font style: {{FONT_STYLE}}
- Overall vibe: {{DESIGN_VIBE}}
- Mobile-first, fast-loading
- No external CMS — fully self-contained
- Branding should feel: {{BRAND_FEEL}}

## TECHNICAL_REQUIREMENTS
- Framework: React with Vite (preferred) or Next.js static export
- Responsive at: 375px (phone), 768px (tablet), 1440px (laptop), 1920px (TV)
- Optimize images, lazy-load where appropriate
- Include package.json with `build` script
- Keep dependencies minimal — no heavy UI frameworks required
- Output should be deployable to GitHub Pages (static export)

## IMPORTANT INSTRUCTIONS
- **DO NOT ask clarifying questions.** Proceed with your best professional judgment.
- Use beautiful placeholder/stock images where business photos are not available.
- Keep it frontend-only — no backend, no database, no server-side logic.
- Use direct tel: links for phone calls and Google Maps links for directions.
- Create a specific services menu based on the business category.
- Use a "Call to Book" CTA approach for appointment-based businesses.
- Build everything in one go — no partial builds.

---
*This template is auto-filled by pipeline.mjs using details.json and Google Places data.*
