#!/bin/sh -xe
ffmpeg \
	-y \
	-loop 1 \
	-i waiting.png \
	-i waiting.wav \
	-c:v libx264 \
	-s 800x450 \
	-r 120 \
	-pix_fmt yuv420p \
	-c:a aac \
	-ac 2 \
	-ar 44100 \
	-ab 128k \
	-t 13 \
	-hls_time 2 \
	-hls_list_size 0 \
	-hls_segment_filename waiting_%d.ts \
	waiting.m3u8
