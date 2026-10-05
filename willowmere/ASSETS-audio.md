# ASSETS-audio.md — willowmere audio files

Nhạc nền ambient cozy cho 3 trạng thái (ngày / đêm / mưa). **Chỉ CC0 /
public domain** — license lấy trực tiếp từ trang OpenGameArt của từng bản
h nhạc (fetch ngày 2026-10-05, trang ghi "License(s): CC0").

| File | Nguồn (bản nhạc) | URL nguồn | License | Tác giả | Dùng để làm gì | Thông số |
|---|---|---|---|---|---|---|
| `assets/audio/day.mp3` | "Town Theme RPG" | https://opengameart.org/content/town-theme-rpg | CC0 | cynicmusic | `music-day` — nhạc nền buổi ngày, giai điệu làng mạc ấm | 97 s, MP3 128 kbps 44.1 kHz stereo, ~1.5 MB |
| `assets/audio/night.mp3` | "November Snow" | https://opengameart.org/content/november-snow | CC0 | cynicmusic | `music-night` — piano dịu, trầm, cho ban đêm | 349 s, MP3 128 kbps 44.1 kHz stereo, ~5.6 MB |
| `assets/audio/rain.mp3` | "Rain (loopable)" | https://opengameart.org/content/rain-loopable | CC0 | ylmir | `music-rain` — tiếng mưa loop khi trời mưa (bản số 3 trong gói zip nguồn, 45 s) | 45 s, MP3 128 kbps 44.1 kHz stereo, ~0.7 MB |

## Ghi chú

- **Một định dạng thống nhất:** cả 3 file đều `.mp3` (tương thích `Audio`
  element trên mọi trình duyệt, đúng §14 DESIGN.md).
- Dung lượng mỗi file **≤ 6 MB** (night.mp3 được convert lại từ bản gốc
  14 MB về 128 kbps để đạt ngưỡng; hai bản còn lại giữ nguyên độ dài).
- Loop: file được dùng với `Audio.loop = true`. MP3 có khoảng lặng padding
  của encoder ở đầu/cuối (vài chục ms) — nếu nghe thấy đứt khi loop mưa, có thể
  chuyển sang `.ogg` (nguồn Rain OGG.zip cùng license) mà không đổi mã game.
- Keys trong `js/manifest.js`: `music-day`, `music-night`, `music-rain`
  (đúng hợp đồng §14 DESIGN.md).
