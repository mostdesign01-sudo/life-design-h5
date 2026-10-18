#!/usr/bin/env bash
# Measurable checks for a rendered promo. Usage: promo/qa.sh <video.mp4> <out_dir>
set -euo pipefail
video="$1"; out="$2"; mkdir -p "$out"
{
  echo "## 规格"
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames -show_entries format=duration -of default=nw=1 "$video"
  echo
  echo "## 画面冻结（0.5 秒以上的静止段）"
  ffmpeg -hide_banner -nostats -i "$video" -vf "freezedetect=n=0.0015:d=0.5" -map 0:v -f null - 2>&1 | grep -E "freeze_(start|end|duration)" || echo "无"
  echo
  echo "## 响度"
  ffmpeg -hide_banner -nostats -i "$video" -af ebur128=peak=true -f null - 2>&1 | grep -A14 "Summary" | grep -E "I:|Peak:|LRA:"
} > "$out/qa.txt"
# Contact sheet: 16 frames, one every ~0.94 s, plus a silent-read strip at 2 fps for the critic.
ffmpeg -hide_banner -loglevel error -y -i "$video" -vf "fps=16/15,scale=270:-1,tile=8x2:padding=6:color=0xf6f1ea" -frames:v 1 "$out/contact-sheet.jpg"
ffmpeg -hide_banner -loglevel error -y -i "$video" -vf "fps=2,scale=216:-1,tile=6x5:padding=4:color=0xf6f1ea" -frames:v 1 "$out/silent-read-2fps.jpg"
cat "$out/qa.txt"
