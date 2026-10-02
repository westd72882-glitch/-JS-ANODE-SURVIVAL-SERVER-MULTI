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
TEXTURES.tex_rockore = "assets/images/Rock_Stone_Tex.webp";   // руда камня
TEXTURES.tex_sulfur  = "assets/images/Sulfur_Ore_Tex.webp";   // серная руда
TEXTURES.tex_metal   = "assets/images/Metal_Ore_Tex.webp";    // металлическая руда
TEXTURES.tex_wood    = "assets/images/wood.webp";             // доски/рукоять
TEXTURES.tex_plank   = "assets/images/Wall_Wood_0.webp";

/* ---------- Иконки предметов (только для UI) ---------- */
TEXTURES.icon_wood = "1/wood.webp";
TEXTURES.icon_stone = "1/stone.webp";
TEXTURES.icon_sulfur = "1/sulfur.webp";
TEXTURES.icon_metal = "1/metal.webp";
TEXTURES.icon_scrap = "1/scrap.webp";
TEXTURES.icon_gunpowder = "1/gunpowder.webp";
TEXTURES.icon_axe = "1/axe.webp";
TEXTURES.icon_pickaxe = "1/pickaxe.webp";
TEXTURES.icon_furnace = "assets/images/Furnace_0.webp";
TEXTURES.icon_wall    = "assets/images/Wall_Category.webp";
TEXTURES.icon_crate   = "assets/images/Crate.webp";

TEXTURES.crit_marker = "1/CriticalHit_Marker.webp";

TEXTURES.icon_pumpkin = "1/pumpkin.webp";
TEXTURES.icon_meat = "1/meat.webp";
TEXTURES.sprite_pumpkin = "assets/pack/sprites/pumpkin.webp";
TEXTURES.tex_water = "assets/pack/sprites/water.webp";

/* ---------- Новые иконки (v8) ---------- */
[["hammer","hammer"],["mdoor","door_metal"],["scrap","scrap"],["plan","building_plan"],["bag","sleeping_bag"],["door","door"],["locker","locker"],["chest","chest_military"],
 ["satchel","satchel"],["backpack","backpack"],["spear","spear"],["helm_rusty","helmet_rusty"],["helm_home","helmet_homemade"],
 ["sheet","component_sheetmetal"],["gear","component_gear"],["pipe","component_pipe"],["fuel","fuel"],["nails","nail_ammo"],
 ["nailgun","nailgun"],["pistol","pistol"],["workbench","workbench"],["armor","chest_military"],["can","component_can"],
 ["body","component_body"],["ammo556","ammo556"],["ammo","ammo"],["rifle","assault_rifle"],["cloth","cloth"],["ammo_rifle","ammo_rifle"],["ammo_pistol","ammo_pistol"],["berdanka","berdanka"],["smg","smg"],["furnace2","quarry"],["turret","turret"]
].forEach(function(p){ TEXTURES["icon_"+p[0]] = "1/"+p[1]+".webp"; });
TEXTURES.icon_map = "1/map-button.webp";

/* UI-иконки, которые тоже нужно прогреть при загрузке */
window.EXTRA_IMAGES = ["1/menu-bg-update.webp","1/menu-news.webp","1/base-joystick.webp","1/stick-joystick.webp","1/inventory-button.webp","1/crafting-button.webp","1/build_button.webp","1/strike-button.webp","1/jump-button.webp","1/coin.webp","1/default-avatar.webp","1/CriticalHit_Marker.webp"];
TEXTURES.icon_door     = TEXTURES.icon_door || "assets/images/Door_Category.webp";
TEXTURES.icon_cupboard = "1/locker.webp";
TEXTURES.icon_startrock = "1/start_rock.webp";
TEXTURES.tex_rustdoor = "1/door_metal.webp";
TEXTURES.icon_box      = "assets/images/Crate.webp";
