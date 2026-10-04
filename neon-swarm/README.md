# NEON SWARM

Bạn là **ngọn đèn cuối cùng của lưới neon đã chết** — đứng giữa vòng tròn, hạ gục cả Swarm
không hồi kết và xếp chồng hỏa lực đến mức phi lý, cho đến khi chính lưới điện thu bạn về.

NEON SWARM là game sinh tồn đấu trường (arena survival) theo kiểu *survivors*: kẻ địch
xông đến từ mọi hướng, giết chúng để nhặt gem kinh nghiệm, lên cấp để chọn thẻ nâng cấp,
và sống sót qua các đợt sóng (wave) ngày càng dày — mỗi đợt thứ 5 sẽ có trùm
**SWARM SOVEREIGN** xuất hiện. Điểm số nhân theo combo; chết là kết thúc một lượt chơi
(run), highscore được lưu lại.

---

## Cách chơi

**Không cần cài đặt gì cả.** Chỉ cần:

1. Mở thư mục `neon-swarm/` trong File Explorer.
2. **Double-click vào `index.html`** — game chạy ngay trong trình duyệt qua `file://`.

Không cần server, không cần build, không cần cài dependency, không cần kết nối mạng.
Màn hình đầu tiên là menu TITLE: **click hoặc nhấn Enter/Space để bắt đầu**. Lưu ý âm thanh
chỉ khởi động sau lần tương tác đầu tiên (quy tắc autoplay của trình duyệt) — click một
lần là có tiếng.

Mục tiêu: sống lâu nhất có thể, giết nhiều nhất có thể, ghi điểm cao nhất.

---

## Bảng điều khiển

| Phím | Hành động |
|---|---|
| `WASD` hoặc các phím mũi tên | Di chuyển (đi chéo được chuẩn hóa) |
| Chuột | **Ngắm** — súng luôn hướng theo con trỏ |
| **Giữ chuột trái** | **Bắn** về phía con trỏ (bắn được khi di chuyển, đứng yên, thậm chí khi dash) |
| `Space` | **Dash** — phóng 0.18 s với tốc độ ×4.2, **bất tử 0.28 s**, hồi chiêu 2.5 s (vòng dash ở góc phải dưới) |
| `P` hoặc `Esc` | Tạm dừng / tiếp tục |
| `M` | Bật/tắt âm thanh (nhớ trạng thái) |
| `1` `2` `3` hoặc click | Chọn thẻ nâng cấp khi lên cấp |
| Click / `Enter` / `Space` | Bắt đầu ở menu TITLE |
| Click / `Enter` | Chơi lại ở GAME OVER · `T` quay về menu |
| `Q` (khi tạm dừng) | Thoát về menu TITLE |

Mất focus cửa sổ (alt-tab) → game tự tạm dừng.

---

## Các thẻ nâng cấp (16 thẻ, xếp chồng đến mức tối đa)

### Hỏa lực

| Thẻ | Hiệu quả mỗi tầng | Tối đa |
|---|---|---|
| **Amplify** | Sát thương đạn ×1.25 | 6 |
| **Trigger** | Tốc độ bắn ×1.20 | 5 |
| **Split Barrel** | +1 viên đạn mỗi phát, thành quạt trọn sát thương | 4 |
| **Railcoat** | Đạn xuyên qua +1 mục tiêu | 4 |
| **Hypersonic** | Đạn bay nhanh hơn 20%, to hơn 10% | 3 |
| **Overclock** | Tỉ lệ chí mạng +10% (gốc 5%, trần 60%), chí mạng ×2 sát thương | 5 |

### Sinh tồn

| Thẻ | Hiệu quả mỗi tầng | Tối đa |
|---|---|---|
| **Reinforce** | +25 HP tối đa và hồi ngay 25 | 4 |
| **Nanoblood** | Hồi 0.6 HP mỗi giây | 4 |
| **Lightfoot** | Tốc độ di chuyển +12% | 5 |
| **Graviton Core** | Bán kính hút gem +45% | 3 |
| **Data Thirst** | Kinh nghiệm nhận được +25% | 3 |

### Hiệu ứng đặc biệt

| Thẻ | Hiệu quả mỗi tầng | Tối đa |
|---|---|---|
| **Leech Rounds** | Hồi +1 HP mỗi lần giết | 5 |
| **Flow State** | Kill trong lúc dash (hoặc 0.4 s sau dash) giảm 1.0 s hồi chiêu dash | 3 |
| **Arc Web** | 30% khả năng tia sét lan sang 2 địch gần (170 px) với 50% sát thương; tầng sau: +10% tỉ lệ, +1 mục tiêu | 3 |
| **Volatile Rounds** | Phát đạn cuối nổ: bán kính 45 px, 50% sát thương; tầng sau: +15 px, +15% | 3 |
| **Static Field** | Sát thương quanh người 8 dps trong bán kính 65 px; tầng sau: +6 dps, +10 px | 3 |

**Field Rations** (hồi 30 HP) là thẻ dự phòng — chỉ xuất hiện khi còn ít hơn 3 thẻ thật.

Khi lên cấp thế giới chậm lại 0.25× trong 0.35 s rồi hiện 3 thẻ; nếu một lần nhặt gem
vượt qua nhiều mốc kinh nghiệm, các lần chọn thẻ sẽ xếp hàng lần lượt.

---

## Mẹo chơi

- **Dash xuyên đạn được.** Thời gian bất tử (0.28 s) dài hơn chính cú dash (0.18 s) —
  đừng né vòng, hãy *lao xuyên qua* loạt đạn của boss.
- **Giữ combo.** Mỗi kill cộng combo, nhưng 2 giây không giết là combo về 0. Combo cao
  nhân điểm tối đa **×3.0** — chạy vòng giữ quái theo sau mình là cách giữ combo an toàn.
- **Darter có trước báo hiệu**: nó dừng lại, duỗi dài và sáng lên 0.35 s trước khi lao —
  đó là giây duy nhất bạn cần bước sang ngang.
- **Spitter giữ khoảng cách 200–260 px** và bắn đạn tím. Hoặc áp sát buộc nó lùi, hoặc
  dash tới gần nhặt gem rồi lướt ra.
- **Brute** (cam, lục giác) máu dày và kháng 70% đẩy lùi — rất cần Railcoat hoặc
  Volatile Rounds/Arc Web để dọn.
- **Trùm mỗi đợt thứ 5.** Khi thấy banner "⚠ BOSS INCOMING" (kèm chuông báo 1.5 s), dọn
  quái phụ trước; trùm bắn volley 14 viên theo vòng quay — đứng giữa hai vòng là an toàn.
  Trùm dưới 40% máu sẽ điên: nhanh hơn, bắn dày hơn và triệu hồi drone.
- **Nhặt gem gần bạn** — gem trong bán kính hút sẽ lao về phía mình. Gem màu hồng giá
  trị cao nhất (5+ XP).
- **Đừng quên Static Field** khi bị bao vây: aura sát thương liên tục là "cứu cánh" ở
  giữa bầy.
- Điểm cao nhất (score/wave/kills/time) tự lưu trong localStorage — nhắm phá kỷ lục của
  chính mình qua GAME OVER.

---

## Ghi chú kỹ thuật

- **Vanilla JavaScript + Canvas 2D thuần** — không framework, không TypeScript, không
  ES modules (`import`/`export`), không bundler, không build step.
- **Không tài nguyên ngoài**: không CDN, không ảnh, không web font, không file âm thanh,
  không `fetch`/WebSocket. Đồ họa vẽ hết bằng Canvas, âm thanh tổng hợp 100% bằng
  WebAudio (nhạc nền 112 BPM pentatonic thay theo wave).
- **Chạy được qua `file://`** vì không dùng ES modules; 9 file JS mỗi file là một IIFE
  gắn đúng một biến global, **thứ tự `<script>` trong `index.html` là bắt buộc**.
- `AudioContext` chỉ được tạo sau lần chạm phím/chuột đầu tiên (tự động tắt tiếng khi
  chưa mở); trạng thái mute và highscore lưu qua localStorage được bọc `try/catch`
  (lỗi môi trường `file://` chỉ làm mất lưu, không bao giờ crash).
- Hiệu năng: game loop `requestAnimationFrame` với `dt` chặn 0.05 s; các trần cố định —
  140 địch, 400 đạn người chơi, 200 đạn địch, 600 particle, 300 gem; glow chỉ dùng
  `shadowBlur` cho nhân vật/boss/gem, phần còn lại giả glow bằng `lighter`.
- Canvas scale theo `min(devicePixelRatio, 2)` — nét trên màn HiDPI; cửa sổ nhỏ nhất
  ~800×600, tự co giãn theo cửa sổ.
- Slow-motion lên cấp (0.25×), hitstop khi kill trùm và screenshake theo mô hình
  "trauma²" đều đi qua một `timeScale` duy nhất — không timer theo khung hình.

Chi tiết thiết kế đầy đủ (bestiary, công thức wave, hợp đồng module) xem
[DESIGN.md](DESIGN.md).

---

## English (short)

**NEON SWARM** — a neon arena-survival shooter. You are the last light in a dead neon
grid: hold the circle, mow down an endless swarm, stack 16 stackable upgrades and face a
boss every 5th wave. Score is multiplied by your kill combo; highscores persist.

**How to run:** double-click `index.html` — it runs straight from `file://` in any modern
browser. No install, no server, no build step, no network.

**Controls:** `WASD`/arrows move · mouse aims · **hold LMB to fire** · `Space` dash
(invulnerable) · `P`/`Esc` pause · `M` mute · `1`/`2`/`3` pick level-up card.

**Tech:** pure vanilla JS + Canvas 2D, one IIFE per module file, synthesized WebAudio
SFX/music, localStorage persistence (best score + mute), DPR-aware rendering.
Full design spec in [DESIGN.md](DESIGN.md).
