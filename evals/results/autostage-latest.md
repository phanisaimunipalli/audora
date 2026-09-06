# Auto-stage evaluation — 2026-09-05T22:52:54.879Z

12 rooms × 1 repeat(s). A layout is valid when no essential piece had to be dropped (decor may be), every piece is inside the walls, overlaps nothing, keeps the door swing clear, the narrowest walkway between corridor-defining pieces is ≥ 0.75 m, and the room's essentials are present (sofa + coffee table for living, bed for bedroom, dining set for dining, desk + chair for office).

Systems: **heuristic** = rule-based stager (no model). **model:coords** = the model returns x/z/rot in metres and the engine keeps or drops each piece. **model:coords+repair** = same proposal, but the engine searches nearby for a valid spot before dropping. **model:semantic** = the model describes placements in words (wall / in front of / beside / opposite / corner) and the engine computes and repairs positions.

| system | runs | valid | essentials | walkable | pieces kept / proposed | parse errors | mean pieces | mean ms | mean $ | total $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heuristic | 12 | 100% | 100% | 100% | 100% | 0 | 5.1 | 1 | 0 | 0 |
| fast:coords | 12 | 8% | 42% | 33% | 55% | 0 | 4.3 | 14308 | 0.00023 | 0.0028 |
| fast:coords+repair | 12 | 75% | 92% | 92% | 86% | 0 | 6.7 | 14308 | 0.00023 | 0.0028 |
| fast:semantic | 12 | 75% | 92% | 92% | 92% | 0 | 7.3 | 12961 | 0.00017 | 0.0021 |
| text:coords | 12 | 33% | 58% | 50% | 61% | 0 | 4.3 | 1907 | 0.00029 | 0.0035 |
| text:coords+repair | 12 | 92% | 92% | 100% | 94% | 0 | 6.6 | 1907 | 0.00029 | 0.0035 |
| text:semantic | 12 | 92% | 100% | 92% | 94% | 0 | 6 | 2011 | 0.00033 | 0.004 |

## Per room

| room | system | proposed | kept | valid | essentials | walkway | dropped (reason) | ms | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| living-a | heuristic | 8 | 8 | ✓ | ✓ | 0.75 m |  | 4 | 0.00000 |
| living-b | heuristic | 5 | 5 | ✓ | ✓ | 1.45 m |  | 0 | 0.00000 |
| living-c | heuristic | 8 | 8 | ✓ | ✓ | 0.75 m |  | 1 | 0.00000 |
| living-narrow | heuristic | 7 | 7 | ✓ | ✓ | 0.75 m |  | 1 | 0.00000 |
| bedroom-a | heuristic | 5 | 5 | ✓ | ✓ | 1.02 m |  | 1 | 0.00000 |
| bedroom-b | heuristic | 6 | 6 | ✓ | ✓ | 0.78 m |  | 0 | 0.00000 |
| bedroom-tiny | heuristic | 3 | 3 | ✓ | ✓ | 0.88 m |  | 0 | 0.00000 |
| bedroom-door-east | heuristic | 6 | 6 | ✓ | ✓ | 0.93 m |  | 0 | 0.00000 |
| dining-a | heuristic | 2 | 2 | ✓ | ✓ | 0.80 m |  | 0 | 0.00000 |
| dining-small | heuristic | 2 | 2 | ✓ | ✓ | 0.78 m |  | 0 | 0.00000 |
| office-a | heuristic | 3 | 3 | ✓ | ✓ | 0.83 m |  | 0 | 0.00000 |
| studio-a | heuristic | 6 | 6 | ✓ | ✓ | 0.95 m |  | 0 | 0.00000 |
| living-a | fast:coords | 8 | 4 | ✗ | ✗ | 0.54 m | coffee (overlaps another piece), tv (blocks the door), lamp (overlaps another piece), shelf (overlaps another piece) | 5899 | 0.00023 |
| living-a | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.75 m | tv (no room without squeezing a walkway) | 5899 | 0.00023 |
| living-b | fast:coords | 8 | 5 | ✗ | ✗ | 0.18 m | coffee (overlaps another piece), tv (blocks the door), lamp (overlaps another piece) | 18591 | 0.00024 |
| living-b | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.85 m | tv (no room without squeezing a walkway) | 18591 | 0.00024 |
| living-c | fast:coords | 8 | 6 | ✗ | ✓ | 0.25 m | side (overlaps another piece), lamp (overlaps another piece) | 18195 | 0.00024 |
| living-c | fast:coords+repair | 8 | 8 | ✓ | ✓ | 1.14 m |  | 18195 | 0.00024 |
| living-narrow | fast:coords | 8 | 3 | ✗ | ✗ | 0.15 m | tv (blocks the door), coffee (overlaps another piece), armchair (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece) | 14833 | 0.00024 |
| living-narrow | fast:coords+repair | 8 | 6 | ✓ | ✓ | 0.95 m | tv (no room without squeezing a walkway), shelf (no room without squeezing a walkway) | 14833 | 0.00024 |
| bedroom-a | fast:coords | 8 | 4 | ✓ | ✓ | 0.77 m | nightstand (overlaps another piece), nightstand (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece) | 11857 | 0.00022 |
| bedroom-a | fast:coords+repair | 8 | 8 | ✓ | ✓ | 0.77 m |  | 11857 | 0.00022 |
| bedroom-b | fast:coords | 8 | 4 | ✗ | ✓ | 0.31 m | nightstand (overlaps another piece), nightstand (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece) | 13726 | 0.00026 |
| bedroom-b | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.98 m | armchair (no room without squeezing a walkway) | 13726 | 0.00026 |
| bedroom-tiny | fast:coords | 8 | 4 | ✗ | ✗ | — | bed-queen (blocks the door), armchair (blocks the door), side (blocks the door), lamp (blocks the door) | 13620 | 0.00024 |
| bedroom-tiny | fast:coords+repair | 8 | 6 | ✓ | ✓ | 0.78 m | side (no room without squeezing a walkway), plant (no room without squeezing a walkway) | 13620 | 0.00024 |
| bedroom-door-east | fast:coords | 8 | 3 | ✗ | ✓ | 0.38 m | nightstand (overlaps another piece), nightstand (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece), plant (blocks the door) | 10842 | 0.00023 |
| bedroom-door-east | fast:coords+repair | 8 | 8 | ✓ | ✓ | 0.95 m |  | 10842 | 0.00023 |
| dining-a | fast:coords | 8 | 5 | ✗ | ✓ | 0.75 m | dresser (overlaps another piece), dining-4 (overlaps another piece), dining-2 (overlaps another piece) | 14558 | 0.00024 |
| dining-a | fast:coords+repair | 8 | 6 | ✗ | ✓ | 0.39 m | dresser (no room without squeezing a walkway), dining-4 (no valid position found) | 14558 | 0.00024 |
| dining-small | fast:coords | 6 | 4 | ✗ | ✗ | 1.20 m | dining-6 (blocks the door), dining-4 (overlaps another piece) | 12602 | 0.00018 |
| dining-small | fast:coords+repair | 6 | 4 | ✗ | ✓ | 0.80 m | dresser (no room without squeezing a walkway), dining-4 (no valid position found) | 12602 | 0.00018 |
| office-a | fast:coords | 7 | 4 | ✗ | ✗ | 0.15 m | office-chair (overlaps another piece), armchair (overlaps another piece), plant (overlaps another piece) | 18403 | 0.00022 |
| office-a | fast:coords+repair | 7 | 6 | ✓ | ✓ | 0.81 m | shelf (no room without squeezing a walkway) | 18403 | 0.00022 |
| studio-a | fast:coords | 8 | 5 | ✗ | ✗ | 0.25 m | tv (blocks the door), armchair (overlaps another piece), lamp (overlaps another piece) | 18571 | 0.00024 |
| studio-a | fast:coords+repair | 8 | 7 | ✗ | ✗ | 0.80 m | tv (no room without squeezing a walkway) | 18571 | 0.00024 |
| living-a | fast:semantic | 8 | 8 | ✓ | ✓ | 0.99 m |  | 16127 | 0.00017 |
| living-b | fast:semantic | 8 | 8 | ✓ | ✓ | 1.42 m |  | 12140 | 0.00017 |
| living-c | fast:semantic | 8 | 8 | ✓ | ✓ | 1.37 m |  | 19529 | 0.00021 |
| living-narrow | fast:semantic | 8 | 8 | ✓ | ✓ | 0.90 m |  | 18161 | 0.00021 |
| bedroom-a | fast:semantic | 8 | 7 | ✓ | ✓ | 0.77 m | wardrobe (no room without squeezing a walkway) | 10435 | 0.00017 |
| bedroom-b | fast:semantic | 8 | 7 | ✓ | ✓ | 0.97 m | wardrobe (no room without squeezing a walkway) | 11072 | 0.00017 |
| bedroom-tiny | fast:semantic | 8 | 6 | ✓ | ✓ | 0.78 m | wardrobe (no room without squeezing a walkway), dresser (no room without squeezing a walkway) | 11184 | 0.00017 |
| bedroom-door-east | fast:semantic | 8 | 7 | ✓ | ✓ | 0.96 m | wardrobe (no room without squeezing a walkway) | 16426 | 0.00017 |
| dining-a | fast:semantic | 8 | 6 | ✗ | ✓ | 0.80 m | dresser (no room without squeezing a walkway), dining-4 (no valid position found) | 11356 | 0.00015 |
| dining-small | fast:semantic | 8 | 7 | ✗ | ✓ | 0.50 m | dresser (no room without squeezing a walkway) | 8585 | 0.00015 |
| office-a | fast:semantic | 8 | 8 | ✓ | ✓ | 0.81 m |  | 8765 | 0.00015 |
| studio-a | fast:semantic | 8 | 8 | ✗ | ✗ | 1.09 m |  | 11753 | 0.00019 |
| living-a | text:coords | 8 | 4 | ✓ | ✓ | 1.33 m | armchair (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece), tv (blocks the door) | 2341 | 0.00032 |
| living-a | text:coords+repair | 8 | 8 | ✓ | ✓ | 1.03 m |  | 2341 | 0.00032 |
| living-b | text:coords | 8 | 4 | ✓ | ✓ | 1.27 m | armchair (overlaps another piece), tv (blocks the door), lamp (overlaps another piece), plant (blocks the door) | 2113 | 0.00034 |
| living-b | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.87 m |  | 2113 | 0.00034 |
| living-c | text:coords | 8 | 4 | ✗ | ✗ | 1.07 m | coffee (overlaps another piece), armchair (overlaps another piece), lamp (overlaps another piece), plant (blocks the door) | 2079 | 0.00033 |
| living-c | text:coords+repair | 8 | 7 | ✓ | ✓ | 1.07 m | armchair (no room without squeezing a walkway) | 2079 | 0.00033 |
| living-narrow | text:coords | 6 | 2 | ✗ | ✗ | 0.15 m | coffee (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece), tv (blocks the door) | 1570 | 0.00028 |
| living-narrow | text:coords+repair | 6 | 6 | ✓ | ✓ | 0.95 m |  | 1570 | 0.00028 |
| bedroom-a | text:coords | 8 | 7 | ✓ | ✓ | 0.77 m | armchair (blocks the door) | 2127 | 0.00031 |
| bedroom-a | text:coords+repair | 8 | 7 | ✓ | ✓ | 0.77 m | armchair (no room without squeezing a walkway) | 2127 | 0.00031 |
| bedroom-b | text:coords | 8 | 6 | ✗ | ✓ | 0.45 m | side (overlaps another piece), lamp (overlaps another piece) | 2592 | 0.00031 |
| bedroom-b | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.98 m |  | 2592 | 0.00031 |
| bedroom-tiny | text:coords | 6 | 3 | ✗ | ✓ | 0.50 m | nightstand (overlaps another piece), nightstand (overlaps another piece), lamp (overlaps another piece) | 1441 | 0.00026 |
| bedroom-tiny | text:coords+repair | 6 | 5 | ✓ | ✓ | 0.80 m | plant (no room without squeezing a walkway) | 1441 | 0.00026 |
| bedroom-door-east | text:coords | 8 | 5 | ✗ | ✓ | 0.15 m | nightstand (blocks the door), side (overlaps another piece), lamp (overlaps another piece) | 1950 | 0.00031 |
| bedroom-door-east | text:coords+repair | 8 | 7 | ✓ | ✓ | 1.00 m | armchair (no room without squeezing a walkway) | 1950 | 0.00031 |
| dining-a | text:coords | 5 | 4 | ✓ | ✓ | 0.75 m | lamp (blocks the door) | 1322 | 0.00022 |
| dining-a | text:coords+repair | 5 | 5 | ✓ | ✓ | 0.75 m |  | 1322 | 0.00022 |
| dining-small | text:coords | 4 | 3 | ✗ | ✗ | — | dining-6 (blocks the door) | 1056 | 0.00020 |
| dining-small | text:coords+repair | 4 | 4 | ✓ | ✓ | 0.80 m |  | 1056 | 0.00020 |
| office-a | text:coords | 7 | 4 | ✗ | ✗ | 0.17 m | desk (blocks the door), office-chair (blocks the door), lamp (overlaps another piece) | 2013 | 0.00026 |
| office-a | text:coords+repair | 7 | 7 | ✓ | ✓ | 1.28 m |  | 2013 | 0.00026 |
| studio-a | text:coords | 8 | 5 | ✗ | ✗ | 0.20 m | nightstand (overlaps another piece), lamp (overlaps another piece), shelf (overlaps another piece) | 2282 | 0.00034 |
| studio-a | text:coords+repair | 8 | 7 | ✗ | ✗ | 0.94 m | shelf (no room without squeezing a walkway) | 2282 | 0.00034 |
| living-a | text:semantic | 8 | 7 | ✓ | ✓ | 0.99 m | armchair (no room without squeezing a walkway) | 2144 | 0.00039 |
| living-b | text:semantic | 8 | 7 | ✓ | ✓ | 0.93 m | armchair (no room without squeezing a walkway) | 2222 | 0.00039 |
| living-c | text:semantic | 2 | 2 | ✓ | ✓ | 1.07 m |  | 1674 | 0.00020 |
| living-narrow | text:semantic | 8 | 8 | ✓ | ✓ | 0.87 m |  | 1990 | 0.00039 |
| bedroom-a | text:semantic | 7 | 7 | ✓ | ✓ | 0.77 m |  | 1933 | 0.00035 |
| bedroom-b | text:semantic | 7 | 7 | ✓ | ✓ | 0.84 m |  | 1971 | 0.00035 |
| bedroom-tiny | text:semantic | 7 | 6 | ✓ | ✓ | 0.78 m | shelf (no room without squeezing a walkway) | 1774 | 0.00035 |
| bedroom-door-east | text:semantic | 2 | 2 | ✓ | ✓ | 1.20 m |  | 1533 | 0.00021 |
| dining-a | text:semantic | 7 | 6 | ✓ | ✓ | 0.80 m | dresser (no room without squeezing a walkway) | 2546 | 0.00037 |
| dining-small | text:semantic | 5 | 4 | ✗ | ✓ | 0.50 m | dresser (no room without squeezing a walkway) | 1493 | 0.00025 |
| office-a | text:semantic | 7 | 7 | ✓ | ✓ | 0.89 m |  | 2757 | 0.00031 |
| studio-a | text:semantic | 9 | 9 | ✓ | ✓ | 0.83 m |  | 2091 | 0.00043 |

## Struggle case

**dining-small** (small dining (2.9 × 3.1): a table for six does not leave 0.75 m) with text:semantic: 5 proposed, 1 dropped — dresser: no room without squeezing a walkway. Walkway 0.50 m.

The engine drops invalid pieces rather than showing them, so a buyer never sees an overlapping sofa; the cost of a bad proposal is a sparser room, not a wrong one.