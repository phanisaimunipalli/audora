# Auto-stage evaluation — 2026-09-06T15:23:35.600Z

12 rooms × 1 repeat(s). A layout is valid when no essential piece had to be dropped (decor may be), every piece is inside the walls, overlaps nothing, keeps the door swing clear, the narrowest walkway between corridor-defining pieces is ≥ 0.75 m, and the room's essentials are present (sofa + coffee table for living, bed for bedroom, dining set for dining, desk + chair for office).

Systems: **heuristic** = rule-based stager (no model). **model:coords** = the model returns x/z/rot in metres and the engine keeps or drops each piece. **model:coords+repair** = same proposal, but the engine searches nearby for a valid spot before dropping. **model:semantic** = the model describes placements in words (wall / in front of / beside / opposite / corner) and the engine computes and repairs positions.

| system | runs | valid | essentials | walkable | pieces kept / proposed | parse errors | mean pieces | mean ms | mean $ | total $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heuristic | 12 | 100% | 100% | 100% | 100% | 0 | 5.1 | 1 | 0 | 0 |
| modal:stager:semantic | 12 | 0% | 0% | 100% | 0% | 0 | 0 | 22740 | 0 | 0 |

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
| living-a | modal:stager:semantic | 8 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 28651 | 0.00000 |
| living-b | modal:stager:semantic | 8 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 27494 | 0.00000 |
| living-c | modal:stager:semantic | 8 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 28103 | 0.00000 |
| living-narrow | modal:stager:semantic | 8 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 26013 | 0.00000 |
| bedroom-a | modal:stager:semantic | 8 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 27950 | 0.00000 |
| bedroom-b | modal:stager:semantic | 8 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 25776 | 0.00000 |
| bedroom-tiny | modal:stager:semantic | 0 | 0 | ✗ | ✗ | — |  | 17413 | 0.00000 |
| bedroom-door-east | modal:stager:semantic | 0 | 0 | ✗ | ✗ | — |  | 17107 | 0.00000 |
| dining-a | modal:stager:semantic | 6 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 18327 | 0.00000 |
| dining-small | modal:stager:semantic | 4 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 11955 | 0.00000 |
| office-a | modal:stager:semantic | 7 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 20090 | 0.00000 |
| studio-a | modal:stager:semantic | 8 | 0 | ✗ | ✗ | — | undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item), undefined (unknown catalog item) | 24000 | 0.00000 |

## Struggle case

**living-a** (typical living room) with modal:stager:semantic: 8 proposed, 8 dropped — undefined: unknown catalog item; undefined: unknown catalog item; undefined: unknown catalog item; undefined: unknown catalog item; undefined: unknown catalog item; undefined: unknown catalog item; undefined: unknown catalog item; undefined: unknown catalog item. Walkway n/a.

The engine drops invalid pieces rather than showing them, so a buyer never sees an overlapping sofa; the cost of a bad proposal is a sparser room, not a wrong one.