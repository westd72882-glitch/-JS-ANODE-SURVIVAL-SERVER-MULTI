/* =====================================================================
   TEXTURES — карта файлов.
   ВАЖНО: тут два РАЗНЫХ набора, они не должны смешиваться:
   1) 3D-ТЕКСТУРЫ (tex_*)  — бесшовные, кладутся на модели в мире
   2) ИКОНКИ (icon_*)      — картинки предметов для инвентаря/хотбара
   ===================================================================== */
const TEXTURES = {};

/* ---------- 3D-текстуры (только для мешей) ---------- */
TEXTURES.tex_grass   = "assets/images/Grass_02.webp";
TEXTURES.tex_dirt    = "assets/images/Dirt_01.webp";
TEXTURES.tex_sand    = "assets/images/T_Ground_Sand_02_A_Sm.webp";
TEXTURES.tex_road    = "assets/images/T_field_road_01_A_T.webp";
TEXTURES.tex_bark    = "assets/images/Trunk.webp";            // кора ствола
TEXTURES.tex_foliage = "assets/images/Foliage_Tex.webp";      // хвоя
TEXTURES.tex_leaf    = "assets/images/Leaf_Tex.webp";         // лиственная крона
TEXTURES.tex_stone   = "assets/images/Rock_Stone_Tex.webp";   // камень
TEXTURES.tex_sulfur  = "assets/images/Sulfur_Ore_Tex.webp";   // серная руда
TEXTURES.tex_metal   = "assets/images/Metal_Ore_Tex.webp";    // металлическая руда
TEXTURES.tex_wood    = "assets/images/wood.webp";             // доски/рукоять
TEXTURES.tex_plank   = "assets/images/Wall_Wood_0.webp";

/* ---------- Иконки предметов (только для UI) ---------- */
TEXTURES.icon_wood = "assets/pack/icons/wood.webp";
TEXTURES.icon_stone = "assets/pack/icons/stone.webp";
TEXTURES.icon_sulfur = "assets/pack/icons/sulfur.webp";
TEXTURES.icon_metal = "assets/pack/icons/metal.webp";
TEXTURES.icon_scrap = "assets/pack/icons/scrap.webp";
TEXTURES.icon_gunpowder = "assets/pack/icons/gunpowder.webp";
TEXTURES.icon_axe = "assets/pack/icons/axe.webp";
TEXTURES.icon_pickaxe = "assets/pack/icons/pickaxe.webp";
TEXTURES.icon_furnace = "assets/images/Furnace_0.webp";
TEXTURES.icon_wall    = "assets/images/Wall_Category.webp";
TEXTURES.icon_crate   = "assets/images/Crate.webp";

TEXTURES.crit_marker = "assets/icons/CriticalHit_Marker.webp";

TEXTURES.icon_pumpkin = "assets/pack/icons/pumpkin.webp";
TEXTURES.icon_meat = "assets/pack/icons/meat.webp";
TEXTURES.sprite_pumpkin = "assets/pack/sprites/pumpkin.webp";
TEXTURES.tex_water = "assets/pack/sprites/water.webp";

/* ---------- Новые иконки (v8) ---------- */
[["scrap","scrap"],["plan","building_plan"],["bag","sleeping_bag"],["door","door"],["locker","locker"],["chest","chest_military"],
 ["satchel","satchel"],["backpack","backpack"],["spear","spear"],["helm_rusty","helmet_rusty"],["helm_home","helmet_homemade"],
 ["sheet","component_sheetmetal"],["gear","component_gear"],["pipe","component_pipe"],["fuel","fuel"],["nails","nail_ammo"],
 ["nailgun","nailgun"],["pistol","pistol"],["workbench","workbench"],["armor","chest_military"],["can","component_can"],
 ["body","component_body"],["ammo556","ammo556"],["ammo","ammo"],["rifle","assault_rifle"],["cloth","cloth"],["ammo_rifle","ammo_rifle"],["ammo_pistol","ammo_pistol"],["berdanka","berdanka"],["furnace2","quarry"],["turret","turret"]
].forEach(function(p){ TEXTURES["icon_"+p[0]] = "assets/pack/icons/"+p[1]+".webp"; });
TEXTURES.icon_map = "assets/icons/map-button.webp";

/* UI-иконки, которые тоже нужно прогреть при загрузке */
window.EXTRA_IMAGES = ["assets/icons/menu-bg-update.webp","assets/icons/base-joystick.webp","assets/icons/stick-joystick.webp","assets/icons/inventory-button.webp","assets/icons/crafting-button.webp","assets/icons/build_button.webp","assets/icons/strike-button.webp","assets/icons/jump-button.webp","assets/icons/coin.webp","assets/icons/default-avatar.webp","assets/icons/CriticalHit_Marker.webp"];
