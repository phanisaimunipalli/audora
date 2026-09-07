# Auto-stage evaluation — 2026-09-06T15:19:49.437Z

12 rooms × 1 repeat(s). A layout is valid when no essential piece had to be dropped (decor may be), every piece is inside the walls, overlaps nothing, keeps the door swing clear, the narrowest walkway between corridor-defining pieces is ≥ 0.75 m, and the room's essentials are present (sofa + coffee table for living, bed for bedroom, dining set for dining, desk + chair for office).

Systems: **heuristic** = rule-based stager (no model). **model:coords** = the model returns x/z/rot in metres and the engine keeps or drops each piece. **model:coords+repair** = same proposal, but the engine searches nearby for a valid spot before dropping. **model:semantic** = the model describes placements in words (wall / in front of / beside / opposite / corner) and the engine computes and repairs positions.

| system | runs | valid | essentials | walkable | pieces kept / proposed | parse errors | mean pieces | mean ms | mean $ | total $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heuristic | 12 | 100% | 100% | 100% | 100% | 0 | 5.1 | 1 | 0 | 0 |
| modal:stager:semantic | 12 | 92% | 100% | 92% | 95% | 0 | 6.7 | 15102 | 0 | 0 |

## Per room

| room | system | proposed | kept | valid | essentials | walkway | dropped (reason) | ms | $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| living-a | heuristic | 8 | 8 | ✓ | ✓ | 0.75 m |  | 5 | 0.00000 |
| living-b | heuristic | 5 | 5 | ✓ | ✓ | 1.45 m |  | 0 | 0.00000 |
| living-c | heuristic | 8 | 8 | ✓ | ✓ | 0.75 m |  | 1 | 0.00000 |
| living-narrow | heuristic | 7 | 7 | ✓ | ✓ | 0.75 m |  | 1 | 0.00000 |
| bedroom-a | heuristic | 5 | 5 | ✓ | ✓ | 1.02 m |  | 1 | 0.00000 |
| bedroom-b | heuristic | 6 | 6 | ✓ | ✓ | 0.78 m |  | 0 | 0.00000 |
| bedroom-tiny | heuristic | 3 | 3 | ✓ | ✓ | 0.88 m |  | 1 | 0.00000 |
| bedroom-door-east | heuristic | 6 | 6 | ✓ | ✓ | 0.93 m |  | 0 | 0.00000 |
| dining-a | heuristic | 2 | 2 | ✓ | ✓ | 0.80 m |  | 1 | 0.00000 |
| dining-small | heuristic | 2 | 2 | ✓ | ✓ | 0.78 m |  | 0 | 0.00000 |
| office-a | heuristic | 3 | 3 | ✓ | ✓ | 0.83 m |  | 1 | 0.00000 |
| studio-a | heuristic | 6 | 6 | ✓ | ✓ | 0.95 m |  | 0 | 0.00000 |
| living-a | modal:stager:semantic | 7 | 7 | ✓ | ✓ | 1.04 m |  | 15177 | 0.00000 |
| living-b | modal:stager:semantic | 7 | 7 | ✓ | ✓ | 0.84 m |  | 14782 | 0.00000 |
| living-c | modal:stager:semantic | 7 | 7 | ✓ | ✓ | 1.07 m |  | 14930 | 0.00000 |
| living-narrow | modal:stager:semantic | 7 | 7 | ✓ | ✓ | 1.08 m |  | 14556 | 0.00000 |
| bedroom-a | modal:stager:semantic | 7 | 7 | ✓ | ✓ | 0.77 m |  | 16073 | 0.00000 |
| bedroom-b | modal:stager:semantic | 6 | 6 | ✓ | ✓ | 0.98 m |  | 12953 | 0.00000 |
| bedroom-tiny | modal:stager:semantic | 7 | 6 | ✓ | ✓ | 0.78 m | shelf (no room without squeezing a walkway) | 15424 | 0.00000 |
| bedroom-door-east | modal:stager:semantic | 7 | 7 | ✓ | ✓ | 0.82 m |  | 15727 | 0.00000 |
| dining-a | modal:stager:semantic | 7 | 6 | ✓ | ✓ | 0.80 m | dresser (no room without squeezing a walkway) | 13448 | 0.00000 |
| dining-small | modal:stager:semantic | 8 | 6 | ✗ | ✓ | 0.50 m | dresser (no room without squeezing a walkway), dining-2 (no valid position found) | 17839 | 0.00000 |
| office-a | modal:stager:semantic | 6 | 6 | ✓ | ✓ | 0.85 m |  | 12838 | 0.00000 |
| studio-a | modal:stager:semantic | 8 | 8 | ✓ | ✓ | 0.90 m |  | 17476 | 0.00000 |

## Struggle case

**dining-small** (small dining (2.9 × 3.1): a table for six does not leave 0.75 m) with modal:stager:semantic: 8 proposed, 2 dropped — dresser: no room without squeezing a walkway; dining-2: no valid position found. Walkway 0.50 m.

The engine drops invalid pieces rather than showing them, so a buyer never sees an overlapping sofa; the cost of a bad proposal is a sparser room, not a wrong one.