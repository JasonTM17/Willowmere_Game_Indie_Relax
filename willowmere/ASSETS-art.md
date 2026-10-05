# ASSETS-art.md — willowmere art files

Tất cả file art của game, kèm nguồn gốc và license. **Chỉ dùng tài nguyên
CC0 / public domain** (đã kiểm tra trang nguồn và/hoặc file License.txt
đi kèm từng gói). Tile 32px đúng DESIGN.md; sprite 16px gốc được phóng
2x nearest-neighbor (không làm mờ).

## Bảng tổng hợp

| File | Nguồn (pack) | URL nguồn | License | Tác giả | Dùng để làm gì |
|---|---|---|---|---|---|
| `assets/art/tiles.png` | Kenney Tiny Town + Kenney Roguelike/RPG pack | https://kenney.nl/assets/tiny-town · https://kenney.nl/assets/roguelike-rpg-pack | CC0 | Kenney | Terrain 8×4 ô 32px: cỏ, hoa, đường đất, nước (4 frame anim), viền nước, cát, đá, vách, đất rừng, cầu, đồi, bọt biển |
| `assets/art/decor.png` | Kenney Tiny Town | https://kenney.nl/assets/tiny-town | CC0 | Kenney | Cây lớn (willow_big), cây mùa thu (willow_small), thông (pine), bụi cây, sậy, đá, hoa |
| `assets/art/chars.png` | Puny Characters (OpenGameArt) | https://opengameart.org/content/puny-characters | CC0 | shade-1 | 9 nhân vật đi 4 hướng (xuống/trái/phải/lên) × 3 frame bước chân, khung 32×48 |
| `assets/art/props.png` | Kenney Tiny Town + Tiny Farm + Roguelike/RPG pack | https://kenney.nl/assets/tiny-town · https://kenney.nl/assets/tiny-farm · https://kenney.nl/assets/roguelike-rpg-pack | CC0 | Kenney | Nhà (bakery/shop/cottage), giếng, bảng tin, lều, hải đăng, nhà kính, túp lều, đống đổ nát, hàng rào, thuyền, tổ ong, cổng, rơm, cừu… |
| `assets/art/ui.png` | Kenney Pixel UI pack + N64 Hearts + Weather Icons + Tiny Town/Farm/Roguelike | https://kenney.nl/assets/pixel-ui-pack · https://opengameart.org/content/n64-hearts · https://opengameart.org/content/weather-icons | CC0 | Kenney / n64guy / firefly-in-the-dusk | Panel 9-slice, tim đầy/rỗng, icon công cụ & thời tiết, icon vật phẩm, hình nhỏ thú |

Ghi chú license chi tiết theo gói (trích License.txt đi kèm zip):
Kenney Tiny Town / Tiny Farm / Roguelike-RPG / Pixel UI —
"License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/".
Puny Characters, N64 Hearts, Weather Icons — trang OpenGameArt ghi
"License(s): CC0" (đã fetch trực tiếp trang, ngày 2026-10-05).

## Bố cục từng sheet (tọa độ pixel, gốc trên-trái)

### tiles.png — 256×128, lưới 8×4 ô 32px

Hàng 0: `grass_0 (0,0)` · `grass_1 (32,0)` · `grass_2 (64,0)` · `grass_3 (96,0)` ·
`grass_flower (128,0)` · `path_0 (160,0)` · `path_1 (192,0)` · `path_2 (224,0)`
Hàng 1: `water_0 (0,32)` · `water_1 (32,32)` · `water_2 (64,32)` · `water_3 (96,32)` ·
`water_edge (128,32)` · `sand_0 (160,32)` · `sand_1 (192,32)` · `stone (224,32)`
Hàng 2: `stone_2 (0,64)` · `cliff_0 (32,64)` · `cliff_1 (64,64)` · `forest_floor_0 (96,64)` ·
`forest_floor_1 (128,64)` · `bridge_h (160,64)` · `bridge_v (192,64)` · `trail_dirt (224,64)`
Hàng 3: `hill_grass (0,96)` · `hill_rock (32,96)` · `terrace_edge (64,96)` · `sea_foam (96,96)` ·
còn trống (trong suốt).

- `water_0..3` = 4 khung hình animation (lấp lánh khác vị trí), cycle theo thứ tự 0→3.
- `bridge_v` là `bridge_h` xoay 90°.

### decor.png — 352×128 (anchor bottom-centre cho mọi prop)

| Prop | Rect (x,y,w,h) | Nguồn bên trong pack |
|---|---|---|
| willow_big | 0,0,96,128 | cụm 3 cây thông Tiny Town (ô 4,0–4,2) xếp chồng |
| willow_small | 96,0,64,96 | cây mùa thu Tiny Town (ô 3,0–3,2) |
| pine | 160,0,64,96 | cây thông Tiny Town (ô 4,0–4,2), căn giữa |
| bush | 224,0,32,32 | Tiny Farm ô (3,3) |
| reeds | 256,0,32,64 | Roguelike ô (22,10) chồng 2 lớp |
| rock | 288,0,32,32 | Roguelike ô (5,12) |
| flowers | 320,0,32,32 | Roguelike ô (25,11) hoa cúc |

### chars.png — 384×432, 9 hàng × 12 cột, khung 32×48

Thứ tự hướng trong mỗi hàng: **xuống (0–2), trái (3–5), phải (6–8), lên (9–11)**,
mỗi hướng 3 frame bước chân (frame 0 = frame đứng khi đứng yên).

| Hàng | Nhân vật | Sheet nguồn (Puny Characters) |
|---|---|---|
| 0 | player (áo xanh ngọc) | Mage-Cyan |
| 1 | NPC | Mage-Red |
| 2 | NPC | Soldier-Blue |
| 3 | NPC | Soldier-Red |
| 4 | NPC | Soldier-Yellow |
| 5 | NPC | Warrior-Blue |
| 6 | NPC | Warrior-Red |
| 7 | NPC | Archer-Green |
| 8 | NPC | Archer-Purple |

Frame lấy từ hàng walk của sheet gốc (R0 = xuống, R2 = trái, R6 = phải, R4 = lên),
cột 0–2, crop sát hình rồi phóng ×2 nearest, neo đáy-giữa khung 32×48.

### props.png — 512×416 (bố cục khớp `PROP_CELLS` trong `js/world.js`)

| Prop | Rect (x,y,w,h) | Nguồn |
|---|---|---|
| house_bakery | 0,0,128,96 | mái đỏ Tiny Town (ô 4,4–7,4 / 4,6–7,7) |
| shop | 128,0,128,96 | mái xanh Tiny Town (ô 0,4–3,4 / 0,6–3,7) |
| cottage_a | 256,0,96,96 | nhà mái xanh (bỏ 1 hàng mái lặp) |
| cottage_b | 352,0,96,96 | nhà mái đỏ |
| cottage_c | 0,96,96,96 | cottage_b **lật ngang** |
| well | 96,96,64,64 | Tiny Town ô (8,7) mái + (8,8) thân giếng |
| notice_board | 160,96,64,64 | ván gỗ Roguelike (37,21)+(38,21)… + biển Tiny Town (11,6) |
| tent | 224,96,64,64 | lều xanh Roguelike (46,10)–(47,11) |
| bench | 288,96,32,32 | ghế Tiny Farm (3,6) |
| torch | 320,96,32,32 | đuốc Roguelike (17,7) |
| lamp_post | 352,96,32,32 | chân nến Roguelike (21,8) — thế chỗ cột đèn |
| sign | 384,96,32,32 | biển gỗ Tiny Town (11,6) |
| fence_h | 416,96,32,32 | hàng rào ngang Tiny Town (9,3) |
| fence_v | 448,96,32,32 | cột rào dọc Tiny Town (11,4) |
| pier_plank | 480,96,32,32 | dầm gỗ Tiny Town (9,6) |
| lighthouse | 0,192,96,192 | tháp đá Roguelike (28,16)/(28,18)/(28,19) ×3 cột + đốm lửa (17,7) trên đỉnh |
| boat | 0,192,64,32 | máng nước Tiny Farm (2,9) — **đè lên góc trên-trái lighthouse** vì world.js map boat và lighthouse cùng (0,6); world.js chỉ blit theo rect của từng prop nên cả hai đều dùng được |
| greenhouse | 96,192,128,96 | ô kính Roguelike (46,0)/(47,0)/(47,1) |
| hut | 224,192,96,64 | mái + vách chuồng Tiny Farm (6,7)–(8,8) |
| sheep | 224,256,32,32 | cừu Tiny Farm (0,10) — sprite gốc tĩnh, world.js chỉ dùng 1 ô nên không tách 3 frame |
| gate | 320,256,32,32 | cánh cổng X Tiny Farm (7,10) |
| hay | 352,256,32,32 | rơm Tiny Farm (0,8) |
| windmill_ruin | 384,256,96,128 | tường tan nát Roguelike (34,16)–(36,16) + (34,19)–(36,21) |
| hive | 0,384,32,32 | tổ ong Tiny Town (10,7) |

## Ghi chú trung thực (substitution & ô trống)

- **Không có sprite nguyên bản CC0** cho: lighthouse, greenhouse, windmill_ruin,
  notice_board — các slot này được **lắp từ tile CC0 có sẵn** như bảng trên; muốn
  đẹp hơn thì thay sau.
- `boat` = máng nước gỗ (trông gần nhất với thuyền trong nguồn có sẵn); theo map
  của `js/world.js`, boat và lighthouse cùng gốc (0,6) nên boat được vẽ đè lên
  góc trên-trái lighthouse trong sheet — world.js blit theo rect riêng của từng
  prop nên trong game cả hai đều hiển thị đúng.
- `lamp_post` = chân nến cao; `net` = liềm; `rod` = cành gỗ cong; `sling` = cung —
  thế chỗ gần nghĩa nhất, đã ghi trong ui.png.
- **Ô trống (trong suốt, cố ý):** `ui.png` icon `kite (96,64)` và **cả 6 ô cá**
  (y=96) — không tìm thấy sprite cá CC0 phù hợp sau khi rà Kenney (không có pack
  cá) và OpenGameArt lọc CC0; HUD sẽ hiển thị ô rỗng, game vẫn chạy (fallback).
- Mọi hiệu chỉnh ngoài ghép/lật/xoay/phóng 2x: icon `moon` = icon mặt trời
  (Weather Icons) **đổi màu** sang xanh nhạt; icon `E-chip` = nút trống Pixel UI.
