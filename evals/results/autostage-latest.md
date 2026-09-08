# Auto-stage evaluation — 2026-09-08T18:37:29.313Z

12 rooms × 1 repeat(s). A layout is valid when no essential piece had to be dropped (decor may be), every piece is inside the walls, overlaps nothing, keeps the door swing clear, the narrowest walkway between corridor-defining pieces is ≥ 0.75 m, and the room's essentials are present (sofa + coffee table for living, bed for bedroom, dining set for dining, desk + chair for office).

Systems: **heuristic** = rule-based stager (no model). **model:coords** = the model returns x/z/rot in metres and the engine keeps or drops each piece. **model:coords+repair** = same proposal, but the engine searches nearby for a valid spot before dropping. **model:semantic** = the model describes placements in words (wall / in front of / beside / opposite / corner) and the engine computes and repairs positions.

| system | runs | valid | essentials | walkable | pieces kept / proposed | parse errors | mean pieces | mean ms | mean $ | total $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heuristic | 12 | 100% | 100% | 100% | 100% | 0 | 5.1 | 1 | 0 | 0 |
| fast:coords | 12 | 8% | 42% | 8% | 57% | 0 | 4.4 | 8417 | 0.00023 | 0.0028 |
| fast:coords+repair | 12 | 75% | 92% | 92% | 82% | 0 | 6.3 | 8417 | 0.00023 | 0.0028 |
| fast:semantic | 12 | 83% | 92% | 92% | 93% | 0 | 7.4 | 6163 | 0.00017 | 0.0021 |
| text:coords | 12 | 25% | 58% | 42% | 67% | 0 | 4.8 | 10543 | 0.00029 | 0.0035 |
| text:coords+repair | 12 | 92% | 92% | 100% | 93% | 0 | 6.6 | 10543 | 0.00029 | 0.0035 |
| text:semantic | 12 | 75% | 83% | 92% | 95% | 0 | 6.7 | 9802 | 0.00035 | 0.0042 |

## Per room

| room | system | proposed | kept | valid | essentials | walkway | dropped (reason) | ms | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| living-a | heuristic | 8 | 8 | ✓ | ✓ | 0.75 m |  | 3 | 0.00000 |
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
| living-a | fast:coords | 8 | 5 | ✗ | ✗ | 0.54 m | coffee (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece) | 7164 | 0.00024 |
| living-a | fast:coords+repair | 8 | 6 | ✓ | ✓ | 0.84 m | tv (no room without squeezing a walkway), shelf (no room without squeezing a walkway) | 7164 | 0.00024 |
| living-b | fast:coords | 8 | 4 | ✗ | ✗ | 0.18 m | coffee (overlaps another piece), tv (overlaps another piece), armchair (overlaps another piece), lamp (overlaps another piece) | 6076 | 0.00024 |
| living-b | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.75 m | tv (no room without squeezing a walkway) | 6076 | 0.00024 |
| living-c | fast:coords | 8 | 5 | ✗ | ✗ | 0.22 m | coffee (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece) | 17201 | 0.00025 |
| living-c | fast:coords+repair | 8 | 6 | ✓ | ✓ | 0.86 m | tv (no room without squeezing a walkway), armchair (no room without squeezing a walkway) | 17201 | 0.00025 |
| living-narrow | fast:coords | 8 | 3 | ✗ | ✓ | 0.45 m | tv (blocks the door), armchair (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece) | 10524 | 0.00023 |
| living-narrow | fast:coords+repair | 8 | 6 | ✓ | ✓ | 0.90 m | tv (no room without squeezing a walkway), side (no room without squeezing a walkway) | 10524 | 0.00023 |
| bedroom-a | fast:coords | 8 | 5 | ✗ | ✗ | 0.62 m | bed-queen (blocks the door), side (overlaps another piece), lamp (overlaps another piece) | 6754 | 0.00023 |
| bedroom-a | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.77 m | armchair (no room without squeezing a walkway) | 6754 | 0.00023 |
| bedroom-b | fast:coords | 8 | 3 | ✗ | ✓ | 0.31 m | nightstand (overlaps another piece), nightstand (overlaps another piece), side (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece) | 8480 | 0.00024 |
| bedroom-b | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.98 m | armchair (no room without squeezing a walkway) | 8480 | 0.00024 |
| bedroom-tiny | fast:coords | 8 | 4 | ✗ | ✗ | 0.23 m | bed-queen (blocks the door), side (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece) | 8027 | 0.00026 |
| bedroom-tiny | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.78 m | armchair (no room without squeezing a walkway) | 8027 | 0.00026 |
| bedroom-door-east | fast:coords | 8 | 4 | ✓ | ✓ | 0.95 m | nightstand (overlaps another piece), nightstand (overlaps another piece), armchair (overlaps another piece), lamp (overlaps another piece) | 6789 | 0.00023 |
| bedroom-door-east | fast:coords+repair | 8 | 7 | ✓ | ✓ | 0.95 m | armchair (no room without squeezing a walkway) | 6789 | 0.00023 |
| dining-a | fast:coords | 8 | 6 | ✗ | ✓ | 0.15 m | plant (blocks the door), dining-4 (overlaps another piece) | 7601 | 0.00024 |
| dining-a | fast:coords+repair | 8 | 6 | ✗ | ✓ | 0.15 m | dresser (no room without squeezing a walkway), dining-4 (no valid position found) | 7601 | 0.00024 |
| dining-small | fast:coords | 6 | 4 | ✗ | ✓ | 0.25 m | dining-6 (blocks the door), lamp (blocks the door) | 3975 | 0.00021 |
| dining-small | fast:coords+repair | 6 | 4 | ✗ | ✓ | 0.80 m | dresser (no room without squeezing a walkway), dining-4 (no valid position found) | 3975 | 0.00021 |
| office-a | fast:coords | 7 | 4 | ✗ | ✗ | 0.16 m | office-chair (overlaps another piece), armchair (overlaps another piece), plant (overlaps another piece) | 10626 | 0.00019 |
| office-a | fast:coords+repair | 7 | 6 | ✓ | ✓ | 0.81 m | shelf (no room without squeezing a walkway) | 10626 | 0.00019 |
| studio-a | fast:coords | 8 | 6 | ✗ | ✗ | 0.25 m | armchair (overlaps another piece), lamp (overlaps another piece) | 7784 | 0.00023 |
| studio-a | fast:coords+repair | 8 | 7 | ✗ | ✗ | 1.29 m | tv (no room without squeezing a walkway) | 7784 | 0.00023 |
| living-a | fast:semantic | 8 | 8 | ✓ | ✓ | 0.99 m |  | 4796 | 0.00018 |
| living-b | fast:semantic | 8 | 8 | ✓ | ✓ | 1.42 m |  | 4108 | 0.00017 |
| living-c | fast:semantic | 8 | 8 | ✓ | ✓ | 1.37 m |  | 10004 | 0.00021 |
| living-narrow | fast:semantic | 8 | 8 | ✓ | ✓ | 0.90 m |  | 3979 | 0.00018 |
| bedroom-a | fast:semantic | 8 | 7 | ✓ | ✓ | 0.77 m | wardrobe (no room without squeezing a walkway) | 5105 | 0.00017 |
| bedroom-b | fast:semantic | 8 | 7 | ✓ | ✓ | 0.97 m | wardrobe (no room without squeezing a walkway) | 4373 | 0.00019 |
| bedroom-tiny | fast:semantic | 8 | 6 | ✓ | ✓ | 0.78 m | dresser (no room without squeezing a walkway), wardrobe (no room without squeezing a walkway) | 3922 | 0.00017 |
| bedroom-door-east | fast:semantic | 8 | 7 | ✓ | ✓ | 0.80 m | dresser (no room without squeezing a walkway) | 5552 | 0.00017 |
| dining-a | fast:semantic | 8 | 7 | ✓ | ✓ | 0.80 m | dresser (no room without squeezing a walkway) | 4857 | 0.00015 |
| dining-small | fast:semantic | 8 | 7 | ✗ | ✓ | 0.50 m | dresser (no room without squeezing a walkway) | 8771 | 0.00015 |
| office-a | fast:semantic | 8 | 8 | ✓ | ✓ | 0.81 m |  | 9195 | 0.00015 |
| studio-a | fast:semantic | 8 | 8 | ✗ | ✗ | 0.78 m |  | 9288 | 0.00018 |
| living-a | text:coords | 8 | 6 | ✗ | ✓ | 0.62 m | side (overlaps another piece), tv (blocks the door) | 11168 | 0.00033 |
| living-a | text:coords+repair | 8 | 8 | ✓ | ✓ | 1.03 m |  | 11168 | 0.00033 |
| living-b | text:coords | 8 | 4 | ✓ | ✓ | 1.38 m | armchair (overlaps another piece), lamp (overlaps another piece), plant (blocks the door), tv (blocks the door) | 14831 | 0.00033 |
| living-b | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.76 m |  | 14831 | 0.00033 |
| living-c | text:coords | 7 | 5 | ✗ | ✗ | 0.22 m | coffee (overlaps another piece), plant (blocks the door) | 11162 | 0.00030 |
| living-c | text:coords+repair | 7 | 6 | ✓ | ✓ | 0.82 m | plant (no room without squeezing a walkway) | 11162 | 0.00030 |
| living-narrow | text:coords | 8 | 4 | ✗ | ✓ | 0.45 m | armchair (overlaps another piece), lamp (overlaps another piece), plant (overlaps another piece), tv (blocks the door) | 13328 | 0.00033 |
| living-narrow | text:coords+repair | 8 | 7 | ✓ | ✓ | 0.90 m | armchair (no room without squeezing a walkway) | 13328 | 0.00033 |
| bedroom-a | text:coords | 8 | 7 | ✓ | ✓ | 0.77 m | armchair (blocks the door) | 15352 | 0.00032 |
| bedroom-a | text:coords+repair | 8 | 7 | ✓ | ✓ | 0.77 m | armchair (no room without squeezing a walkway) | 15352 | 0.00032 |
| bedroom-b | text:coords | 8 | 6 | ✗ | ✓ | 0.45 m | side (overlaps another piece), lamp (overlaps another piece) | 15116 | 0.00031 |
| bedroom-b | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.98 m |  | 15116 | 0.00031 |
| bedroom-tiny | text:coords | 6 | 3 | ✗ | ✗ | — | bed-queen (blocks the door), nightstand (blocks the door), lamp (blocks the door) | 9129 | 0.00026 |
| bedroom-tiny | text:coords+repair | 6 | 6 | ✓ | ✓ | 0.78 m |  | 9129 | 0.00026 |
| bedroom-door-east | text:coords | 8 | 5 | ✗ | ✓ | 0.18 m | nightstand (blocks the door), side (overlaps another piece), lamp (overlaps another piece) | 11526 | 0.00032 |
| bedroom-door-east | text:coords+repair | 8 | 8 | ✓ | ✓ | 0.76 m |  | 11526 | 0.00032 |
| dining-a | text:coords | 5 | 4 | ✓ | ✓ | 0.75 m | dresser (blocks the door) | 7005 | 0.00022 |
| dining-a | text:coords+repair | 5 | 4 | ✓ | ✓ | 0.75 m | dresser (no room without squeezing a walkway) | 7005 | 0.00022 |
| dining-small | text:coords | 4 | 3 | ✗ | ✗ | — | dining-6 (blocks the door) | 4531 | 0.00019 |
| dining-small | text:coords+repair | 4 | 4 | ✓ | ✓ | 0.80 m |  | 4531 | 0.00019 |
| office-a | text:coords | 7 | 4 | ✗ | ✗ | 0.25 m | office-chair (overlaps another piece), armchair (blocks the door), lamp (blocks the door) | 4995 | 0.00027 |
| office-a | text:coords+repair | 7 | 5 | ✓ | ✓ | 0.81 m | shelf (no room without squeezing a walkway), armchair (no room without squeezing a walkway) | 4995 | 0.00027 |
| studio-a | text:coords | 8 | 6 | ✗ | ✗ | 0.57 m | side (overlaps another piece), tv (blocks the door) | 8368 | 0.00034 |
| studio-a | text:coords+repair | 8 | 8 | ✗ | ✗ | 1.19 m |  | 8368 | 0.00034 |
| living-a | text:semantic | 8 | 7 | ✓ | ✓ | 1.14 m | armchair (no room without squeezing a walkway) | 7780 | 0.00039 |
| living-b | text:semantic | 2 | 2 | ✗ | ✗ | 1.28 m |  | 6306 | 0.00022 |
| living-c | text:semantic | 8 | 8 | ✓ | ✓ | 0.87 m |  | 4895 | 0.00039 |
| living-narrow | text:semantic | 8 | 8 | ✓ | ✓ | 0.87 m |  | 6640 | 0.00039 |
| bedroom-a | text:semantic | 7 | 7 | ✓ | ✓ | 0.77 m |  | 6859 | 0.00035 |
| bedroom-b | text:semantic | 8 | 8 | ✓ | ✓ | 0.82 m |  | 8716 | 0.00039 |
| bedroom-tiny | text:semantic | 7 | 7 | ✓ | ✓ | 0.78 m |  | 8343 | 0.00036 |
| bedroom-door-east | text:semantic | 8 | 7 | ✓ | ✓ | 1.05 m | armchair (no room without squeezing a walkway) | 7492 | 0.00038 |
| dining-a | text:semantic | 6 | 5 | ✓ | ✓ | 0.80 m | dresser (no room without squeezing a walkway) | 5554 | 0.00029 |
| dining-small | text:semantic | 7 | 6 | ✗ | ✓ | 0.50 m | dresser (no room without squeezing a walkway) | 10587 | 0.00032 |
| office-a | text:semantic | 7 | 7 | ✓ | ✓ | 0.89 m |  | 24281 | 0.00031 |
| studio-a | text:semantic | 8 | 8 | ✗ | ✗ | 0.83 m |  | 20173 | 0.00040 |

## Struggle case

**dining-small** (small dining (2.9 × 3.1): a table for six does not leave 0.75 m) with text:semantic: 7 proposed, 1 dropped — dresser: no room without squeezing a walkway. Walkway 0.50 m.

The engine drops invalid pieces rather than showing them, so a buyer never sees an overlapping sofa; the cost of a bad proposal is a sparser room, not a wrong one.