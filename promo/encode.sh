#!/usr/bin/env bash
# Mix to about -14 LUFS (true peak under -1 dBTP) and encode the frames.
# Usage: promo/encode.sh <work_dir>   (expects frames/, music.wav, sfx.wav inside)
set -euo pipefail
work="$1"
cd "$work"
norm() {
  # Two-pass loudnorm: measure, then apply the measured values for an accurate, linear result.
  local in="$1" out="$2" filter="$3"
  local stats
  stats=$(ffmpeg -hide_banner -nostats -i music.wav -i sfx.wav -filter_complex "${filter},loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
  local mi mtp mlra mth off
  mi=$(echo "$stats" | python3 -c 'import json,sys; print(json.load(sys.stdin)["input_i"])')
  mtp=$(echo "$stats" | python3 -c 'import json,sys; print(json.load(sys.stdin)["input_tp"])')
  mlra=$(echo "$stats" | python3 -c 'import json,sys; print(json.load(sys.stdin)["input_lra"])')
  mth=$(echo "$stats" | python3 -c 'import json,sys; print(json.load(sys.stdin)["input_thresh"])')
  off=$(echo "$stats" | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_offset"])')
  ffmpeg -hide_banner -loglevel error -y -i music.wav -i sfx.wav -filter_complex \
    "${filter},loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${mi}:measured_TP=${mtp}:measured_LRA=${mlra}:measured_thresh=${mth}:offset=${off}:linear=true" \
    -ar 48000 "$out"
}
norm both mix.wav "[0][1]amix=inputs=2:normalize=0"
norm music music-only.wav "[0]anull"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i frames/%04d.jpg -i mix.wav \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest -t 15 promo-9x16.mp4
ffmpeg -hide_banner -loglevel error -y -i music-only.wav -c:a aac -b:a 192k music-only.m4a
ls -la promo-9x16.mp4 music-only.m4a
