# Default sprite sheets: layout

Every sprite is a **square**. Movement frames and avatar portraits are separate sheets and may use higher source resolutions.
World, building and UI cells share one tile size (128 px per cell: redrawn at four times the original detail with Codex image generation, `node tools/redraw-art.mjs`; the game bakes them at 64 px). Cells are read left to right, top to bottom. A bigger object
(a tree, a well, a house) is several sprites side by side: draw each part so it joins its neighbours edge to edge.
Leave empty cells transparent. Transparent PNG (RGBA). Files: `packs/core/art/default/<sheet>.png`; the *-guide.png images (except for characters: its table is below)
show the same grids with every cell named.

## characters.png  (20 x 16 cells = 5120 x 4096, 256 px per cell)

One row per character, 20 cells per row: five directions of four frames each, side by side: down 0-3, down_right 0-3, right 0-3, up_right 0-3, up 0-3.
The game flips right, down_right and up_right to get left, down_left and up_left (`mirror` in default-art.yaml), so it has all eight directions. A pack may list all eight in `dirs` instead.

The four frames are a walk cycle: frames 0 and 2 are the contact poses (one leg and the opposite arm forward, then the other pair), frames 1 and 3 are the passing poses (legs together, standing neutral).
Frame 1 is also the standing-still pose. The game plays 0, 1, 2, 3 in a loop while a character walks. For the companion the four frames are a wing-flap cycle (wings up, halfway down, down, halfway up).
Down faces the viewer, up shows the back, right is a profile, down_right and up_right are three-quarter views.
The character stands on the bottom edge of the cell, centred, the same size and foot line in every cell.

| row | id | used by |
| --- | --- | --- |
| 0 | founder | the player (the player: always the first row) |
| 1 | companion | role companion (the guide / pet: a small creature, robot or person) |
| 2 | agent_1 | role agent |
| 3 | agent_2 | role agent |
| 4 | agent_3 | role agent |
| 5 | agent_4 | role agent |
| 6 | agent_5 | role agent |
| 7 | agent_6 | role agent |
| 8 | agent_7 | role agent |
| 9 | agent_8 | role agent |
| 10 | agent_9 | role agent |
| 11 | agent_10 | role agent |
| 12 | agent_11 | role agent |
| 13 | agent_12 | role agent |
| 14 | agent_13 | role agent |
| 15 | agent_14 | role agent |

## portraits.png  (4 x 4 cells = 2048 x 2048, 512 px per cell)

| cell (col, row) | sprite | what to draw |
| --- | --- | --- |
| 0, 0 | portrait_founder | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 1, 0 | portrait_companion | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 2, 0 | portrait_agent_1 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 3, 0 | portrait_agent_2 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 0, 1 | portrait_agent_3 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 1, 1 | portrait_agent_4 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 2, 1 | portrait_agent_5 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 3, 1 | portrait_agent_6 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 0, 2 | portrait_agent_7 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 1, 2 | portrait_agent_8 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 2, 2 | portrait_agent_9 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 3, 2 | portrait_agent_10 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 0, 3 | portrait_agent_11 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 1, 3 | portrait_agent_12 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 2, 3 | portrait_agent_13 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |
| 3, 3 | portrait_agent_14 | head-and-shoulders avatar with a visible mouth; same character order as the movement sheet |

## world.png  (8 x 11 cells = 1024 x 1408)

| cell (col, row) | sprite | what to draw |
| --- | --- | --- |
| 0, 0 | t_ground_0 | ground tile (seamless, fills the cell) |
| 1, 0 | t_ground_1 | ground tile (seamless, fills the cell) |
| 2, 0 | t_ground_2 | ground tile (seamless, fills the cell) |
| 3, 0 | t_ground_3 | ground tile (seamless, fills the cell) |
| 4, 0 | t_path | path tile (seamless, fills the cell) |
| 5, 0 | t_plaza | plaza paving tile (seamless) |
| 6, 0 | t_water | water tile (seamless) |
| 7, 0 | t_bridge | bridge over water, planks running left to right (seamless) |
| 0, 1 | t_void | dark empty space beyond the map edge (seamless) |
| 1, 1 | p_tree_0_0 | tree, part col 0 row 0 of one object |
| 2, 1 | p_tree_1_0 | tree, part col 1 row 0 of one object |
| 3, 1 | p_tree_0_1 | tree, part col 0 row 1 of one object |
| 4, 1 | p_tree_1_1 | tree, part col 1 row 1 of one object |
| 5, 1 | p_pine_0_0 | pine, part col 0 row 0 of one object |
| 6, 1 | p_pine_0_1 | pine, part col 0 row 1 of one object |
| 7, 1 | p_bush | bush |
| 0, 2 | p_rock | rock |
| 1, 2 | p_flower | flower |
| 2, 2 | p_flower_v1 | flower, colour variant 2 |
| 3, 2 | p_flower_v2 | flower, colour variant 3 |
| 4, 2 | p_flower_v3 | flower, colour variant 4 |
| 5, 2 | p_mushroom | mushroom |
| 6, 2 | p_mushroom_v1 | mushroom, colour variant 2 |
| 7, 2 | p_crystal | crystal |
| 0, 3 | p_lamp_0_0 | lamp, part col 0 row 0 of one object |
| 1, 3 | p_lamp_0_1 | lamp, part col 0 row 1 of one object |
| 2, 3 | p_crate | crate |
| 3, 3 | p_cactus_0_0 | cactus, part col 0 row 0 of one object |
| 4, 3 | p_cactus_0_1 | cactus, part col 0 row 1 of one object |
| 5, 3 | p_reeds | reeds |
| 6, 3 | p_banner_0_0 | banner, part col 0 row 0 of one object |
| 7, 3 | p_banner_0_1 | banner, part col 0 row 1 of one object |
| 0, 4 | p_banner_v1_0_0 | banner v1, part col 0 row 0 of one object |
| 1, 4 | p_banner_v1_0_1 | banner v1, part col 0 row 1 of one object |
| 2, 4 | p_banner_v2_0_0 | banner v2, part col 0 row 0 of one object |
| 3, 4 | p_banner_v2_0_1 | banner v2, part col 0 row 1 of one object |
| 4, 4 | p_tuft | tuft |
| 5, 4 | p_pebbles | pebbles |
| 6, 4 | p_bench_0_0 | bench, part col 0 row 0 of one object |
| 7, 4 | p_bench_1_0 | bench, part col 1 row 0 of one object |
| 0, 5 | p_planter | planter |
| 1, 5 | p_planter_v1 | planter, colour variant 2 |
| 2, 5 | p_planter_v2 | planter, colour variant 3 |
| 3, 5 | p_well_0_0 | well, part col 0 row 0 of one object |
| 4, 5 | p_well_1_0 | well, part col 1 row 0 of one object |
| 5, 5 | p_well_0_1 | well, part col 0 row 1 of one object |
| 6, 5 | p_well_1_1 | well, part col 1 row 1 of one object |
| 7, 5 | p_fountain_0_0 | fountain, part col 0 row 0 of one object |
| 0, 6 | p_fountain_1_0 | fountain, part col 1 row 0 of one object |
| 1, 6 | p_fountain_0_1 | fountain, part col 0 row 1 of one object |
| 2, 6 | p_fountain_1_1 | fountain, part col 1 row 1 of one object |
| 3, 6 | p_stall_0_0 | stall, part col 0 row 0 of one object |
| 4, 6 | p_stall_1_0 | stall, part col 1 row 0 of one object |
| 5, 6 | p_stall_0_1 | stall, part col 0 row 1 of one object |
| 6, 6 | p_stall_1_1 | stall, part col 1 row 1 of one object |
| 7, 6 | p_stall_v1_0_0 | stall v1, part col 0 row 0 of one object |
| 0, 7 | p_stall_v1_1_0 | stall v1, part col 1 row 0 of one object |
| 1, 7 | p_stall_v1_0_1 | stall v1, part col 0 row 1 of one object |
| 2, 7 | p_stall_v1_1_1 | stall v1, part col 1 row 1 of one object |
| 3, 7 | p_stall_v2_0_0 | stall v2, part col 0 row 0 of one object |
| 4, 7 | p_stall_v2_1_0 | stall v2, part col 1 row 0 of one object |
| 5, 7 | p_stall_v2_0_1 | stall v2, part col 0 row 1 of one object |
| 6, 7 | p_stall_v2_1_1 | stall v2, part col 1 row 1 of one object |
| 7, 7 | p_brazier | brazier |
| 0, 8 | p_signpost | signpost |
| 1, 8 | p_haystack | haystack |
| 2, 8 | p_barrel | barrel |
| 3, 8 | p_pylon_0_0 | pylon, part col 0 row 0 of one object |
| 4, 8 | p_pylon_0_1 | pylon, part col 0 row 1 of one object |
| 5, 8 | p_flower_bed | flower bed |
| 6, 8 | p_flower_bed_v1 | flower bed, colour variant 2 |
| 7, 8 | p_flower_bed_v2 | flower bed, colour variant 3 |
| 0, 9 | p_flower_bed_v3 | flower bed, colour variant 4 |
| 1, 9 | p_generic_0 | any other prop (a small generic decoration) |
| 2, 9 | p_generic_1 | any other prop (a small generic decoration) |
| 3, 9 | p_generic_2 | any other prop (a small generic decoration) |
| 4, 9 | p_generic_3 | any other prop (a small generic decoration) |
| 5, 9 | b_plaza_0_0 | plaza landmark (a notice board / terminal / monument), part col 0 row 0 |
| 6, 9 | b_plaza_1_0 | plaza landmark (a notice board / terminal / monument), part col 1 row 0 |
| 7, 9 | b_plaza_0_1 | plaza landmark (a notice board / terminal / monument), part col 0 row 1 |
| 0, 10 | b_plaza_1_1 | plaza landmark (a notice board / terminal / monument), part col 1 row 1 |

## buildings.png  (8 x 34 cells = 1024 x 4352)

| cell (col, row) | sprite | what to draw |
| --- | --- | --- |
| 0, 0 | h_base_stone | stone base (a small overlay drawn on a wall block) |
| 1, 0 | h_base_deck | deck base (a small overlay drawn on a wall block) |
| 2, 0 | h_base_plinth | plinth base (a small overlay drawn on a wall block) |
| 3, 0 | h_wall_brick_l | brick wall block, left end |
| 4, 0 | h_wall_brick_m | brick wall block, middle (repeats) |
| 5, 0 | h_wall_brick_r | brick wall block, right end |
| 6, 0 | h_wall_plank_l | plank wall block, left end |
| 7, 0 | h_wall_plank_m | plank wall block, middle (repeats) |
| 0, 1 | h_wall_plank_r | plank wall block, right end |
| 1, 1 | h_wall_stone_l | stone wall block, left end |
| 2, 1 | h_wall_stone_m | stone wall block, middle (repeats) |
| 3, 1 | h_wall_stone_r | stone wall block, right end |
| 4, 1 | h_wall_panel_l | panel wall block, left end |
| 5, 1 | h_wall_panel_m | panel wall block, middle (repeats) |
| 6, 1 | h_wall_panel_r | panel wall block, right end |
| 7, 1 | h_wall_plaster_l | plaster wall block, left end |
| 0, 2 | h_wall_plaster_m | plaster wall block, middle (repeats) |
| 1, 2 | h_wall_plaster_r | plaster wall block, right end |
| 2, 2 | h_wall_timber_l | timber wall block, left end |
| 3, 2 | h_wall_timber_m | timber wall block, middle (repeats) |
| 4, 2 | h_wall_timber_r | timber wall block, right end |
| 5, 2 | h_roof_gable_l | gable roof block, left slope |
| 6, 2 | h_roof_gable_m | gable roof block, middle |
| 7, 2 | h_roof_gable_r | gable roof block, right slope |
| 0, 3 | h_roof_gable_peak | gable roof block, peak that closes the roof |
| 1, 3 | h_roof_hip_l | hip roof block, left slope |
| 2, 3 | h_roof_hip_m | hip roof block, middle |
| 3, 3 | h_roof_hip_r | hip roof block, right slope |
| 4, 3 | h_roof_hip_peak | hip roof block, peak that closes the roof |
| 5, 3 | h_roof_dome_l | dome roof block, left slope |
| 6, 3 | h_roof_dome_m | dome roof block, middle |
| 7, 3 | h_roof_dome_r | dome roof block, right slope |
| 0, 4 | h_roof_dome_peak | dome roof block, peak that closes the roof |
| 1, 4 | h_roof_flat_l | flat roof block, left slope |
| 2, 4 | h_roof_flat_m | flat roof block, middle |
| 3, 4 | h_roof_flat_r | flat roof block, right slope |
| 4, 4 | h_roof_cone_l | cone roof block, left slope |
| 5, 4 | h_roof_cone_m | cone roof block, middle |
| 6, 4 | h_roof_cone_r | cone roof block, right slope |
| 7, 4 | h_roof_cone_peak | cone roof block, peak that closes the roof |
| 0, 5 | h_roof_tent_l | tent roof block, left slope |
| 1, 5 | h_roof_tent_m | tent roof block, middle |
| 2, 5 | h_roof_tent_r | tent roof block, right slope |
| 3, 5 | h_roof_tent_peak | tent roof block, peak that closes the roof |
| 4, 5 | h_roof_tiers_l | tiers roof block, left slope |
| 5, 5 | h_roof_tiers_m | tiers roof block, middle |
| 6, 5 | h_roof_tiers_r | tiers roof block, right slope |
| 7, 5 | h_roof_tiers_peak | tiers roof block, peak that closes the roof |
| 0, 6 | h_door_plank | plank door (a small overlay drawn on a wall block) |
| 1, 6 | h_door_arch | arch door (a small overlay drawn on a wall block) |
| 2, 6 | h_door_round | round door (a small overlay drawn on a wall block) |
| 3, 6 | h_door_sliding | sliding door (a small overlay drawn on a wall block) |
| 4, 6 | h_window_square | square window (a small overlay drawn on a wall block) |
| 5, 6 | h_window_arch | arch window (a small overlay drawn on a wall block) |
| 6, 6 | h_window_round | round window (a small overlay drawn on a wall block) |
| 7, 6 | h_window_slit | slit window (a small overlay drawn on a wall block) |
| 0, 7 | h_chimney_brick | brick chimney (a small overlay drawn on a wall block) |
| 1, 7 | h_chimney_pipe | pipe chimney (a small overlay drawn on a wall block) |
| 2, 7 | h_chimney_stone | stone chimney (a small overlay drawn on a wall block) |
| 3, 7 | h_extra_awning | awning extra (a small overlay drawn on a wall block) |
| 4, 7 | h_extra_flowerbox | flowerbox extra (a small overlay drawn on a wall block) |
| 5, 7 | h_extra_lantern | lantern extra (a small overlay drawn on a wall block) |
| 6, 7 | h_extra_barrel | barrel extra (a small overlay drawn on a wall block) |
| 7, 7 | h_extra_sign | sign extra (a small overlay drawn on a wall block) |
| 0, 8 | h_extra_vines | vines extra (a small overlay drawn on a wall block) |
| 1, 8 | h_extra_antenna | antenna extra (a small overlay drawn on a wall block) |
| 2, 8 | h_extra_banner | banner extra (a small overlay drawn on a wall block) |
| 3, 8 | h_extra_crate | crate extra (a small overlay drawn on a wall block) |
| 4, 8 | h_extra_plant | plant extra (a small overlay drawn on a wall block) |
| 0, 9 | h_house_forge_0_0 | illustrated forge house, part col 0 row 0 (joins neighbouring cells) |
| 1, 9 | h_house_forge_1_0 | illustrated forge house, part col 1 row 0 (joins neighbouring cells) |
| 2, 9 | h_house_forge_2_0 | illustrated forge house, part col 2 row 0 (joins neighbouring cells) |
| 3, 9 | h_house_forge_3_0 | illustrated forge house, part col 3 row 0 (joins neighbouring cells) |
| 4, 9 | h_house_forge_4_0 | illustrated forge house, part col 4 row 0 (joins neighbouring cells) |
| 5, 9 | h_house_forge_0_1 | illustrated forge house, part col 0 row 1 (joins neighbouring cells) |
| 6, 9 | h_house_forge_1_1 | illustrated forge house, part col 1 row 1 (joins neighbouring cells) |
| 7, 9 | h_house_forge_2_1 | illustrated forge house, part col 2 row 1 (joins neighbouring cells) |
| 0, 10 | h_house_forge_3_1 | illustrated forge house, part col 3 row 1 (joins neighbouring cells) |
| 1, 10 | h_house_forge_4_1 | illustrated forge house, part col 4 row 1 (joins neighbouring cells) |
| 2, 10 | h_house_forge_0_2 | illustrated forge house, part col 0 row 2 (joins neighbouring cells) |
| 3, 10 | h_house_forge_1_2 | illustrated forge house, part col 1 row 2 (joins neighbouring cells) |
| 4, 10 | h_house_forge_2_2 | illustrated forge house, part col 2 row 2 (joins neighbouring cells) |
| 5, 10 | h_house_forge_3_2 | illustrated forge house, part col 3 row 2 (joins neighbouring cells) |
| 6, 10 | h_house_forge_4_2 | illustrated forge house, part col 4 row 2 (joins neighbouring cells) |
| 7, 10 | h_house_forge_0_3 | illustrated forge house, part col 0 row 3 (joins neighbouring cells) |
| 0, 11 | h_house_forge_1_3 | illustrated forge house, part col 1 row 3 (joins neighbouring cells) |
| 1, 11 | h_house_forge_2_3 | illustrated forge house, part col 2 row 3 (joins neighbouring cells) |
| 2, 11 | h_house_forge_3_3 | illustrated forge house, part col 3 row 3 (joins neighbouring cells) |
| 3, 11 | h_house_forge_4_3 | illustrated forge house, part col 4 row 3 (joins neighbouring cells) |
| 4, 11 | h_house_forge_0_4 | illustrated forge house, part col 0 row 4 (joins neighbouring cells) |
| 5, 11 | h_house_forge_1_4 | illustrated forge house, part col 1 row 4 (joins neighbouring cells) |
| 6, 11 | h_house_forge_2_4 | illustrated forge house, part col 2 row 4 (joins neighbouring cells) |
| 7, 11 | h_house_forge_3_4 | illustrated forge house, part col 3 row 4 (joins neighbouring cells) |
| 0, 12 | h_house_forge_4_4 | illustrated forge house, part col 4 row 4 (joins neighbouring cells) |
| 1, 12 | h_house_inn_0_0 | illustrated inn house, part col 0 row 0 (joins neighbouring cells) |
| 2, 12 | h_house_inn_1_0 | illustrated inn house, part col 1 row 0 (joins neighbouring cells) |
| 3, 12 | h_house_inn_2_0 | illustrated inn house, part col 2 row 0 (joins neighbouring cells) |
| 4, 12 | h_house_inn_3_0 | illustrated inn house, part col 3 row 0 (joins neighbouring cells) |
| 5, 12 | h_house_inn_4_0 | illustrated inn house, part col 4 row 0 (joins neighbouring cells) |
| 6, 12 | h_house_inn_0_1 | illustrated inn house, part col 0 row 1 (joins neighbouring cells) |
| 7, 12 | h_house_inn_1_1 | illustrated inn house, part col 1 row 1 (joins neighbouring cells) |
| 0, 13 | h_house_inn_2_1 | illustrated inn house, part col 2 row 1 (joins neighbouring cells) |
| 1, 13 | h_house_inn_3_1 | illustrated inn house, part col 3 row 1 (joins neighbouring cells) |
| 2, 13 | h_house_inn_4_1 | illustrated inn house, part col 4 row 1 (joins neighbouring cells) |
| 3, 13 | h_house_inn_0_2 | illustrated inn house, part col 0 row 2 (joins neighbouring cells) |
| 4, 13 | h_house_inn_1_2 | illustrated inn house, part col 1 row 2 (joins neighbouring cells) |
| 5, 13 | h_house_inn_2_2 | illustrated inn house, part col 2 row 2 (joins neighbouring cells) |
| 6, 13 | h_house_inn_3_2 | illustrated inn house, part col 3 row 2 (joins neighbouring cells) |
| 7, 13 | h_house_inn_4_2 | illustrated inn house, part col 4 row 2 (joins neighbouring cells) |
| 0, 14 | h_house_inn_0_3 | illustrated inn house, part col 0 row 3 (joins neighbouring cells) |
| 1, 14 | h_house_inn_1_3 | illustrated inn house, part col 1 row 3 (joins neighbouring cells) |
| 2, 14 | h_house_inn_2_3 | illustrated inn house, part col 2 row 3 (joins neighbouring cells) |
| 3, 14 | h_house_inn_3_3 | illustrated inn house, part col 3 row 3 (joins neighbouring cells) |
| 4, 14 | h_house_inn_4_3 | illustrated inn house, part col 4 row 3 (joins neighbouring cells) |
| 5, 14 | h_house_inn_0_4 | illustrated inn house, part col 0 row 4 (joins neighbouring cells) |
| 6, 14 | h_house_inn_1_4 | illustrated inn house, part col 1 row 4 (joins neighbouring cells) |
| 7, 14 | h_house_inn_2_4 | illustrated inn house, part col 2 row 4 (joins neighbouring cells) |
| 0, 15 | h_house_inn_3_4 | illustrated inn house, part col 3 row 4 (joins neighbouring cells) |
| 1, 15 | h_house_inn_4_4 | illustrated inn house, part col 4 row 4 (joins neighbouring cells) |
| 2, 15 | h_house_hall_0_0 | illustrated hall house, part col 0 row 0 (joins neighbouring cells) |
| 3, 15 | h_house_hall_1_0 | illustrated hall house, part col 1 row 0 (joins neighbouring cells) |
| 4, 15 | h_house_hall_2_0 | illustrated hall house, part col 2 row 0 (joins neighbouring cells) |
| 5, 15 | h_house_hall_3_0 | illustrated hall house, part col 3 row 0 (joins neighbouring cells) |
| 6, 15 | h_house_hall_4_0 | illustrated hall house, part col 4 row 0 (joins neighbouring cells) |
| 7, 15 | h_house_hall_0_1 | illustrated hall house, part col 0 row 1 (joins neighbouring cells) |
| 0, 16 | h_house_hall_1_1 | illustrated hall house, part col 1 row 1 (joins neighbouring cells) |
| 1, 16 | h_house_hall_2_1 | illustrated hall house, part col 2 row 1 (joins neighbouring cells) |
| 2, 16 | h_house_hall_3_1 | illustrated hall house, part col 3 row 1 (joins neighbouring cells) |
| 3, 16 | h_house_hall_4_1 | illustrated hall house, part col 4 row 1 (joins neighbouring cells) |
| 4, 16 | h_house_hall_0_2 | illustrated hall house, part col 0 row 2 (joins neighbouring cells) |
| 5, 16 | h_house_hall_1_2 | illustrated hall house, part col 1 row 2 (joins neighbouring cells) |
| 6, 16 | h_house_hall_2_2 | illustrated hall house, part col 2 row 2 (joins neighbouring cells) |
| 7, 16 | h_house_hall_3_2 | illustrated hall house, part col 3 row 2 (joins neighbouring cells) |
| 0, 17 | h_house_hall_4_2 | illustrated hall house, part col 4 row 2 (joins neighbouring cells) |
| 1, 17 | h_house_hall_0_3 | illustrated hall house, part col 0 row 3 (joins neighbouring cells) |
| 2, 17 | h_house_hall_1_3 | illustrated hall house, part col 1 row 3 (joins neighbouring cells) |
| 3, 17 | h_house_hall_2_3 | illustrated hall house, part col 2 row 3 (joins neighbouring cells) |
| 4, 17 | h_house_hall_3_3 | illustrated hall house, part col 3 row 3 (joins neighbouring cells) |
| 5, 17 | h_house_hall_4_3 | illustrated hall house, part col 4 row 3 (joins neighbouring cells) |
| 6, 17 | h_house_hall_0_4 | illustrated hall house, part col 0 row 4 (joins neighbouring cells) |
| 7, 17 | h_house_hall_1_4 | illustrated hall house, part col 1 row 4 (joins neighbouring cells) |
| 0, 18 | h_house_hall_2_4 | illustrated hall house, part col 2 row 4 (joins neighbouring cells) |
| 1, 18 | h_house_hall_3_4 | illustrated hall house, part col 3 row 4 (joins neighbouring cells) |
| 2, 18 | h_house_hall_4_4 | illustrated hall house, part col 4 row 4 (joins neighbouring cells) |
| 3, 18 | h_house_workshop_0_0 | illustrated workshop house, part col 0 row 0 (joins neighbouring cells) |
| 4, 18 | h_house_workshop_1_0 | illustrated workshop house, part col 1 row 0 (joins neighbouring cells) |
| 5, 18 | h_house_workshop_2_0 | illustrated workshop house, part col 2 row 0 (joins neighbouring cells) |
| 6, 18 | h_house_workshop_3_0 | illustrated workshop house, part col 3 row 0 (joins neighbouring cells) |
| 7, 18 | h_house_workshop_4_0 | illustrated workshop house, part col 4 row 0 (joins neighbouring cells) |
| 0, 19 | h_house_workshop_0_1 | illustrated workshop house, part col 0 row 1 (joins neighbouring cells) |
| 1, 19 | h_house_workshop_1_1 | illustrated workshop house, part col 1 row 1 (joins neighbouring cells) |
| 2, 19 | h_house_workshop_2_1 | illustrated workshop house, part col 2 row 1 (joins neighbouring cells) |
| 3, 19 | h_house_workshop_3_1 | illustrated workshop house, part col 3 row 1 (joins neighbouring cells) |
| 4, 19 | h_house_workshop_4_1 | illustrated workshop house, part col 4 row 1 (joins neighbouring cells) |
| 5, 19 | h_house_workshop_0_2 | illustrated workshop house, part col 0 row 2 (joins neighbouring cells) |
| 6, 19 | h_house_workshop_1_2 | illustrated workshop house, part col 1 row 2 (joins neighbouring cells) |
| 7, 19 | h_house_workshop_2_2 | illustrated workshop house, part col 2 row 2 (joins neighbouring cells) |
| 0, 20 | h_house_workshop_3_2 | illustrated workshop house, part col 3 row 2 (joins neighbouring cells) |
| 1, 20 | h_house_workshop_4_2 | illustrated workshop house, part col 4 row 2 (joins neighbouring cells) |
| 2, 20 | h_house_workshop_0_3 | illustrated workshop house, part col 0 row 3 (joins neighbouring cells) |
| 3, 20 | h_house_workshop_1_3 | illustrated workshop house, part col 1 row 3 (joins neighbouring cells) |
| 4, 20 | h_house_workshop_2_3 | illustrated workshop house, part col 2 row 3 (joins neighbouring cells) |
| 5, 20 | h_house_workshop_3_3 | illustrated workshop house, part col 3 row 3 (joins neighbouring cells) |
| 6, 20 | h_house_workshop_4_3 | illustrated workshop house, part col 4 row 3 (joins neighbouring cells) |
| 7, 20 | h_house_workshop_0_4 | illustrated workshop house, part col 0 row 4 (joins neighbouring cells) |
| 0, 21 | h_house_workshop_1_4 | illustrated workshop house, part col 1 row 4 (joins neighbouring cells) |
| 1, 21 | h_house_workshop_2_4 | illustrated workshop house, part col 2 row 4 (joins neighbouring cells) |
| 2, 21 | h_house_workshop_3_4 | illustrated workshop house, part col 3 row 4 (joins neighbouring cells) |
| 3, 21 | h_house_workshop_4_4 | illustrated workshop house, part col 4 row 4 (joins neighbouring cells) |
| 4, 21 | h_house_cottage_0_0 | illustrated cottage house, part col 0 row 0 (joins neighbouring cells) |
| 5, 21 | h_house_cottage_1_0 | illustrated cottage house, part col 1 row 0 (joins neighbouring cells) |
| 6, 21 | h_house_cottage_2_0 | illustrated cottage house, part col 2 row 0 (joins neighbouring cells) |
| 7, 21 | h_house_cottage_3_0 | illustrated cottage house, part col 3 row 0 (joins neighbouring cells) |
| 0, 22 | h_house_cottage_4_0 | illustrated cottage house, part col 4 row 0 (joins neighbouring cells) |
| 1, 22 | h_house_cottage_0_1 | illustrated cottage house, part col 0 row 1 (joins neighbouring cells) |
| 2, 22 | h_house_cottage_1_1 | illustrated cottage house, part col 1 row 1 (joins neighbouring cells) |
| 3, 22 | h_house_cottage_2_1 | illustrated cottage house, part col 2 row 1 (joins neighbouring cells) |
| 4, 22 | h_house_cottage_3_1 | illustrated cottage house, part col 3 row 1 (joins neighbouring cells) |
| 5, 22 | h_house_cottage_4_1 | illustrated cottage house, part col 4 row 1 (joins neighbouring cells) |
| 6, 22 | h_house_cottage_0_2 | illustrated cottage house, part col 0 row 2 (joins neighbouring cells) |
| 7, 22 | h_house_cottage_1_2 | illustrated cottage house, part col 1 row 2 (joins neighbouring cells) |
| 0, 23 | h_house_cottage_2_2 | illustrated cottage house, part col 2 row 2 (joins neighbouring cells) |
| 1, 23 | h_house_cottage_3_2 | illustrated cottage house, part col 3 row 2 (joins neighbouring cells) |
| 2, 23 | h_house_cottage_4_2 | illustrated cottage house, part col 4 row 2 (joins neighbouring cells) |
| 3, 23 | h_house_cottage_0_3 | illustrated cottage house, part col 0 row 3 (joins neighbouring cells) |
| 4, 23 | h_house_cottage_1_3 | illustrated cottage house, part col 1 row 3 (joins neighbouring cells) |
| 5, 23 | h_house_cottage_2_3 | illustrated cottage house, part col 2 row 3 (joins neighbouring cells) |
| 6, 23 | h_house_cottage_3_3 | illustrated cottage house, part col 3 row 3 (joins neighbouring cells) |
| 7, 23 | h_house_cottage_4_3 | illustrated cottage house, part col 4 row 3 (joins neighbouring cells) |
| 0, 24 | h_house_cottage_0_4 | illustrated cottage house, part col 0 row 4 (joins neighbouring cells) |
| 1, 24 | h_house_cottage_1_4 | illustrated cottage house, part col 1 row 4 (joins neighbouring cells) |
| 2, 24 | h_house_cottage_2_4 | illustrated cottage house, part col 2 row 4 (joins neighbouring cells) |
| 3, 24 | h_house_cottage_3_4 | illustrated cottage house, part col 3 row 4 (joins neighbouring cells) |
| 4, 24 | h_house_cottage_4_4 | illustrated cottage house, part col 4 row 4 (joins neighbouring cells) |
| 5, 24 | h_house_library_0_0 | illustrated library house, part col 0 row 0 (joins neighbouring cells) |
| 6, 24 | h_house_library_1_0 | illustrated library house, part col 1 row 0 (joins neighbouring cells) |
| 7, 24 | h_house_library_2_0 | illustrated library house, part col 2 row 0 (joins neighbouring cells) |
| 0, 25 | h_house_library_3_0 | illustrated library house, part col 3 row 0 (joins neighbouring cells) |
| 1, 25 | h_house_library_4_0 | illustrated library house, part col 4 row 0 (joins neighbouring cells) |
| 2, 25 | h_house_library_0_1 | illustrated library house, part col 0 row 1 (joins neighbouring cells) |
| 3, 25 | h_house_library_1_1 | illustrated library house, part col 1 row 1 (joins neighbouring cells) |
| 4, 25 | h_house_library_2_1 | illustrated library house, part col 2 row 1 (joins neighbouring cells) |
| 5, 25 | h_house_library_3_1 | illustrated library house, part col 3 row 1 (joins neighbouring cells) |
| 6, 25 | h_house_library_4_1 | illustrated library house, part col 4 row 1 (joins neighbouring cells) |
| 7, 25 | h_house_library_0_2 | illustrated library house, part col 0 row 2 (joins neighbouring cells) |
| 0, 26 | h_house_library_1_2 | illustrated library house, part col 1 row 2 (joins neighbouring cells) |
| 1, 26 | h_house_library_2_2 | illustrated library house, part col 2 row 2 (joins neighbouring cells) |
| 2, 26 | h_house_library_3_2 | illustrated library house, part col 3 row 2 (joins neighbouring cells) |
| 3, 26 | h_house_library_4_2 | illustrated library house, part col 4 row 2 (joins neighbouring cells) |
| 4, 26 | h_house_library_0_3 | illustrated library house, part col 0 row 3 (joins neighbouring cells) |
| 5, 26 | h_house_library_1_3 | illustrated library house, part col 1 row 3 (joins neighbouring cells) |
| 6, 26 | h_house_library_2_3 | illustrated library house, part col 2 row 3 (joins neighbouring cells) |
| 7, 26 | h_house_library_3_3 | illustrated library house, part col 3 row 3 (joins neighbouring cells) |
| 0, 27 | h_house_library_4_3 | illustrated library house, part col 4 row 3 (joins neighbouring cells) |
| 1, 27 | h_house_library_0_4 | illustrated library house, part col 0 row 4 (joins neighbouring cells) |
| 2, 27 | h_house_library_1_4 | illustrated library house, part col 1 row 4 (joins neighbouring cells) |
| 3, 27 | h_house_library_2_4 | illustrated library house, part col 2 row 4 (joins neighbouring cells) |
| 4, 27 | h_house_library_3_4 | illustrated library house, part col 3 row 4 (joins neighbouring cells) |
| 5, 27 | h_house_library_4_4 | illustrated library house, part col 4 row 4 (joins neighbouring cells) |
| 6, 27 | h_house_observatory_0_0 | illustrated observatory house, part col 0 row 0 (joins neighbouring cells) |
| 7, 27 | h_house_observatory_1_0 | illustrated observatory house, part col 1 row 0 (joins neighbouring cells) |
| 0, 28 | h_house_observatory_2_0 | illustrated observatory house, part col 2 row 0 (joins neighbouring cells) |
| 1, 28 | h_house_observatory_3_0 | illustrated observatory house, part col 3 row 0 (joins neighbouring cells) |
| 2, 28 | h_house_observatory_4_0 | illustrated observatory house, part col 4 row 0 (joins neighbouring cells) |
| 3, 28 | h_house_observatory_0_1 | illustrated observatory house, part col 0 row 1 (joins neighbouring cells) |
| 4, 28 | h_house_observatory_1_1 | illustrated observatory house, part col 1 row 1 (joins neighbouring cells) |
| 5, 28 | h_house_observatory_2_1 | illustrated observatory house, part col 2 row 1 (joins neighbouring cells) |
| 6, 28 | h_house_observatory_3_1 | illustrated observatory house, part col 3 row 1 (joins neighbouring cells) |
| 7, 28 | h_house_observatory_4_1 | illustrated observatory house, part col 4 row 1 (joins neighbouring cells) |
| 0, 29 | h_house_observatory_0_2 | illustrated observatory house, part col 0 row 2 (joins neighbouring cells) |
| 1, 29 | h_house_observatory_1_2 | illustrated observatory house, part col 1 row 2 (joins neighbouring cells) |
| 2, 29 | h_house_observatory_2_2 | illustrated observatory house, part col 2 row 2 (joins neighbouring cells) |
| 3, 29 | h_house_observatory_3_2 | illustrated observatory house, part col 3 row 2 (joins neighbouring cells) |
| 4, 29 | h_house_observatory_4_2 | illustrated observatory house, part col 4 row 2 (joins neighbouring cells) |
| 5, 29 | h_house_observatory_0_3 | illustrated observatory house, part col 0 row 3 (joins neighbouring cells) |
| 6, 29 | h_house_observatory_1_3 | illustrated observatory house, part col 1 row 3 (joins neighbouring cells) |
| 7, 29 | h_house_observatory_2_3 | illustrated observatory house, part col 2 row 3 (joins neighbouring cells) |
| 0, 30 | h_house_observatory_3_3 | illustrated observatory house, part col 3 row 3 (joins neighbouring cells) |
| 1, 30 | h_house_observatory_4_3 | illustrated observatory house, part col 4 row 3 (joins neighbouring cells) |
| 2, 30 | h_house_observatory_0_4 | illustrated observatory house, part col 0 row 4 (joins neighbouring cells) |
| 3, 30 | h_house_observatory_1_4 | illustrated observatory house, part col 1 row 4 (joins neighbouring cells) |
| 4, 30 | h_house_observatory_2_4 | illustrated observatory house, part col 2 row 4 (joins neighbouring cells) |
| 5, 30 | h_house_observatory_3_4 | illustrated observatory house, part col 3 row 4 (joins neighbouring cells) |
| 6, 30 | h_house_observatory_4_4 | illustrated observatory house, part col 4 row 4 (joins neighbouring cells) |
| 7, 30 | h_house_treasury_0_0 | illustrated treasury house, part col 0 row 0 (joins neighbouring cells) |
| 0, 31 | h_house_treasury_1_0 | illustrated treasury house, part col 1 row 0 (joins neighbouring cells) |
| 1, 31 | h_house_treasury_2_0 | illustrated treasury house, part col 2 row 0 (joins neighbouring cells) |
| 2, 31 | h_house_treasury_3_0 | illustrated treasury house, part col 3 row 0 (joins neighbouring cells) |
| 3, 31 | h_house_treasury_4_0 | illustrated treasury house, part col 4 row 0 (joins neighbouring cells) |
| 4, 31 | h_house_treasury_0_1 | illustrated treasury house, part col 0 row 1 (joins neighbouring cells) |
| 5, 31 | h_house_treasury_1_1 | illustrated treasury house, part col 1 row 1 (joins neighbouring cells) |
| 6, 31 | h_house_treasury_2_1 | illustrated treasury house, part col 2 row 1 (joins neighbouring cells) |
| 7, 31 | h_house_treasury_3_1 | illustrated treasury house, part col 3 row 1 (joins neighbouring cells) |
| 0, 32 | h_house_treasury_4_1 | illustrated treasury house, part col 4 row 1 (joins neighbouring cells) |
| 1, 32 | h_house_treasury_0_2 | illustrated treasury house, part col 0 row 2 (joins neighbouring cells) |
| 2, 32 | h_house_treasury_1_2 | illustrated treasury house, part col 1 row 2 (joins neighbouring cells) |
| 3, 32 | h_house_treasury_2_2 | illustrated treasury house, part col 2 row 2 (joins neighbouring cells) |
| 4, 32 | h_house_treasury_3_2 | illustrated treasury house, part col 3 row 2 (joins neighbouring cells) |
| 5, 32 | h_house_treasury_4_2 | illustrated treasury house, part col 4 row 2 (joins neighbouring cells) |
| 6, 32 | h_house_treasury_0_3 | illustrated treasury house, part col 0 row 3 (joins neighbouring cells) |
| 7, 32 | h_house_treasury_1_3 | illustrated treasury house, part col 1 row 3 (joins neighbouring cells) |
| 0, 33 | h_house_treasury_2_3 | illustrated treasury house, part col 2 row 3 (joins neighbouring cells) |
| 1, 33 | h_house_treasury_3_3 | illustrated treasury house, part col 3 row 3 (joins neighbouring cells) |
| 2, 33 | h_house_treasury_4_3 | illustrated treasury house, part col 4 row 3 (joins neighbouring cells) |
| 3, 33 | h_house_treasury_0_4 | illustrated treasury house, part col 0 row 4 (joins neighbouring cells) |
| 4, 33 | h_house_treasury_1_4 | illustrated treasury house, part col 1 row 4 (joins neighbouring cells) |
| 5, 33 | h_house_treasury_2_4 | illustrated treasury house, part col 2 row 4 (joins neighbouring cells) |
| 6, 33 | h_house_treasury_3_4 | illustrated treasury house, part col 3 row 4 (joins neighbouring cells) |
| 7, 33 | h_house_treasury_4_4 | illustrated treasury house, part col 4 row 4 (joins neighbouring cells) |

## ui.png  (8 x 5 cells = 1024 x 640)

| cell (col, row) | sprite | what to draw |
| --- | --- | --- |
| 0, 0 | i_coin | coin icon |
| 1, 0 | i_gem | gem icon |
| 2, 0 | i_heart | heart icon |
| 3, 0 | i_star | star icon |
| 4, 0 | i_scroll | scroll icon |
| 5, 0 | i_hammer | hammer icon |
| 6, 0 | i_key | key icon |
| 7, 0 | i_crown | crown icon |
| 0, 1 | i_eye | eye icon |
| 1, 1 | i_chat | chat icon |
| 2, 1 | i_bolt | bolt icon |
| 3, 1 | i_gear | gear icon |
| 4, 1 | i_trophy | trophy icon |
| 5, 1 | i_home | home icon |
| 6, 1 | i_book | book icon |
| 7, 1 | i_leaf | leaf icon |
| 0, 2 | i_flame | flame icon |
| 1, 2 | i_flag | flag icon |
| 2, 2 | i_users | users icon |
| 3, 2 | i_dice | dice icon |
| 4, 2 | i_frame_common | common rarity badge frame (ring with an empty centre) |
| 5, 2 | i_frame_uncommon | uncommon rarity badge frame (ring with an empty centre) |
| 6, 2 | i_frame_rare | rare rarity badge frame (ring with an empty centre) |
| 7, 2 | i_frame_epic | epic rarity badge frame (ring with an empty centre) |
| 0, 3 | i_frame_legendary | legendary rarity badge frame (ring with an empty centre) |
| 1, 3 | i_frame_mythic | mythic rarity badge frame (ring with an empty centre) |
| 2, 3 | i_emblem_0 | generic achievement emblem |
| 3, 3 | i_emblem_1 | generic achievement emblem |
| 4, 3 | i_emblem_2 | generic achievement emblem |
| 5, 3 | i_emblem_3 | generic achievement emblem |
| 6, 3 | i_emblem_4 | generic achievement emblem |
| 7, 3 | i_emblem_5 | generic achievement emblem |
| 0, 4 | i_emblem_6 | generic achievement emblem |
| 1, 4 | i_emblem_7 | generic achievement emblem |

## Everything else

- **Atmosphere:** the light of the world (dawn, dusk, night, lamps) is the only coded graphic. Its colours are in packs/core/scenery.yaml (lighting).
- **Sprites a sheet does not name** (a prop or emblem designed for one world) reuse a generic cell: `p_generic_*` for props, `i_emblem_*` for emblems.
- **Colour variants** (`..._v1`, `..._v2`) fall back to the base sprite when they have no cell of their own.
