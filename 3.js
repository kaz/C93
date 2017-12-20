"use strict";

const loginInfo = {
	mail_tel: " your mailaddress here ",
	password: " your password here ",
};

const cheerio = require("cheerio");
const request = require("request-promise-native");
const {spawn} = require("child_process");

void async function main() {
	// Cookieを処理するためのJarを用意する
	const jar = request.jar();

	// request設定
	const {get, post} = request.defaults({jar, followAllRedirects: true});

	// ログインする
	const loginResponse = await post("https://account.nicovideo.jp/api/v1/login").form(loginInfo);
	if(/メールアドレスまたはパスワードが間違っています/.test(loginResponse)){
		return console.error("ログインに失敗しました");
	}

	// 動画ファイルのURLを抜き出す
	const apiData = cheerio.load(await get("http://www.nicovideo.jp/watch/sm15630734"))("#js-initial-watch-data").data("api-data");
	const videoURL = apiData.video.smileInfo.url;

	// 動画ファイルの取得に必要なCookieを抜き出す
	const cookies = jar.getCookieString(videoURL);

	// FFMPEGに動画をDLさせ、分割してM3U8プレイリストを作成する
	spawn("ffmpeg", [
		"-y", // 出力ファイルの上書きを許可
		"-headers", `Cookie: ${cookies}`, // HTTPで動画を取りに行くときにCookieを使ってもらう
		"-i", videoURL, // HTTPで動画を拾ってきてもらう
		"-c:v", "copy", // 動画を変換しない
		"-c:a", "copy", // 音声を変換しない
		"-hls_time", "45", // だいたい45秒ごとに分割
		"-hls_list_size", "0", // リストに含めるファイルの最大数（0で制限なし）
		"-hls_segment_filename", "workdir/test2_%d.ts", // 分割したファイルの名前（%dに連番が入る）
		"workdir/test2.m3u8", // M3U8プレイリストの保存先
	], {
		stdio: "inherit",
	});
}();
