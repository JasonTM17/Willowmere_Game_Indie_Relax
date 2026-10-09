# 🏮 Willowmere

Một cuộc phiêu lưu ấm áp (cozy adventure) bên hồ, chạy thẳng trong trình duyệt —
không cần cài đặt, không cần mạng.

## Giới thiệu

Willowmere là một xóm làng nhỏ ven hồ, nơi ngọn hải đăng đã tắt suốt hai năm —
kể từ ngày ông giữ đèn già Marlow lặng lẽ đi vào vùng đồi mang theo một mặc cảm
chưa từng kể. Bạn đến như người Quản lí (Warden) mới: được trao căn nhà gỗ cũ
của Marlow, một khu vườn hoang, và một danh sách dài những việc tử tế nhỏ.

Ở Willowmere, bạn thắp sáng ngọn đèn bằng cách thắp sáng con người: cùng Mira
nướng bánh, cùng Finn câu cá, cùng Bramble dẫn đàn cừu qua đồi. Khi bốn **Ember
Light** — ánh than hồng của lòng tốt — đủ sáng trong chiếc đèn lồng của bạn,
hãy leo lên tháp vào một đêm và tự quyết định ai sẽ thắp lại ngọn lửa.

- **Không có thất bại.** Không có đồng hồ chết người, không thể thua, không có
  "game over" — mọi hành động đều kết thúc bằng một điều dịu dàng.
- **Làng sống cả khi bạn vắng mặt.** 8 dân làng đi lại theo lịch riêng từng
  giờ, trò chuyện với nhau bằng bong bóng thoại mà bạn có thể lại gần để nghe.
- **Thế giới đổi màu theo giờ.** Ngày game dài ~8 phút, mưa từ ngày thứ hai,
  đom đóm, lá rơi, bóng mây trôi, và 5 điểm ngắm cảnh mở ra như tấm bưu thiếp.

## Cách chơi

1. Mở thư mục `willowmere/`.
2. **Double-click vào `index.html`** — game mở trong trình duyệt mặc định.
   Không cần cài đặt gì thêm, không cần server, không cần internet.
3. Chọn **New Game** (hoặc **Continue** nếu đã từng ngủ/lưu).

> Tất cả dữ liệu (hội thoại, nhiệm vụ, bản đồ) nằm trong các file `js/*.js`
> và hình ảnh/nhạc trong `assets/` — mọi thứ chạy từ ổ đĩa cục bộ. Trò chơi
> vẫn chạy được (thế giới màu phẳng, im lặng) ngay cả khi thư mục `assets/`
> bị bỏ trống.

## Điều khiển

| Phím | Hành động |
|---|---|
| `W A S D` / phím mũi tên | Di chuyển |
| `E` / `Enter` / `Space` | Tương tác · nói chuyện · xác nhận · tặng quà |
| `Q` | Vung lưới bắt côn trùng (vòng cung theo hướng đứng) |
| `F` | Câu cá (đứng gần mặt nước) — nhấn lần 1 thả phao, nhấn lần 2 khi cá cắn, lần 3 giữ thanh timing |
| Chuột (di + click) | Nỏ cao su: ngắm con trỏ, click bắn đá — nổ **mote** (quả cầu sáng liu riu); bắn vào cây làm rung rụng lá/côn trùng |
| `↑` `↓` (+ `E`) | Chọn lựa chọn trong hộp thoại / menu |
| `Esc` / `P` | Tạm dừng (Resume · Save · Settings · Quit) |
| Phím mũi tên | Trong Settings: `←` `→` chỉnh âm lượng nhạc/SFX |

Nhắc lại trên HUD luôn hiển thị: `Q net · F rod · mouse sling`. Ngủ trong
giường (cửa nhà, từ 18:00) hoặc nút **Save** trong Pause để lưu tiến trình.

## Dân làng — 8 NPC

Mỗi NPC có lịch trong ngày riêng (đi thật sự từ nơi này sang nơi khác), thanh
thiện cảm 0–10 tim, món quà thích/không thích, và hội thoại mở khoá ở 3♥ / 6♥.

- **Mira Thistle** — thợ làm bánh, 28 tuổi, góc tây quảng trường. Nói ngọt như
  mật ong và lúc nào cũng dùng phép so sánh về đồ ăn ("Trông chị hơi bị ủ
  non, em à."). Có thể tìm thấy ở quầy bánh ban ngày và dạo cầu tàu buổi tối.
- **Gideon Root** — thầy thuốc thảo mộc kiêm người nuôi ong, 61 tuổi, nhà kính
  rìa rừng. Nói ngắn gọn, giọng khô như cành cây nhưng lòng ấm, toàn ẩn dụ
  về cây cối ("Đừng đụng vào cỏ xạ hương. Nó để ý em đấy.").
- **Rosa Quill** — cô giáo về hưu, 78 tuổi, ngôi nhà có vườn hoa lớn phía đông
  làng. Kể chuyện hay đi lạc đầu bằng "Hồi đó tôi còn trẻ…" và dành buổi sáng
  ở cầu tàu chỉ để cho vịt ăn.
- **Old Marlow** — người giữ đèn đã biến mất, 74 tuổi, túp lều gỗ trôi trên đồi.
  Thở dài dài, dùng ngôn ngữ thủy thủ, và mang một mặc cảm được giữ rất cẩn
  thận ("Người giữ đèn phải giữ. Tôi thì không."). Hay đứng nhìn lên tháp vào
  buổi tối.
- **Finn Marlow** — cháu trai của Marlow, 12 tuổi, nhà cạnh cầu tàu. Nói như
  súng liên thanh, líu lưỡi khi hào hứng, và tin rằng có một con cá huyền thoại
  "Siltjaw" đang ở dưới hồ ("To. Nhất. HỒ. Luôn!").
- **Hana Oak** — chủ cửa hàng kiêm bưu tá, 35 tuổi, ở tầng trên cửa hàng. Khẩu
  khí mặt lạnh một câu chốt ("Cảm xúc: hết hàng."), mỗi sáng đi đưa thư qua
  từng cửa nhà.
- **Bramble** — người chăn cừu trên đồi, 45 tuổi. Ít nói, hay ngân nga, đếm
  cừu thay vì dùng tính từ ("Hm. Mười bốn. Số đẹp."). Đàn cừu đi theo ông thật.
- **Junie Vale** — họa sĩ du mục, 24 tuổi, ở lều trên bãi biển. Nói bằng màu
  sắc như cảm xúc ("Bầu trời kia là một hơi thở đang nín."), cả ngày lang thang
  vẽ làng từ bãi biển đến đỉnh đồi.

Ngoài ra dân làng còn tự trò chuyện với nhau 8 cặp thoại nền (Mira ↔ Gideon
cãi nhau về giá mật ong 40 năm liền, Finn ↔ Rosa tranh luận con vịt nào tên
"Kevin"…). Đứng lại gần để nghe trọn trong bảng "overheard".

## Nhiệm vụ (không spoiler)

Nhiệm vụ chính — **The Dark Lamp of Willowmere** — mở ra từ ngày đầu khi Hana
trao chìa khóa nhà Marlow. Để chạm tới đêm leo tháp, bạn cần đủ goodwill của
cả làng.

Tám nhiệm vụ phụ, mỗi nhiệm vụ trao **1 Ember Light** và có **hai hướng kết**
do chính bạn chọn (cả hai đều nhẹ nhàng — không có lựa chọn "sai"):

| Nhiệm vụ | NPC | Tóm tắt câu hỏi đặt ra |
|---|---|---|
| The Honey Loaf | Mira | Bánh mật ong hay tổ ong rừng — chia sẻ hay trao đổi? |
| Seeds of Spring | Gideon | Túi hạt giống thất lạc trên đường đồi — trả lại hay tặng tiếp? |
| The Garden Show | Rosa | Đoạt giải bằng bông moonbell hái về, hay dạy bà kiên nhẫn? |
| The Big One | Finn | Giúp cậu bé câu được cá huyền thoại, hay thuyết phục cậu buông? |
| The Unaddressed Parcel | Hana | Bưu kiện không địa chỉ — mở ra hay truy tìm người gửi? |
| The Lost Lamb | Bramble | Chiên cừu lạc vào rừng ban đêm — bắt lưới lặng lẽ hay thắp đèn dẫn về? |
| Willowmere in Colour | Junie | Đưa họa sĩ xem 4 điểm ngắm — những gì bạn cho cô xem sẽ giữ cô ở lại hay tiễn cô đi? |
| The Keeper's Regret | Marlow | *(cần 3♥)* Buổi tối tại chân tháp, ông cuối cùng cũng chịu mở lòng |

Mẹo: tặng quà **yêu thích** có thể mở sớm một số nhiệm vụ (ví dụ tặng Gideon
một luna moth ban đêm trong rừng), nhiệm vụ `colors` chỉ hoàn thành khi bạn
đã ghé đủ các điểm ngắm cảnh (vista).

---

## ⚠️ CẢNH BÁO SPOILER — tuyến truyện và kết thúc

*Đọc tiếp chỉ khi bạn muốn biết trước các bước ngoặt.*

**Điều kiện leo tháp:** đủ **4 Ember Light** (4/8 nhiệm vụ phụ hoàn tất) **và**
Marlow đã thổ lộ (nhiệm vụ `keeper_regret`, cần 3♥) **và** giờ trong game
**20:00–24:00**. Chạm vào cửa hải đăng để leo lên.

**Lá thư trong kho gác (B2 — "Con thuyền mất tích"):** sau khi hoàn thành
nhiệm vụ Garden Show của Rosa (bất kỳ hướng nào), cửa kho gác của bà mở. Bên
trong là một lá thư cảm ơn của thuyền *Selkies* — sự thật là con thuyền của
đêm bão **không chìm**, nó trú an toàn trong vịnh. Bạn có thể:
- **Kể sự thật cho Marlow** → mặc cảm của ông tan hoàn toàn.
- **Giữ lại huyền thoại, chỉ cần ông có bạn** → câu chuyện lặng hơn, nhưng cùng
  ấm áp.

**Lá thăng — "Ai giữ ngọn đèn?" (B1):**
- **"Light it together."** → Marlow trở lại làm người giữ đèn, bạn là đồng
  Quản lí.
- **"This one's mine. Rest, old friend."** → đèn thuộc về bạn; Marlow cuối cùng
  cũng ngủ được, và bắt đầu để lại trà trước bậc cửa bạn.
- **"Let Finn strike the match."** *(chỉ hiện khi đã giúp Finn câu được
  Siltjaw)* → Finn, 12 tuổi, người giữ đèn trẻ nhất lịch sử hạt.

**Hai kết thúc** (hiệp hội từ các cờ lựa chọn của bạn, mỗi đoạn được ghép vào
bản tóm lược cuối game chỉ khi điều kiện tương ứng đúng):
- **"The Festival of First Light"** — cần sự thật được kể **và** (thắp chung
  *hoặc* Finn thắp). Cả làng mở lễ hội đom đóm và cờ rực, và Marlow bật cười ngay đúng khoảnh khắc.
- **"The Quiet Keeper"** — mọi nhánh còn lại (giữ bí mật, hoặc bạn giữ đèn).
  Một ánh đèn lặng hơn; làng dần kéo Marlow ra khỏi vỏ ốc, từng tách trà một.

Sau cảnh kết, nhấn `E — keep wandering` để tiếp tục chơi tự do: thế giới giữ
nguyên trạng thái mới (chùm sáng hải đăng quay đêm đêm, cờ hội trên quảng
trường nếu có lễ hội, bông moonbell phát sáng dưới chân tháp…).

## Mẹo thư giãn — chơi chậm thôi

- **Không cần vội.** Không có gì đếm ngược, không có gì trôi qua vĩnh viễn.
  Ngày game dài 8 phút; ngồi trên bãi cỏ nhìn mây trôi cũng là chơi game.
- Dừng lại ở **5 điểm ngắm cảnh** (vista) — camera tự zoom-out kèm caption;
  rời đi bằng bất kỳ phím di chuyển nào.
- Nghe **bong bóng thoại của NPC với nhau** — đứng lại gần cặp đang nói để đọc
  trọn đoạn trong bảng overheard.
- Mưa (từ ngày 2) có nhạc riêng, vệt mưa, gợn sóng — và Mira/Gideon/Rosa/Hana
  rút vào trong nhà; Finn, Marlow, Bramble vẫn ở ngoài vì "cá đâu có sợ mưa".
- **Ban đêm mới có** nhiều thứ: đom đóm (rừng 20:00–02:00), luna moth hiếm
  (rừng 21:00–02:00), glow worm (bãi biển 20:00–02:00), moonbell nở (rừng
  21:00–24:00), cá moonfish hiếm (nước ngọt 21:00–02:00).
- Tặng quà **một lần mỗi ngày mỗi người** mới có hiệu lực đầy đủ — món sau đó
  chỉ nhận được một câu khách sáo.
- Con trùng chạy trốn bạn luôn thua (bắt không thoát), cá cắn trượt chỉ tốn một
  cái nhún vai — thử lại thoải mái.
- Ngủ từ 18:00 để qua ngày mới và lưu; quên lưu thì nút Save trong Pause vẫn
  ở đó.
- **Chiếc tủ cũ cạnh nhà bạn** (bên phải cửa cottage) là một máy arcade kỳ lạ:
  nhấn `E` để chơi **Neon Swarm** — mini-game bắn súng neon do chính làng cất
  giữ. Làng đứng yên chờ bạn; thắng được trận DAWN bên trong thì cái tủ cũng
  ấm hơn một chút. (Cần mở qua HTTP server hoặc `file://` — bấm `✕ LEAVE` để
  về làng.)

## Credits — tài nguyên (toàn bộ CC0 / Public Domain)

Mọi art và nhạc trong `assets/` đều là tài nguyên **CC0** (đã kiểm tra trang
nguồn và/hoặc file License.txt đi kèm từng gói; chi tiết bố cục từng sheet ở
`ASSETS-art.md` và `ASSETS-audio.md`).

### Art — `assets/art/`

| File | Tác giả | Nguồn (pack) | License | URL |
|---|---|---|---|---|
| `tiles.png` | Kenney | Kenney Tiny Town + Roguelike/RPG pack | CC0 | https://kenney.nl/assets/tiny-town · https://kenney.nl/assets/roguelike-rpg-pack |
| `decor.png` | Kenney | Kenney Tiny Town | CC0 | https://kenney.nl/assets/tiny-town |
| `chars.png` | shade-1 | Puny Characters (OpenGameArt) | CC0 | https://opengameart.org/content/puny-characters |
| `props.png` | Kenney | Kenney Tiny Town + Tiny Farm + Roguelike/RPG pack | CC0 | https://kenney.nl/assets/tiny-town · https://kenney.nl/assets/tiny-farm · https://kenney.nl/assets/roguelike-rpg-pack |
| `ui.png` | Kenney · n64guy · firefly-in-the-dusk | Kenney Pixel UI pack + N64 Hearts + Weather Icons (+ Tiny Town/Farm/Roguelike) | CC0 | https://kenney.nl/assets/pixel-ui-pack · https://opengameart.org/content/n64-hearts · https://opengameart.org/content/weather-icons |

### Audio — `assets/audio/`

| File | Bản nhạc | Tác giả | License | URL |
|---|---|---|---|---|
| `day.mp3` | "Town Theme RPG" | cynicmusic | CC0 | https://opengameart.org/content/town-theme-rpg |
| `night.mp3` | "November Snow" | cynicmusic | CC0 | https://opengameart.org/content/november-snow |
| `rain.mp3` | "Rain (loopable)" | ylmir | CC0 | https://opengameart.org/content/rain-loopable |

Cảm ơn Kenney (kenney.nl) và cộng đồng OpenGameArt vì những gói tài nguyên
phi thường này.

## Ghi chú kỹ thuật

- **Chạy từ `file://`:** không dùng ES module, `fetch()`, XHR hay CDN — toàn
  bộ dữ liệu là các script `js/*.js` gắn vào `window.*` (13 file nạp đúng thứ
  tự trong `index.html`); hình ảnh qua `new Image()` với đường dẫn tương đối,
  nhạc qua `Audio` element `loop=true`.
- **Không dùng `getImageData`** trên canvas đã vẽ ảnh (tránh canvas bị taint
  trên `file://`); mọi hiệu ứng sáng/tông màu dùng gradient + composite ops.
- **Fallback toàn phần:** thiếu bất kỳ asset nào (kể cả `assets/` rỗng) game
  vẫn chạy — sprite thay bằng khối màu, nhạc im lặng, không báo lỗi console.
- **Âm thanh** chỉ khởi tạo `AudioContext` sau cú nhấn phím/click đầu tiên
  (chính sách autoplay của trình duyệt).
- **Lưu game:** 1 slot `willowmere_save` qua `localStorage` (qua `WU.save/load`
  có try/catch). Một số trình duyệt chặn storage trên `file://` — game vẫn
  chơi được, nút Continue sẽ tự ẩn.
- **Hiệu năng:** canvas 2D, DPR-aware, `imageSmoothingEnabled=false` cho pixel
  art sắc nét; giới hạn cứng: 40 côn trùng, 12 mote, 400 particle (mưa ≤300),
  vẽ tile chỉ trong khung nhìn. Tự tạm dừng khi tab mất focus.
- Bản đồ 128×96 tile (32 px), sinh cố định bằng seed — save/load tái dựng thế
  giới giống hệt.

---

## English (short)

**Willowmere** is a cozy lakeside adventure that runs entirely in your browser.
**To play: double-click `index.html` — no install, no server, no internet
needed.** Move with WASD/arrows, interact with `E`, net with `Q`, fish with
`F`, slingshot with mouse aim + click, pause with `Esc`/`P`. Befriend 8
villagers (each with an hourly schedule, gift tastes and unlocked dialogue),
finish any 4 of the 8 gentle two-outcome questlines to gather Ember Lights,
hear old Marlow's confession, then climb the dark lighthouse at night and
choose who relights the lamp — with two endings depending on a long-buried
truth you may tell or keep. There is no fail state, no timer and no combat;
save by sleeping (18:00+) or via the Pause menu. All art and music in
`assets/` are CC0 — full per-file credits in the tables above (sources:
Kenney, OpenGameArt). Technical: vanilla JS + Canvas 2D, 13 classic scripts
attaching to `window.*` globals, works from `file://`, silent vector fallback
if any asset is missing.
