# Photo-analysis evaluation — 2026-09-08T18:37:29.312Z

18 hand-labelled Wikimedia Commons photos (see evals/photos/manifest.json). Room type counts as correct when it is in the photo's acceptable set (an empty room can honestly be a bedroom or an office). Door accuracy is scored only where a human could label it. Quality is scored on catching the genuinely poor frame.

| system | photos | room type | empty? | door visible | quality | errors | mean ms | mean $ | total $ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no-model baseline | 18 | 56% | 61% | 89% | 94% | 0 | 0 | 0 | 0 |
| vision | 18 | 94% | 89% | 100% | 89% | 0 | 4168 | 0.00049 | 0.0088 |

## Per photo

| photo | system | room type (ok?) | empty (ok?) | door (ok?) | quality | ms | $ | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bedroom-empty.jpg | vision | bedroom (✓ of bedroom/other) | false (✗) | true (✓) | good | 2895 | 0.00053 | carpeted room, open door, a pillow on the floor |
| room-buida.jpg | vision | bedroom (✓ of bedroom/other/office) | true (✓) | true (✓) | good | 3230 | 0.00055 | shot from the doorway, sliding wardrobe panel on the right |
| kitchen-berlin-chair.jpg | vision | living (✓ of kitchen/living/dining/studio) | false (✓) | true (✓) | good | 1444 | 0.00045 | open-plan fitted kitchen with one chair |
| kitchen-panoramio.jpg | vision | kitchen (✓ of kitchen/other) | true (✗) | true (n/a) | good | 2214 | 0.00051 | institutional kitchen with fixed equipment (hard case) |
| living-empty.jpg | vision | living (✓ of living/bedroom/other) | true (✓) | true (✓) | poor | 4166 | 0.00056 | brick wall, ceiling fan, door on the left |
| living-mostly-empty.jpg | vision | living (✓ of living/bedroom/other) | false (✓) | true (n/a) | good | 6074 | 0.00046 | one armchair |
| living-showflat.jpg | vision | living (✓ of living/bedroom/other) | true (✓) | true (✓) | good | 3709 | 0.00046 | open door on the left, balcony glazing |
| dining-empty.jpg | vision | living (✓ of dining/living/bedroom/other) | false (✓) | true (n/a) | good | 4175 | 0.00054 | titled dining room, reads as a small bedroom; a sofa arm and books in frame (hard case) |
| office-empty.jpg | vision | living (✗ of office/other) | true (✓) | true (✓) | good | 4984 | 0.00047 | open-plan office, drop ceiling, glass door at the far end |
| room-unsplash.jpg | vision | bedroom (✓ of bedroom/living/other/hallway) | false (✓) | true (✓) | poor | 2659 | 0.00041 | nearly black, furnished room seen through a doorway (hard case) |
| bathroom-subway.jpg | vision | bathroom (✓ of bathroom) | true (✓) | false (n/a) | good | 7433 | 0.00045 | fixtures only |
| bedroom-leipzig.jpg | vision | bedroom (✓ of bedroom) | false (✓) | true (n/a) | poor | 5376 | 0.00051 | furnished hostel room |
| living-calhoun.jpg | vision | living (✓ of living/bedroom/other) | true (✓) | true (n/a) | good | 3371 | 0.00046 | balcony sliding door, lake view |
| bedroom-newark.jpg | vision | bedroom (✓ of bedroom) | false (✓) | true (✓) | good | 9559 | 0.00056 | fully furnished historic bedroom |
| kitchen-old.jpg | vision | kitchen (✓ of kitchen) | true (✓) | false (n/a) | good | 4708 | 0.00046 | fitted units and a washing machine, no loose furniture |
| living-riverside.jpg | vision | living (✓ of living/bedroom/other) | true (✓) | true (n/a) | good | 2710 | 0.00048 | small empty room, dark floor |
| corner-windows.jpg | vision | living (✓ of bedroom/living/other) | true (✓) | false (✓) | good | 2802 | 0.00045 | the demo photo; door behind the camera |
| extension-cord.jpg | vision | living (✓ of bedroom/living/other) | true (✓) | false (n/a) | good | 3514 | 0.00045 | same apartment as the demo photo |

## Struggle cases

- **bedroom-empty.jpg** (carpeted room, open door, a pillow on the floor): vision said bedroom, empty=false; truth bedroom/other, empty=true.
- **kitchen-panoramio.jpg** (institutional kitchen with fixed equipment (hard case)): vision said kitchen, empty=true; truth kitchen/other, empty=false.
- **office-empty.jpg** (open-plan office, drop ceiling, glass door at the far end): vision said living, empty=true; truth office/other, empty=true.