# Caption fold evidence — phone apps, 2026-09-17

Method: the founder took screenshots in the native apps on their phone, each post
captured **collapsed** (before tapping "more") and, where available, **expanded**
(the full caption). Visible characters and rendered lines were counted by hand
against the full text. Referenced as the `tool` for the phone-app measurements in
`src/calendar/platformPreview.js` → `PLATFORM_FOLD`, because these apps cannot be
driven by `measure-feed-folds.mjs`.

## TikTok app — video posts: 2 lines, line breaks consume lines

| Post | Collapsed | Lines | Visible chars | Cut reason |
|---|---|---|---|---|
| Gemril | "The USA once almost made a weapon / that would erase humanity? Projec…more" | 2 | 33 + 33 | width, mid-word |
| ACE | "Higuruma - The Judge (with the help of an / Ae friend) \|\| SONG PROMO …more" | 2 | 41 + 24 | line break before hashtags |
| cabellhouse | "fine let's see what we're working with 🌸 / …more" | 2 | 40 + 0 | blank line consumes line 2 |
| Richard Animations | "bachelors at 12am 😂😂😂. / scene ; a friend trues lurring his fell…more" | 2 | 24 + 39 | break, then width |

Narrowest full line: 33 characters → `charsPerLine: 33`.

Photo posts (Duane uyi, CartoonEra) show a bold title plus ONE caption line. The
TikTok adapter publishes video only, so these do not set the model.

## LinkedIn app — organic posts: 3 lines; promoted posts: 2

| Post | Collapsed | Lines | Notes |
|---|---|---|---|
| Udeme Ufot (organic) | "Someone said something at Policy Innovation Centre (PIC) / summit in Abuja this week that I have not been able / to stop thinking about.… more" | 3 | cut at a paragraph break |
| Oluwayemisi Adekunle (organic) | "Literacy is more than the ability to read and write. For / communicators, it is the ability to understand, interpret, / translate and create meaning. Today, on… more" | 3 | unbroken: 56 + 58 + 39, last line shares space with "… more" |
| ChainUp (promoted) | 2 lines | 2 | ad |
| Reuters (promoted) | 2 lines | 2 | ad |
| LinkedIn for Marketing (promoted) | 2 lines | 2 | ad |

Full lines hold ~55–58 characters; the last line loses room to "… more", so the
conservative figure is 50 per line (3 × 50 = 150, observed 153).

## YouTube app

- **Regular videos**: the watch page shows the TITLE and "…more"; **no description
  characters are visible** until tapped (The 7 Levels of wealth; Types of People You
  Meet In College).
- **Shorts**: ONE line, and it is the title, truncated with "…" (4 Shorts).

The description fold (desktop 3 lines, measured separately) therefore only applies
where a description is shown at all; on phones it is always behind a tap.
