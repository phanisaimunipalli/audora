# Auto-stage evaluation — 2026-09-06T23:29:30.666Z

12 rooms × 1 repeat(s). A layout is valid when no essential piece had to be dropped (decor may be), every piece is inside the walls, overlaps nothing, keeps the door swing clear, the narrowest walkway between corridor-defining pieces is ≥ 0.75 m, and the room's essentials are present (sofa + coffee table for living, bed for bedroom, dining set for dining, desk + chair for office).

Systems: **heuristic** = rule-based stager (no model). **model:coords** = the model returns x/z/rot in metres and the engine keeps or drops each piece. **model:coords+repair** = same proposal, but the engine searches nearby for a valid spot before dropping. **model:semantic** = the model describes placements in words (wall / in front of / beside / opposite / corner) and the engine computes and repairs positions.

| system | runs | valid | essentials | walkable | pieces kept / proposed | parse errors | mean pieces | mean ms | mean $ | total $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heuristic | 12 | 100% | 100% | 100% | 100% | 0 | 5.1 | 1 | 0 | 0 |
| fast:coords | 12 | 17% | 42% | 42% | 50% | 0 | 3.9 | 5544 | 0.00023 | 0.0028 |
| fast:coords+repair | 12 | 75% | 92% | 100% | 85% | 0 | 6.7 | 5544 | 0.00023 | 0.0028 |
| fast:semantic | 12 | 83% | 92% | 92% | 93% | 0 | 7.4 | 5630 | 0.00017 | 0.0021 |
| text:coords | 12 | 17% | 75% | 42% | 65% | 0 | 4.6 | 2457 | 0.00029 | 0.0035 |
| text:coords+repair | 12 | 100% | 100% | 100% | 98% | 0 | 6.8 | 2457 | 0.00029 | 0.0035 |
| text:semantic | 12 | 92% | 100% | 92% | 94% | 0 | 6.9 | 2803 | 0.00036 | 0.0043 |

## Per room

| room | system | proposed | kept | valid | essentials | walkway | dropped (reason) | ms | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| living-a | heuristic | 8 | 8 | ✓ | ✓ | 0.75 m |  | 4 | 0.00000 |
| living-b | heuristic | 5 | 5 | ✓ | ✓ | 1.45 m |  | 1 | 0.00000 |
| living-c | heuristic | 8 | 8 | ✓ | ✓ | 0.75 m |  | 1 | 0.00000 |
| living-narrow | heuristic | 7 | 7 | ✓ | ✓ | 0.75 m |  | 2 | 0.00000 |
| bedroom-a | heuristic | 5 | 5 | ✓ | ✓ | 1.02 m |  | 1 | 0.00000 |
| bedroom-b | heuristic | 6 | 6 | ✓ | ✓ | 0.78 m |  | 0 | 0.00000 |
| bedroom-tiny | heuristic | 3 | 3 | ✓ | ✓ | 0.88 m |  | 0 | 0.00000 |
| bedroom-door-east | heuristic | 6 | 6 | ✓ | ✓ | 0.93 m |  | 0 | 0.00000 |
| dining-a | heuristic | 2 | 2 | ✓ | ✓ | 0.80 m |  | 0 | 0.00000 |
| dining-small | heuristic | 2 | 2 | ✓ | ✓ | 0.78 m |  | 1 | 0.00000 |
| office-a | heuristic | 3 | 3 | ✓ | ✓ | 0.83 m |  | 0 | 0.00000 |
| studio-a | heuristic | 6 | 6 | ✓ | ✓ | 0.95 m |  | 0 | 0.00000 |
| living-a | fast:coords | 8 | 5 | ✗ | ✗ | 0.24 m | coffee (overlaps another piece), tv (blocks the door), shelf (overlaps another piece) | 6959 | 0.00024 |
| living-a | fast:coords+repair | 8 | 8 | ✓ | ✓ | 0.77 m |  | 6959 | 0.00024 |
| living-b | fast:coords | 8 | 5 | ✗ | ✗ | 0.18 m | coffee (overlaps another piece), tv (blocks the door), lamp (overlaps another piece) | 5894 | 0.00026 |
| living-b | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.85 m | tv (no room without squeezing a walkway) | 5894 | 0.00026 |
| living-c | fast:coords | 8 | 5 | ✗ | ✗ | 0.22 m | coffee (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece) | 4992 | 0.00023 |
| living-c | fast:coords+repair | 8 | 8 | ✓ | ✓ | 0.86 m |  | 4992 | 0.00023 |
| living-narrow | fast:coords | 8 | 3 | ✗ | ✗ | 0.15 m | coffee (overlaps another piece), tv (blocks the door), armchair (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece) | 4607 | 0.00023 |
| living-narrow | fast:coords+repair | 8 | 6 | ✓ | ✓ | 0.95 m | tv (no room without squeezing a walkway), shelf (no room without squeezing a walkway) | 4607 | 0.00023 |
| bedroom-a | fast:coords | 8 | 3 | ✓ | ✓ | 0.77 m | nightstand (overlaps another piece), nightstand (overlaps another piece), armchair (overlaps another piece), side (blocks the door), lamp (blocks the door) | 5516 | 0.00024 |
| bedroom-a | fast:coords+repair | 8 | 8 | ✓ | ✓ | 0.77 m |  | 5516 | 0.00024 |
| bedroom-b | fast:coords | 8 | 3 | ✓ | ✓ | 0.98 m | nightstand (overlaps another piece), nightstand (overlaps another piece), armchair (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece) | 5430 | 0.00026 |
| bedroom-b | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.98 m | armchair (no room without squeezing a walkway) | 5430 | 0.00026 |
| bedroom-tiny | fast:coords | 8 | 2 | ✗ | ✓ | 0.50 m | nightstand (overlaps another piece), nightstand (overlaps another piece), armchair (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece) | 6516 | 0.00026 |
| bedroom-tiny | fast:coords+repair | 8 | 5 | ✓ | ✓ | 0.80 m | nightstand (no room without squeezing a walkway), armchair (no room without squeezing a walkway), lamp (no room without squeezing a walkway) | 6516 | 0.00026 |
| bedroom-door-east | fast:coords | 8 | 3 | ✗ | ✓ | 0.38 m | nightstand (overlaps another piece), nightstand (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece), plant (blocks the door) | 5844 | 0.00022 |
| bedroom-door-east | fast:coords+repair | 8 | 8 | ✓ | ✓ | 0.95 m |  | 5844 | 0.00022 |
| dining-a | fast:coords | 8 | 5 | ✗ | ✓ | 0.75 m | plant (overlaps another piece), dresser (overlaps another piece), dining-4 (overlaps another piece) | 5752 | 0.00021 |
| dining-a | fast:coords+repair | 8 | 6 | ✗ | ✓ | 0.75 m | dresser (no room without squeezing a walkway), dining-4 (no valid position found) | 5752 | 0.00021 |
| dining-small | fast:coords | 7 | 4 | ✗ | ✗ | 1.20 m | dining-6 (blocks the door), dining-4 (overlaps another piece), dining-2 (blocks the door) | 3702 | 0.00019 |
| dining-small | fast:coords+repair | 7 | 3 | ✗ | ✓ | 0.80 m | plant (no room without squeezing a walkway), dresser (no room without squeezing a walkway), dining-4 (no valid position found), dining-2 (no valid position found) | 3702 | 0.00019 |
| office-a | fast:coords | 7 | 4 | ✗ | ✗ | 0.16 m | office-chair (overlaps another piece), armchair (overlaps another piece), plant (overlaps another piece) | 5322 | 0.00021 |
| office-a | fast:coords+repair | 7 | 6 | ✓ | ✓ | 0.81 m | shelf (no room without squeezing a walkway) | 5322 | 0.00021 |
| studio-a | fast:coords | 8 | 5 | ✗ | ✗ | 1.18 m | coffee (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece) | 5992 | 0.00026 |
| studio-a | fast:coords+repair | 8 | 8 | ✗ | ✗ | 1.02 m |  | 5992 | 0.00026 |
| living-a | fast:semantic | 8 | 8 | ✓ | ✓ | 0.99 m |  | 3980 | 0.00017 |
| living-b | fast:semantic | 8 | 8 | ✓ | ✓ | 1.42 m |  | 5677 | 0.00018 |
| living-c | fast:semantic | 8 | 8 | ✓ | ✓ | 0.75 m |  | 6131 | 0.00017 |
| living-narrow | fast:semantic | 8 | 8 | ✓ | ✓ | 0.90 m |  | 5064 | 0.00018 |
| bedroom-a | fast:semantic | 8 | 7 | ✓ | ✓ | 0.77 m | wardrobe (no room without squeezing a walkway) | 4954 | 0.00017 |
| bedroom-b | fast:semantic | 8 | 7 | ✓ | ✓ | 0.97 m | wardrobe (no room without squeezing a walkway) | 4173 | 0.00017 |
| bedroom-tiny | fast:semantic | 8 | 6 | ✓ | ✓ | 0.78 m | dresser (no room without squeezing a walkway), wardrobe (no room without squeezing a walkway) | 7054 | 0.00020 |
| bedroom-door-east | fast:semantic | 8 | 7 | ✓ | ✓ | 0.80 m | dresser (no room without squeezing a walkway) | 5705 | 0.00017 |
| dining-a | fast:semantic | 8 | 7 | ✓ | ✓ | 0.80 m | dresser (no room without squeezing a walkway) | 4582 | 0.00015 |
| dining-small | fast:semantic | 8 | 7 | ✗ | ✓ | 0.50 m | dresser (no room without squeezing a walkway) | 6933 | 0.00015 |
| office-a | fast:semantic | 8 | 8 | ✓ | ✓ | 1.36 m |  | 5061 | 0.00015 |
| studio-a | fast:semantic | 8 | 8 | ✗ | ✗ | 1.09 m |  | 8242 | 0.00022 |
| living-a | text:coords | 8 | 6 | ✗ | ✓ | 0.62 m | side (overlaps another piece), tv (blocks the door) | 2951 | 0.00032 |
| living-a | text:coords+repair | 8 | 8 | ✓ | ✓ | 1.03 m |  | 2951 | 0.00032 |
| living-b | text:coords | 8 | 4 | ✓ | ✓ | 1.42 m | armchair (overlaps another piece), tv (blocks the door), lamp (overlaps another piece), plant (blocks the door) | 3238 | 0.00033 |
| living-b | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.87 m |  | 3238 | 0.00033 |
| living-c | text:coords | 7 | 5 | ✗ | ✓ | 0.17 m | armchair (blocks the door), plant (blocks the door) | 2377 | 0.00029 |
| living-c | text:coords+repair | 7 | 7 | ✓ | ✓ | 0.77 m |  | 2377 | 0.00029 |
| living-narrow | text:coords | 8 | 4 | ✗ | ✓ | 0.45 m | armchair (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece), tv (blocks the door) | 2985 | 0.00033 |
| living-narrow | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.80 m |  | 2985 | 0.00033 |
| bedroom-a | text:coords | 7 | 5 | ✗ | ✗ | 2.34 m | bed-queen (blocks the door), nightstand (blocks the door) | 2712 | 0.00029 |
| bedroom-a | text:coords+repair | 7 | 7 | ✓ | ✓ | 1.50 m |  | 2712 | 0.00029 |
| bedroom-b | text:coords | 8 | 7 | ✗ | ✓ | 0.45 m | lamp (overlaps another piece) | 2675 | 0.00031 |
| bedroom-b | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.98 m |  | 2675 | 0.00031 |
| bedroom-tiny | text:coords | 6 | 4 | ✗ | ✓ | 0.50 m | lamp (overlaps another piece), plant (overlaps another piece) | 1956 | 0.00026 |
| bedroom-tiny | text:coords+repair | 6 | 5 | ✓ | ✓ | 0.80 m | plant (no room without squeezing a walkway) | 1956 | 0.00026 |
| bedroom-door-east | text:coords | 8 | 5 | ✗ | ✓ | 0.18 m | side (overlaps another piece), lamp (overlaps another piece), plant (blocks the door) | 2569 | 0.00032 |
| bedroom-door-east | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.89 m |  | 2569 | 0.00032 |
| dining-a | text:coords | 5 | 4 | ✓ | ✓ | 0.75 m | dresser (blocks the door) | 1904 | 0.00022 |
| dining-a | text:coords+repair | 5 | 5 | ✓ | ✓ | 0.75 m |  | 1904 | 0.00022 |
| dining-small | text:coords | 4 | 3 | ✗ | ✗ | — | dining-6 (blocks the door) | 1686 | 0.00020 |
| dining-small | text:coords+repair | 4 | 4 | ✓ | ✓ | 0.80 m |  | 1686 | 0.00020 |
| office-a | text:coords | 7 | 4 | ✗ | ✗ | 0.25 m | desk (blocks the door), office-chair (blocks the door), lamp (overlaps another piece) | 2255 | 0.00027 |
| office-a | text:coords+repair | 7 | 7 | ✓ | ✓ | 1.19 m |  | 2255 | 0.00027 |
| studio-a | text:coords | 8 | 4 | ✗ | ✓ | 0.93 m | nightstand (overlaps another piece), lamp (overlaps another piece), coffee (overlaps another piece), tv (overlaps another piece) | 2172 | 0.00033 |
| studio-a | text:coords+repair | 8 | 7 | ✓ | ✓ | 0.80 m | tv (no room without squeezing a walkway) | 2172 | 0.00033 |
| living-a | text:semantic | 8 | 7 | ✓ | ✓ | 0.99 m | armchair (no room without squeezing a walkway) | 2455 | 0.00039 |
| living-b | text:semantic | 8 | 8 | ✓ | ✓ | 0.88 m |  | 2143 | 0.00038 |
| living-c | text:semantic | 8 | 8 | ✓ | ✓ | 0.87 m |  | 2447 | 0.00039 |
| living-narrow | text:semantic | 8 | 8 | ✓ | ✓ | 0.87 m |  | 2362 | 0.00039 |
| bedroom-a | text:semantic | 7 | 7 | ✓ | ✓ | 0.77 m |  | 2352 | 0.00035 |
| bedroom-b | text:semantic | 7 | 7 | ✓ | ✓ | 0.84 m |  | 3706 | 0.00035 |
| bedroom-tiny | text:semantic | 7 | 6 | ✓ | ✓ | 0.78 m | shelf (no room without squeezing a walkway) | 2966 | 0.00035 |
| bedroom-door-east | text:semantic | 8 | 7 | ✓ | ✓ | 1.20 m | armchair (no room without squeezing a walkway) | 3823 | 0.00039 |
| dining-a | text:semantic | 5 | 4 | ✓ | ✓ | 0.80 m | dresser (no room without squeezing a walkway) | 2190 | 0.00025 |
| dining-small | text:semantic | 7 | 6 | ✗ | ✓ | 0.50 m | dresser (no room without squeezing a walkway) | 3490 | 0.00032 |
| office-a | text:semantic | 7 | 7 | ✓ | ✓ | 0.89 m |  | 2967 | 0.00031 |
| studio-a | text:semantic | 8 | 8 | ✓ | ✓ | 0.88 m |  | 2735 | 0.00040 |

## Struggle case

**dining-small** (small dining (2.9 × 3.1): a table for six does not leave 0.75 m) with text:semantic: 7 proposed, 1 dropped — dresser: no room without squeezing a walkway. Walkway 0.50 m.

The engine drops invalid pieces rather than showing them, so a buyer never sees an overlapping sofa; the cost of a bad proposal is a sparser room, not a wrong one.