/* willowmere — asset manifest (asset agent owns this file)
 * Keys are the contract from DESIGN.md §14:
 *   art  : tiles, decor, chars, props, ui   -> assets/art/<key>.png
 *   audio: music-day, music-night, music-rain
 * Every file listed here is CC0 / public domain — see ASSETS-art.md
 * and ASSETS-audio.md for per-file source, author and licence.
 * Missing key/file = the game must fall back silently (DESIGN.md §7). */
window.WManifest = {
  art: {
    tiles: "assets/art/tiles.png",
    decor: "assets/art/decor.png",
    chars: "assets/art/chars.png",
    props: "assets/art/props.png",
    ui:    "assets/art/ui.png"
  },
  audio: {
    "music-day":   "assets/audio/day.mp3",
    "music-night": "assets/audio/night.mp3",
    "music-rain":  "assets/audio/rain.mp3"
  }
};
