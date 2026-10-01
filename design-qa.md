# 静夜牌桌 — Design QA

final result: passed

## Evidence and comparison state

- Source visual truth: `design/selected-design.png`, the first displayed concept chosen by the user.
- Implementation: `http://127.0.0.1:5174/`, `design/desktop-final.png`.
- Source and implementation: 1487 × 1058 pixels; desktop CSS viewport 1487 × 1058, 1:1 comparison, no density rescaling.
- Full-view comparison: `design/comparison-final.jpg` (source left, implementation right).
- Focused comparisons: `design/comparison-hand.png`, `design/comparison-actions.png` (source above, implementation below).
- Equivalent interaction state: human turn, concealed human hand, all three opponents in play. Source is game 1/pot 50/level 10; implementation is a live game 2/pot 60/level 20. Dynamic scores, game index and AI actions intentionally follow real engine data rather than fixed mock values.
- Responsive captures: `design/laptop.png` (1366×768 viewport), `design/tablet.png` (820×1180), `design/mobile-final.png` (390×844 viewport, full-page capture), `design/home.png`.
- Other states: `design/mobile-compare.png`, `design/mobile-result-final.png`, `design/mobile-rules-final.png`.

## Findings and resolution history

First comparison (`design/comparison-before.jpg`, `design/desktop-before.png`):
- P2: action dock approximately 49px below source. Raised dock and matched 88px desktop control height.
- P2: human card group and upper opponent 45–56px too far left. Repositioned to match selected composition.
- P2: card-back image too saturated with broad stripes. Regenerated a muted slate-blue fine-stripe raster asset.
- P2: header progress too small and offset right. Increased size to 21px and aligned at 38% of frame.

Second comparison and responsive checks:
- Desktop source and revised implementation viewed together, including full-size hand and action crops. Composition now follows the source, with table seating, gold central score, hand grouping, action hierarchy and log placement preserved.
- P2: mobile controls initially came too close to the viewport edge. Reduced gaps and player area height; all five action buttons now fit in the 844px reference viewport, with action bottoms at or above 816px. Equalized second-row button heights.
- P2: phone result-table headers and rule action names wrapped awkwardly. Result table now scrolls inside its own container at 540px minimum width; rule action names stay on one line. Post-fix screenshots above inspected. Document width remains 390px.
- Background uses cover/crop rather than stretching, with laptop focal adjustment.
- No remaining actionable P0/P1/P2 findings.

## Required fidelity surfaces

- Typography: local Ma Shan Zheng subset gives the title and player initials the reference's calligraphic treatment. System Chinese sans-serif serves body text; score uses a large serif numeral. Visible controls and long cost labels checked for wrapping. The font is a close stylistic match, not the generated mock's exact letterforms.
- Spacing/layout: four positions around the oval table, centered score, human hand above the table edge, log lower left and ordered actions along the bottom. Dedicated tablet and phone layouts; no document horizontal overflow at tested phone/tablet widths. Long tabular content scrolls locally.
- Colors/tokens: navy surfaces, pale blue text, gold score, blue primary action, restrained red fold action; disabled controls and folded opponents remain visually distinct. Focus styles and reduced-motion support retained.
- Imagery: real generated WebP table background and card back are used throughout. Text and game values are live UI. Suit icons and close icon use Phosphor. No reference screenshot used as a fake interactive screen.
- Copy/content: Chinese interface and original game vocabulary retained; scores and costs update from rules. After looking, the prompt changes to choosing an action. No invented gameplay/navigation added.

## Behavior and validation

- Browser verified: start, refresh restore, reveal hand, cost update, follow, round advancement, choose comparison target from opponent, confirm comparison, settlement, next game, fold, pause, rules, close rules, resume, return home preserving save, continue saved match.
- Browser console error inspection: no errors returned.
- `npm test`: 5 suites / 56 tests passed (hand rankings, rules, match, AI and controller).
- `npm run build`: TypeScript and production build passed after final edits.
- Not exhaustively replayed in browser: complete eight-game final ranking and every random AI branch; existing automated match/rules/controller tests cover these paths. Fast-forward was present; its separate click could not be isolated because the AI had already completed that round.

## Follow-up polish

- P3: generated scene has slightly warmer lantern/copper highlights; card stripes are finer and less contrasted than the selected concept.
- P3: live font rasterization, title letterforms and smaller secondary labels vary slightly from the image mock. Major hierarchy and interaction readability are preserved.

## Implementation checklist

- [x] Local, optimized image and font assets
- [x] Responsive gameplay, home, result and modal styling
- [x] Real game actions preserved
- [x] Full and focused visual comparison
- [x] Build, automated tests and browser verification
- [x] Local preview retained for the user
